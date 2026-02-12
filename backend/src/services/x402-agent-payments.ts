/**
 * x402 Agent-to-Agent Payments (Coinbase x402 + CDP Wallets)
 *
 * Buyer flow:
 * request -> 402 -> sign (CDP wallet) -> retry -> data + receipt headers
 */

import type { Address, Hex } from 'viem';
import { privateKeyToAccount, toAccount } from 'viem/accounts';
import { CdpClient } from '@coinbase/cdp-sdk';
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { decodePaymentResponseHeader } from '@x402/core/http';
import { createHash } from 'node:crypto';
import {
    BASE_SEPOLIA_NETWORK,
    X402_BASE_URL,
    type X402AgentId,
    X402_AGENT_DEFINITIONS,
    getAgentPrice,
    getAgentPriceUsd,
    getSellerAddresses,
} from './x402-common.js';
import { ensureCdpWalletRegistry, getSellerAddressMapFromRegistry } from './cdp-wallet-registry.js';
import { logX402PaymentRecord, saveSessionSpendSnapshot } from './supabase.js';

type JsonObject = Record<string, unknown>;

export interface PaymentRecord {
    id: string;
    sessionId?: string;
    traceId?: string;
    agentId: X402AgentId;
    endpoint: string;
    method: 'GET' | 'POST';
    amount: string;
    amountUsd: number;
    network: string;
    payTo: Address;
    receiptRef?: string;
    txHash?: string;
    settlePayer?: string;
    settleNetwork?: string;
    settleTxHash?: string;
    facilitatorSettlementId?: string;
    facilitatorPaymentId?: string;
    paymentResponseHeader?: string;
    paymentResponseHeaderHash?: string;
    settleResponse?: JsonObject;
    settleResponseHash?: string;
    settleExtensions?: JsonObject;
    paymentPayload?: JsonObject;
    paymentPayloadHash?: string;
    settledAt: string;
    latencyMs: number;
    success: boolean;
    error?: string;
}

export interface SessionSpendSummary {
    sessionId: string;
    totalSpendUsd: number;
    paidCalls: number;
    receipts: PaymentRecord[];
    updatedAt: string;
}

export interface PaidCallResult<T = unknown> {
    data: T;
    payment: PaymentRecord;
    raw: unknown;
}

export interface PaidCallRequest {
    agentId: X402AgentId;
    endpoint: string;
    method?: 'GET' | 'POST';
    body?: unknown;
    sessionId?: string;
    traceId?: string;
}

interface LegacyPaymentResult {
    transactionId: string;
    status: string;
    taskHash: string;
}

const paymentHistory: PaymentRecord[] = [];
const sessionSpendMap = new Map<string, SessionSpendSummary>();

let buyerClient: any | null = null;
let fetchWithPayment: typeof fetch | null = null;
let paymentHttpClient: any | null = null;
let payerAddress: Address | null = null;
let payerSource: 'cdp' | 'private_key' | null = null;
let sellerAddresses: Record<X402AgentId, Address> = getSellerAddresses();

const TX_HASH_REGEX = /^0x[a-fA-F0-9]{64}$/;

const TX_HASH_KEYS = new Set([
    'txhash',
    'transactionhash',
    'transaction',
    'hash',
    'tx',
]);

const RECEIPT_REF_KEYS = new Set([
    'id',
    'receiptid',
    'transactionid',
    'settlementid',
    'reference',
    'receiptref',
]);

const PAYER_KEYS = new Set([
    'payer',
    'from',
    'fromaddress',
    'payeraddress',
]);

const NETWORK_KEYS = new Set([
    'network',
    'chain',
    'chainid',
]);

const SETTLEMENT_ID_KEYS = new Set([
    'settlementid',
    'settlementreference',
    'settlereference',
    'facilitatorsettlementid',
]);

const PAYMENT_ID_KEYS = new Set([
    'paymentid',
    'facilitatorpaymentid',
    'paymentreference',
    'referenceid',
]);

async function resolveCdpOrchestratorSigner(): Promise<{ signer: any; address: Address } | null> {
    const hasCdpCreds = Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
    if (!hasCdpCreds) {
        return null;
    }

    const registry = await ensureCdpWalletRegistry({ createMissing: true });
    const cdp = new CdpClient();

    let account: any | null = null;

    const orchestratorAccountName = registry.orchestrator?.accountName || 'arcana-x402-orchestrator';

    if (typeof cdp?.evm?.getAccount === 'function') {
        try {
            account = await cdp.evm.getAccount({ name: orchestratorAccountName });
        } catch {
            // Continue probing other fetch methods.
        }
    }

    if (!account && registry.orchestrator?.address && typeof cdp?.evm?.getAccount === 'function') {
        try {
            account = await cdp.evm.getAccount({ address: registry.orchestrator.address });
        } catch {
            // Continue probing other fetch methods.
        }
    }

    if (!account && typeof cdp?.evm?.getOrCreateAccount === 'function') {
        account = await cdp.evm.getOrCreateAccount({ name: 'arcana-x402-orchestrator' });
    }

    if (!account && typeof cdp?.evm?.createAccount === 'function') {
        account = await cdp.evm.createAccount();
    }

    if (!account) {
        throw new Error('Failed to resolve CDP orchestrator account');
    }

    const signer = toAccount(account);
    return {
        signer,
        address: account.address as Address,
    };
}

function normalizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function toNonEmptyString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}

function safeStringify(value: unknown): string {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, current) => {
        if (typeof current === 'bigint') {
            return current.toString();
        }

        if (typeof current === 'object' && current !== null) {
            if (seen.has(current)) {
                return '[Circular]';
            }

            seen.add(current);
        }

        return current;
    });
}

function toJsonObject(value: unknown): JsonObject | undefined {
    if (!value || typeof value !== 'object') return undefined;

    try {
        const serialized = safeStringify(value);
        if (!serialized) return undefined;
        const parsed = JSON.parse(serialized) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return undefined;
        }

        return parsed as JsonObject;
    } catch {
        return undefined;
    }
}

function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

function hashJsonValue(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;

    try {
        return sha256Hex(safeStringify(value));
    } catch {
        return undefined;
    }
}

function deepFindStringByKeys(
    value: unknown,
    keySet: Set<string>,
    seen: WeakSet<object> = new WeakSet(),
    depth: number = 0,
): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    if (depth > 8) return undefined;

    if (seen.has(value as object)) {
        return undefined;
    }
    seen.add(value as object);

    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = deepFindStringByKeys(item, keySet, seen, depth + 1);
            if (nested) return nested;
        }
        return undefined;
    }

    for (const [key, child] of Object.entries(value)) {
        if (keySet.has(normalizeKey(key))) {
            const candidate = toNonEmptyString(child);
            if (candidate) return candidate;
        }

        const nested = deepFindStringByKeys(child, keySet, seen, depth + 1);
        if (nested) return nested;
    }

    return undefined;
}

function extractFirstStringByKeys(keySet: Set<string>, ...sources: unknown[]): string | undefined {
    for (const source of sources) {
        const candidate = deepFindStringByKeys(source, keySet);
        if (candidate) return candidate;
    }

    return undefined;
}

function resolvePaymentResponseHeaderValue(headers: Headers): string | undefined {
    return headers.get('PAYMENT-RESPONSE') || headers.get('X-PAYMENT-RESPONSE') || undefined;
}

function extractPaymentPayloadFromResponse(raw: unknown): JsonObject | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return undefined;
    }

    const root = raw as JsonObject;
    const direct = toJsonObject(root.payment);
    if (direct) return direct;

    const nestedData = toJsonObject(root.data);
    if (!nestedData) return undefined;

    return toJsonObject(nestedData.payment);
}

function extractTxHashFromReceipt(receipt: unknown): string | undefined {
    if (!receipt) return undefined;

    if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)) {
        const direct = receipt as JsonObject;
        const directCandidate = toNonEmptyString(direct.txHash)
            || toNonEmptyString(direct.transactionHash)
            || toNonEmptyString(direct.hash)
            || toNonEmptyString(direct.tx)
            || toNonEmptyString(direct.transaction);

        if (directCandidate && TX_HASH_REGEX.test(directCandidate)) {
            return directCandidate;
        }
    }

    const nestedCandidate = deepFindStringByKeys(receipt, TX_HASH_KEYS);
    if (nestedCandidate && TX_HASH_REGEX.test(nestedCandidate)) {
        return nestedCandidate;
    }

    return undefined;
}

function extractReceiptRef(receipt: unknown): string | undefined {
    if (!receipt) return undefined;

    if (receipt && typeof receipt === 'object' && !Array.isArray(receipt)) {
        const direct = receipt as JsonObject;
        const directCandidate = toNonEmptyString(direct.id)
            || toNonEmptyString(direct.receiptId)
            || toNonEmptyString(direct.transactionId)
            || toNonEmptyString(direct.settlementId)
            || toNonEmptyString(direct.reference);

        if (directCandidate) return directCandidate;
    }

    return deepFindStringByKeys(receipt, RECEIPT_REF_KEYS);
}

function addRecordToSession(record: PaymentRecord): void {
    if (!record.sessionId) {
        return;
    }

    const current = sessionSpendMap.get(record.sessionId) || {
        sessionId: record.sessionId,
        totalSpendUsd: 0,
        paidCalls: 0,
        receipts: [],
        updatedAt: new Date().toISOString(),
    };

    const spendDelta = record.success ? record.amountUsd : 0;
    const next: SessionSpendSummary = {
        ...current,
        totalSpendUsd: Number((current.totalSpendUsd + spendDelta).toFixed(6)),
        paidCalls: current.paidCalls + (record.success ? 1 : 0),
        receipts: [record, ...current.receipts].slice(0, 100),
        updatedAt: new Date().toISOString(),
    };

    sessionSpendMap.set(record.sessionId, next);

    void saveSessionSpendSnapshot(next).catch((error) => {
        console.warn('[x402] Failed to persist session spend snapshot:', (error as Error).message);
    });
}

function parseData<T = unknown>(raw: unknown): T {
    if (raw && typeof raw === 'object' && 'data' in (raw as Record<string, unknown>)) {
        return (raw as { data: T }).data;
    }

    return raw as T;
}

function ensureClientReady(): void {
    if (!buyerClient || !fetchWithPayment) {
        throw new Error('[x402] Not initialized. Call initX402Payments first.');
    }
}

export async function initX402Payments(fallbackPrivateKey?: Hex): Promise<{
    payerAddress: Address;
    payerSource: 'cdp' | 'private_key';
    sellerAddresses: Record<X402AgentId, Address>;
}> {
    sellerAddresses = await getSellerAddressMapFromRegistry();

    const cdpSigner = await resolveCdpOrchestratorSigner().catch((error) => {
        console.warn('[x402] CDP signer unavailable:', (error as Error).message);
        return null;
    });

    let signer: any;

    if (cdpSigner) {
        signer = cdpSigner.signer;
        payerAddress = cdpSigner.address;
        payerSource = 'cdp';
    } else {
        const privateKey = fallbackPrivateKey || (process.env.PRIVATE_KEY as Hex | undefined);
        if (!privateKey) {
            throw new Error('Missing CDP credentials and PRIVATE_KEY fallback for x402 buyer signer');
        }

        signer = privateKeyToAccount(privateKey);
        payerAddress = signer.address as Address;
        payerSource = 'private_key';
    }

    buyerClient = new x402Client();
    registerExactEvmScheme(buyerClient, { signer });
    fetchWithPayment = wrapFetchWithPayment(fetch, buyerClient);
    paymentHttpClient = new x402HTTPClient(buyerClient);

    console.log('[x402 Payments] ✅ Initialized');
    console.log(`[x402 Payments]    Buyer: ${payerAddress}`);
    console.log(`[x402 Payments]    Signer: ${payerSource}`);
    console.log(`[x402 Payments]    Network: ${BASE_SEPOLIA_NETWORK}`);
    console.log(`[x402 Payments]    Base URL: ${X402_BASE_URL}`);

    return {
        payerAddress,
        payerSource,
        sellerAddresses,
    };
}

export function isX402Ready(): boolean {
    return Boolean(fetchWithPayment && buyerClient && payerAddress);
}

export function getPayerAddress(): string | null {
    return payerAddress;
}

export function getX402BuyerSource(): 'cdp' | 'private_key' | null {
    return payerSource;
}

export function getSellerAddressMap(): Record<X402AgentId, Address> {
    return { ...sellerAddresses };
}

export async function getX402Balance() {
    return {
        payerAddress,
        payerSource,
        totalSpendUsd: getTotalPaid(),
        paymentCount: getPaymentCount(),
    };
}

export async function payAndFetch<T = unknown>(req: PaidCallRequest): Promise<PaidCallResult<T>> {
    ensureClientReady();

    const method = req.method || 'GET';
    const endpoint = req.endpoint.startsWith('http') ? req.endpoint : `${X402_BASE_URL}${req.endpoint}`;
    const price = getAgentPrice(req.agentId);
    const priceUsd = getAgentPriceUsd(req.agentId);
    const payTo = sellerAddresses[req.agentId];

    const startedAt = Date.now();
    let responseHeaderRaw: string | undefined;
    let responseHeaderHash: string | undefined;
    let settleReceipt: JsonObject | undefined;
    let settleResponseHash: string | undefined;
    let settleExtensions: JsonObject | undefined;
    let responsePaymentPayload: JsonObject | undefined;
    let responsePaymentPayloadHash: string | undefined;
    let receiptRef: string | undefined;
    let txHash: string | undefined;
    let settlePayer: string | undefined;
    let settleNetwork: string | undefined;
    let facilitatorSettlementId: string | undefined;
    let facilitatorPaymentId: string | undefined;

    try {
        const response = await fetchWithPayment!(endpoint, {
            method,
            headers: req.body ? { 'Content-Type': 'application/json' } : undefined,
            body: req.body ? JSON.stringify(req.body) : undefined,
        });

        const latencyMs = Date.now() - startedAt;
        responseHeaderRaw = resolvePaymentResponseHeaderValue(response.headers);
        responseHeaderHash = responseHeaderRaw ? sha256Hex(responseHeaderRaw) : undefined;

        const contentType = response.headers.get('content-type') || '';
        const raw = contentType.includes('application/json')
            ? await response.json()
            : await response.text();

        responsePaymentPayload = extractPaymentPayloadFromResponse(raw);
        responsePaymentPayloadHash = hashJsonValue(responsePaymentPayload);

        let settleReceiptRaw: unknown;
        try {
            settleReceiptRaw = paymentHttpClient?.getPaymentSettleResponse?.((name: string) => response.headers.get(name));
        } catch {
            settleReceiptRaw = undefined;
        }

        if (!settleReceiptRaw && responseHeaderRaw) {
            try {
                settleReceiptRaw = decodePaymentResponseHeader(responseHeaderRaw);
            } catch {
                settleReceiptRaw = undefined;
            }
        }

        settleReceipt = toJsonObject(settleReceiptRaw);
        settleExtensions = toJsonObject(settleReceipt?.extensions);
        settleResponseHash = hashJsonValue(settleReceipt);
        receiptRef = extractReceiptRef(settleReceipt) || extractReceiptRef(responsePaymentPayload);
        txHash = extractTxHashFromReceipt(settleReceipt) || extractTxHashFromReceipt(responsePaymentPayload);
        settlePayer = extractFirstStringByKeys(PAYER_KEYS, settleReceipt, responsePaymentPayload);
        settleNetwork = extractFirstStringByKeys(NETWORK_KEYS, settleReceipt, responsePaymentPayload);
        facilitatorSettlementId = extractFirstStringByKeys(
            SETTLEMENT_ID_KEYS,
            settleReceipt,
            settleExtensions,
            responsePaymentPayload,
        );
        facilitatorPaymentId = extractFirstStringByKeys(
            PAYMENT_ID_KEYS,
            settleReceipt,
            settleExtensions,
            responsePaymentPayload,
        );

        if (!response.ok) {
            throw new Error(`Paid request failed (${response.status}): ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`);
        }

        const payment: PaymentRecord = {
            id: `x402-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId: req.sessionId,
            traceId: req.traceId,
            agentId: req.agentId,
            endpoint: req.endpoint,
            method,
            amount: price,
            amountUsd: priceUsd,
            network: BASE_SEPOLIA_NETWORK,
            payTo,
            receiptRef,
            txHash,
            settlePayer,
            settleNetwork,
            settleTxHash: txHash,
            facilitatorSettlementId,
            facilitatorPaymentId,
            paymentResponseHeader: responseHeaderRaw,
            paymentResponseHeaderHash: responseHeaderHash,
            settleResponse: settleReceipt,
            settleResponseHash,
            settleExtensions,
            paymentPayload: responsePaymentPayload,
            paymentPayloadHash: responsePaymentPayloadHash,
            settledAt: new Date().toISOString(),
            latencyMs,
            success: true,
        };

        paymentHistory.push(payment);
        addRecordToSession(payment);

        await logX402PaymentRecord(payment);

        return {
            data: parseData<T>(raw),
            payment,
            raw,
        };
    } catch (error) {
        const payment: PaymentRecord = {
            id: `x402-failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId: req.sessionId,
            traceId: req.traceId,
            agentId: req.agentId,
            endpoint: req.endpoint,
            method,
            amount: price,
            amountUsd: priceUsd,
            network: BASE_SEPOLIA_NETWORK,
            payTo,
            receiptRef,
            txHash,
            settlePayer,
            settleNetwork,
            settleTxHash: txHash,
            facilitatorSettlementId,
            facilitatorPaymentId,
            paymentResponseHeader: responseHeaderRaw,
            paymentResponseHeaderHash: responseHeaderHash,
            settleResponse: settleReceipt,
            settleResponseHash,
            settleExtensions,
            paymentPayload: responsePaymentPayload,
            paymentPayloadHash: responsePaymentPayloadHash,
            settledAt: new Date().toISOString(),
            latencyMs: Date.now() - startedAt,
            success: false,
            error: (error as Error).message,
        };

        paymentHistory.push(payment);
        addRecordToSession(payment);

        await logX402PaymentRecord(payment);

        throw error;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Paid endpoint helpers used by orchestration
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchPaidOraclePrice(symbol: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'oracle',
        endpoint: `/api/x402/oracle/price?symbol=${encodeURIComponent(symbol)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidScoutAnalysis(address: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'scout',
        endpoint: `/api/x402/scout/analyze?address=${encodeURIComponent(address)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidScoutGas(context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'scout',
        endpoint: '/api/x402/scout/gas',
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidScoutGasEstimate(operation: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'scout',
        endpoint: `/api/x402/scout/gas-estimate?operation=${encodeURIComponent(operation)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidScoutDex(chain: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'scout',
        endpoint: `/api/x402/scout/dex?chain=${encodeURIComponent(chain)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidScoutProtocol(protocol: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'scout',
        endpoint: `/api/x402/scout/protocol?protocol=${encodeURIComponent(protocol)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidScoutBridges(context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'scout',
        endpoint: '/api/x402/scout/bridges',
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidScoutHacks(context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'scout',
        endpoint: '/api/x402/scout/hacks',
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidNewsLatest(limit = 10, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'news',
        endpoint: `/api/x402/news/latest?limit=${limit}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidNewsSearch(query: string, limit = 10, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'news',
        endpoint: `/api/x402/news/search?query=${encodeURIComponent(query)}&limit=${limit}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidNewsBreaking(context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'news',
        endpoint: '/api/x402/news/breaking',
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidNewsTrending(context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'news',
        endpoint: '/api/x402/news/trending',
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidYieldTop(params: {
    chain?: string;
    minApy?: number;
    maxApy?: number;
    type?: string;
    protocol?: string;
    limit?: number;
}, context?: { sessionId?: string; traceId?: string }) {
    const query = new URLSearchParams();
    if (params.chain) query.set('chain', params.chain);
    if (typeof params.minApy === 'number') query.set('minApy', String(params.minApy));
    if (typeof params.maxApy === 'number') query.set('maxApy', String(params.maxApy));
    if (params.type) query.set('type', params.type);
    if (params.protocol) query.set('protocol', params.protocol);
    if (typeof params.limit === 'number') query.set('limit', String(params.limit));

    return payAndFetch({
        agentId: 'yield',
        endpoint: `/api/x402/yield/top${query.toString() ? `?${query.toString()}` : ''}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidYieldAsset(token: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'yield',
        endpoint: `/api/x402/yield/asset?token=${encodeURIComponent(token)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidTokenomics(symbol: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'tokenomics',
        endpoint: `/api/x402/tokenomics/analyze?symbol=${encodeURIComponent(symbol)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidNftCollection(slug: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'nft',
        endpoint: `/api/x402/scout/nft/${encodeURIComponent(slug)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidNftSearch(query: string, context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'nft',
        endpoint: `/api/x402/scout/search?q=${encodeURIComponent(query)}`,
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidPerpMarkets(context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'perp',
        endpoint: '/api/x402/perp/markets',
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

export async function fetchPaidPerpGlobal(context?: { sessionId?: string; traceId?: string }) {
    return payAndFetch({
        agentId: 'perp',
        endpoint: '/api/x402/perp/global',
        sessionId: context?.sessionId,
        traceId: context?.traceId,
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compatibility wrappers
// ─────────────────────────────────────────────────────────────────────────────

async function asLegacyResult(taskHash: string, promise: Promise<PaidCallResult<any>>): Promise<LegacyPaymentResult> {
    const result = await promise;
    return {
        transactionId: result.payment.txHash || result.payment.receiptRef || result.payment.id,
        status: result.payment.success ? 'settled' : 'failed',
        taskHash,
    };
}

export async function createOraclePayment(taskDescription: string): Promise<LegacyPaymentResult> {
    const symbolMatch = taskDescription.match(/price:(\w+)/i);
    const symbol = symbolMatch?.[1] || 'BTC';
    return asLegacyResult(taskDescription, fetchPaidOraclePrice(symbol));
}

export async function createScoutPayment(taskDescription: string): Promise<LegacyPaymentResult> {
    return asLegacyResult(taskDescription, fetchPaidScoutGas());
}

export async function createNewsScoutPayment(taskDescription: string): Promise<LegacyPaymentResult> {
    return asLegacyResult(taskDescription, fetchPaidNewsLatest());
}

export async function createYieldOptimizerPayment(taskDescription: string): Promise<LegacyPaymentResult> {
    return asLegacyResult(taskDescription, fetchPaidYieldTop({ limit: 20 }));
}

export async function createTokenomicsPayment(taskDescription: string): Promise<LegacyPaymentResult> {
    const symbolMatch = taskDescription.match(/tokenomics:(\w+)/i);
    const symbol = symbolMatch?.[1] || 'ARB';
    return asLegacyResult(taskDescription, fetchPaidTokenomics(symbol));
}

export async function createNftScoutPayment(taskDescription: string): Promise<LegacyPaymentResult> {
    const slugMatch = taskDescription.match(/nft:(\w[-\w]*)/i);
    const slug = slugMatch?.[1] || 'pudgypenguins';
    return asLegacyResult(taskDescription, fetchPaidNftCollection(slug));
}

export async function createPerpStatsPayment(taskDescription: string): Promise<LegacyPaymentResult> {
    const isGlobal = taskDescription.includes('global');
    return asLegacyResult(taskDescription, isGlobal ? fetchPaidPerpGlobal() : fetchPaidPerpMarkets());
}

export function getPaymentHistory(): PaymentRecord[] {
    return [...paymentHistory].reverse();
}

export function getTotalPaid(): number {
    return paymentHistory
        .filter((p) => p.success)
        .reduce((sum, p) => sum + p.amountUsd, 0);
}

export function getPaymentCount(): number {
    return paymentHistory.filter((p) => p.success).length;
}

export function getSessionSpendSummary(sessionId: string): SessionSpendSummary {
    return sessionSpendMap.get(sessionId) || {
        sessionId,
        totalSpendUsd: 0,
        paidCalls: 0,
        receipts: [],
        updatedAt: new Date().toISOString(),
    };
}

export function getRecentReceipts(sessionId?: string, limit = 20): PaymentRecord[] {
    const source = sessionId
        ? getSessionSpendSummary(sessionId).receipts
        : [...paymentHistory].reverse();

    return source.slice(0, Math.max(1, Math.min(limit, 100)));
}

export const AGENT_ADDRESSES = getSellerAddressMap();
export const AGENT_PRICES = Object.fromEntries(
    Object.entries(X402_AGENT_DEFINITIONS).map(([agentId, cfg]) => [agentId, cfg.price])
) as Record<X402AgentId, string>;
