import { createHash } from 'node:crypto';
import {
    getProcurementProviderStates,
    getRecentProcurementReceipts,
    logProcurementReceipt,
    type ProcurementProviderStateRow,
    type ProcurementReceiptRow,
    upsertProcurementProviderState,
} from './supabase.js';
import { payX402ThroughPinion } from './pinion-runtime.js';

export interface ProcurementCandidate {
    id: string;
    url: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    headers?: Record<string, string>;
    maxAmountAtomic?: string;
    expectedFields?: string[];
}

export interface ProcurementPolicy {
    allowedDomains?: string[];
    blockedDomains?: string[];
    maxAmountAtomic?: string;
    requireHttps?: boolean;
    requireX402?: boolean;
    networkAllowlist?: string[];
    payToAllowlist?: string[];
    maxAttempts?: number;
}

export interface ProviderStats {
    id: string;
    calls: number;
    successes: number;
    failures: number;
    avgLatencyMs: number;
    schemaPasses: number;
    qualityScoreAvg: number;
    consecutiveFailures: number;
    circuitOpenUntil: string | null;
    lastStatus?: number;
    lastError?: string;
    lastSeenAt?: string;
    updatedAt?: string;
}

export interface ProviderScore {
    candidate: ProcurementCandidate;
    allowed: boolean;
    score: number;
    reasons: string[];
    metrics: {
        successRate: number;
        schemaRate: number;
        qualityScoreAvg: number;
        avgLatencyMs: number;
        latencyScore: number;
        priceScore: number;
        circuitOpen: boolean;
    };
}

export interface ProcurementReceipt {
    id: string;
    intent: string;
    providerId: string;
    url: string;
    method: string;
    status: number;
    paidAmountAtomic: string;
    responseHash: string;
    latencyMs: number;
    success: boolean;
    schemaOk: boolean;
    score: number;
    txHash: string | null;
    payTo: string | null;
    attempt: number;
    error: string | null;
    createdAt: string;
}

interface PreflightPaymentRequirement {
    version: 1 | 2;
    network: string;
    payTo: string;
    amountAtomic: string;
    asset?: string;
}

interface PreflightResult {
    status: number;
    requirement?: PreflightPaymentRequirement;
    body?: unknown;
    error?: string;
}

const providerStats = new Map<string, ProviderStats>();
const procurementReceipts: ProcurementReceipt[] = [];

const CIRCUIT_FAIL_THRESHOLD = Number(process.env.X402_PROCUREMENT_CIRCUIT_FAIL_THRESHOLD || 3);
const CIRCUIT_OPEN_MS = Number(process.env.X402_PROCUREMENT_CIRCUIT_OPEN_MS || 180000);
const DEFAULT_MAX_ATTEMPTS = Number(process.env.X402_PROCUREMENT_MAX_ATTEMPTS || 3);

let hydrationPromise: Promise<void> | null = null;
let hydrated = false;

function normalizeDomain(url: string): string | null {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return null;
    }
}

function isLocalDomain(domain: string): boolean {
    return domain === 'localhost' || domain === '127.0.0.1' || domain === '::1';
}

function bounded(value: number, min = 0, max = 1): number {
    return Math.max(min, Math.min(max, value));
}

function stringify(value: unknown): string {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function hashResponse(value: unknown): string {
    return createHash('sha256').update(stringify(value)).digest('hex');
}

function parseAtomic(value?: string): bigint | null {
    if (!value) return null;
    if (!/^\d+$/.test(value)) return null;
    return BigInt(value);
}

function normalizeMethod(method?: string): 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' {
    const normalized = String(method || 'GET').toUpperCase();
    if (normalized === 'POST' || normalized === 'PUT' || normalized === 'PATCH' || normalized === 'DELETE') {
        return normalized;
    }
    return 'GET';
}

function resolveMaxAmountAtomic(
    candidate: ProcurementCandidate,
    policy?: ProcurementPolicy,
    requirement?: PreflightPaymentRequirement,
): string | undefined {
    const candidateLimit = parseAtomic(candidate.maxAmountAtomic);
    const policyLimit = parseAtomic(policy?.maxAmountAtomic);

    if (candidateLimit && policyLimit) {
        return (candidateLimit < policyLimit ? candidateLimit : policyLimit).toString();
    }
    if (candidateLimit) return candidateLimit.toString();
    if (policyLimit) return policyLimit.toString();
    if (requirement?.amountAtomic) return requirement.amountAtomic;
    return undefined;
}

function validateSchema(data: unknown, expectedFields?: string[]): boolean {
    if (!expectedFields || expectedFields.length === 0) return true;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const record = data as Record<string, unknown>;
    return expectedFields.every((field) => Object.prototype.hasOwnProperty.call(record, field));
}

function computeQualityScore(data: unknown, schemaOk: boolean, status: number): number {
    const base = schemaOk ? 0.6 : 0.25;
    const healthyStatusBoost = status >= 200 && status < 300 ? 0.15 : -0.2;

    let structureScore = 0;
    if (typeof data === 'string') {
        structureScore = bounded(data.length / 600, 0, 0.2);
    } else if (data && typeof data === 'object') {
        const keys = Object.keys(data as Record<string, unknown>).length;
        structureScore = bounded(keys / 20, 0, 0.2);
    }

    return bounded(base + healthyStatusBoost + structureScore, 0, 1);
}

function normalizeKey(key: string): string {
    return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function deepFindStringByKeys(
    value: unknown,
    keySet: Set<string>,
    seen: WeakSet<object> = new WeakSet(),
    depth = 0,
): string | undefined {
    if (!value || typeof value !== 'object') return undefined;
    if (depth > 8) return undefined;

    if (seen.has(value as object)) return undefined;
    seen.add(value as object);

    if (Array.isArray(value)) {
        for (const item of value) {
            const nested = deepFindStringByKeys(item, keySet, seen, depth + 1);
            if (nested) return nested;
        }
        return undefined;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (keySet.has(normalizeKey(key)) && typeof child === 'string' && child.trim()) {
            return child.trim();
        }

        const nested = deepFindStringByKeys(child, keySet, seen, depth + 1);
        if (nested) return nested;
    }

    return undefined;
}

function extractTxHash(value: unknown): string | null {
    const candidate = deepFindStringByKeys(value, new Set(['txhash', 'transactionhash', 'hash', 'tx']));
    if (!candidate) return null;
    return /^0x[a-fA-F0-9]{64}$/.test(candidate) ? candidate : null;
}

function sanitizeHeaders(headers?: Record<string, string>): Record<string, string> {
    const next: Record<string, string> = {
        Accept: 'application/json',
        ...(headers || {}),
    };

    const blocked = new Set(['x-payment', 'payment-signature', 'payment-required']);
    for (const key of Object.keys(next)) {
        if (blocked.has(key.toLowerCase())) {
            delete next[key];
        }
    }

    return next;
}

function parseV2RequirementFromHeader(header: string): PreflightPaymentRequirement | undefined {
    try {
        const decoded = JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as {
            accepts?: Array<{ network?: string; payTo?: string; amount?: string; asset?: string }>;
        };

        const accepted = decoded.accepts?.[0];
        if (!accepted?.network || !accepted?.payTo || !accepted?.amount) return undefined;

        return {
            version: 2,
            network: accepted.network,
            payTo: accepted.payTo,
            amountAtomic: accepted.amount,
            asset: accepted.asset,
        };
    } catch {
        return undefined;
    }
}

function parseV1RequirementFromBody(body: unknown): PreflightPaymentRequirement | undefined {
    if (!body || typeof body !== 'object') return undefined;
    const root = body as {
        accepts?: Array<{ network?: string; payTo?: string; maxAmountRequired?: string; asset?: string }>;
    };

    const accepted = root.accepts?.[0];
    if (!accepted?.network || !accepted?.payTo || !accepted?.maxAmountRequired) {
        return undefined;
    }

    return {
        version: 1,
        network: accepted.network,
        payTo: accepted.payTo,
        amountAtomic: accepted.maxAmountRequired,
        asset: accepted.asset,
    };
}

async function preflightCandidate(candidate: ProcurementCandidate): Promise<PreflightResult> {
    const method = normalizeMethod(candidate.method);
    const headers = sanitizeHeaders(candidate.headers);

    if (candidate.body && method !== 'GET' && method !== 'DELETE') {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    const requestInit: RequestInit = {
        method,
        headers,
    };

    if (candidate.body && method !== 'GET' && method !== 'DELETE') {
        requestInit.body = JSON.stringify(candidate.body);
    }

    try {
        const response = await fetch(candidate.url, requestInit);
        const paymentRequiredHeader = response.headers.get('PAYMENT-REQUIRED');

        let body: unknown = undefined;
        try {
            body = await response.json();
        } catch {
            body = undefined;
        }

        if (response.status !== 402) {
            return {
                status: response.status,
                body,
            };
        }

        const v2 = paymentRequiredHeader ? parseV2RequirementFromHeader(paymentRequiredHeader) : undefined;
        const v1 = parseV1RequirementFromBody(body);

        return {
            status: response.status,
            requirement: v2 || v1,
            body,
            error: !v2 && !v1 ? 'Failed to parse x402 payment requirements' : undefined,
        };
    } catch (error) {
        return {
            status: 599,
            error: (error as Error).message,
        };
    }
}

function isCircuitOpen(stats: ProviderStats): boolean {
    if (!stats.circuitOpenUntil) return false;
    return Date.now() < new Date(stats.circuitOpenUntil).getTime();
}

function evaluateCandidatePolicy(
    candidate: ProcurementCandidate,
    policy?: ProcurementPolicy,
    preflight?: PreflightResult,
): { allowed: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const domain = normalizeDomain(candidate.url);

    if (!domain) {
        reasons.push('Invalid candidate URL');
        return { allowed: false, reasons };
    }

    const httpsRequired = policy?.requireHttps !== false;
    const isLocal = isLocalDomain(domain);

    if (httpsRequired && !isLocal && !candidate.url.startsWith('https://')) {
        reasons.push('HTTPS required by policy');
    }

    if (policy?.blockedDomains?.some((d) => d.toLowerCase() === domain)) {
        reasons.push(`Domain blocked by policy: ${domain}`);
    }

    if (policy?.allowedDomains && policy.allowedDomains.length > 0) {
        const allowed = policy.allowedDomains.some((d) => d.toLowerCase() === domain);
        if (!allowed) {
            reasons.push(`Domain not allowlisted: ${domain}`);
        }
    }

    const requirement = preflight?.requirement;
    if (policy?.requireX402 !== false && preflight && preflight.status !== 402) {
        reasons.push(`Endpoint did not return 402 during preflight (status ${preflight.status})`);
    }

    if (policy?.requireX402 !== false && preflight?.status === 402 && !requirement) {
        reasons.push(preflight.error || '402 preflight returned unparseable requirements');
    }

    if (policy?.networkAllowlist && policy.networkAllowlist.length > 0 && requirement) {
        const allowedNetwork = policy.networkAllowlist.some((n) => n.toLowerCase() === requirement.network.toLowerCase());
        if (!allowedNetwork) {
            reasons.push(`Network blocked by policy: ${requirement.network}`);
        }
    }

    if (policy?.payToAllowlist && policy.payToAllowlist.length > 0 && requirement) {
        const normalizedPayTo = requirement.payTo.toLowerCase();
        const allowedPayTo = policy.payToAllowlist.some((p) => p.toLowerCase() === normalizedPayTo);
        if (!allowedPayTo) {
            reasons.push(`payTo blocked by policy: ${requirement.payTo}`);
        }
    }

    const candidateMax = parseAtomic(candidate.maxAmountAtomic);
    const policyMax = parseAtomic(policy?.maxAmountAtomic);
    if (candidateMax && policyMax && candidateMax > policyMax) {
        reasons.push(`Candidate maxAmount exceeds policy limit (${candidate.maxAmountAtomic} > ${policyMax.toString()})`);
    }

    if (requirement?.amountAtomic && policyMax && BigInt(requirement.amountAtomic) > policyMax) {
        reasons.push(`Quoted amount exceeds policy limit (${requirement.amountAtomic} > ${policyMax.toString()})`);
    }

    return {
        allowed: reasons.length === 0,
        reasons,
    };
}

function getStats(id: string): ProviderStats {
    return providerStats.get(id) || {
        id,
        calls: 0,
        successes: 0,
        failures: 0,
        avgLatencyMs: 1200,
        schemaPasses: 0,
        qualityScoreAvg: 0.5,
        consecutiveFailures: 0,
        circuitOpenUntil: null,
    };
}

function computeScore(candidate: ProcurementCandidate, policy?: ProcurementPolicy): ProviderScore {
    const policyCheck = evaluateCandidatePolicy(candidate, policy);
    const stats = getStats(candidate.id);
    const calls = Math.max(1, stats.calls);
    const successRate = bounded(stats.successes / calls);
    const schemaRate = bounded(stats.schemaPasses / calls);
    const latencyScore = bounded(1 - stats.avgLatencyMs / 6000);
    const maxAmount = parseAtomic(resolveMaxAmountAtomic(candidate, policy) || '0') || BigInt(0);
    const priceScore = maxAmount > BigInt(0)
        ? bounded(1 - Number(maxAmount) / 1_000_000)
        : 0.5;
    const circuitOpen = isCircuitOpen(stats);

    const baseScore = (0.35 * successRate)
        + (0.15 * schemaRate)
        + (0.2 * stats.qualityScoreAvg)
        + (0.15 * latencyScore)
        + (0.15 * priceScore)
        - (circuitOpen ? 1 : 0);

    const score = policyCheck.allowed ? Number(bounded(baseScore, 0, 1).toFixed(6)) : 0;

    return {
        candidate,
        allowed: policyCheck.allowed && !circuitOpen,
        score,
        reasons: [...policyCheck.reasons, ...(circuitOpen ? ['Circuit breaker is open'] : [])],
        metrics: {
            successRate,
            schemaRate,
            qualityScoreAvg: stats.qualityScoreAvg,
            avgLatencyMs: stats.avgLatencyMs,
            latencyScore,
            priceScore,
            circuitOpen,
        },
    };
}

function toProviderStateRow(stats: ProviderStats): ProcurementProviderStateRow {
    return {
        id: stats.id,
        calls: stats.calls,
        successes: stats.successes,
        failures: stats.failures,
        avgLatencyMs: stats.avgLatencyMs,
        schemaPasses: stats.schemaPasses,
        consecutiveFailures: stats.consecutiveFailures,
        circuitOpenUntil: stats.circuitOpenUntil,
        lastStatus: stats.lastStatus ?? null,
        lastError: stats.lastError ?? null,
        lastSeenAt: stats.lastSeenAt ?? null,
        updatedAt: stats.updatedAt ?? new Date().toISOString(),
    };
}

function updateStats(params: {
    id: string;
    status: number;
    latencyMs: number;
    schemaOk: boolean;
    qualityScore: number;
    success: boolean;
    error?: string;
}): ProviderStats {
    const prev = getStats(params.id);
    const calls = prev.calls + 1;
    const consecutiveFailures = params.success ? 0 : prev.consecutiveFailures + 1;
    const shouldOpenCircuit = !params.success && consecutiveFailures >= Math.max(1, CIRCUIT_FAIL_THRESHOLD);

    const next: ProviderStats = {
        ...prev,
        calls,
        successes: prev.successes + (params.success ? 1 : 0),
        failures: prev.failures + (params.success ? 0 : 1),
        avgLatencyMs: Number((((prev.avgLatencyMs * prev.calls) + params.latencyMs) / calls).toFixed(2)),
        schemaPasses: prev.schemaPasses + (params.schemaOk ? 1 : 0),
        qualityScoreAvg: Number((((prev.qualityScoreAvg * prev.calls) + params.qualityScore) / calls).toFixed(4)),
        consecutiveFailures,
        circuitOpenUntil: shouldOpenCircuit ? new Date(Date.now() + Math.max(30000, CIRCUIT_OPEN_MS)).toISOString() : null,
        lastStatus: params.status,
        lastError: params.error,
        lastSeenAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    providerStats.set(params.id, next);
    void upsertProcurementProviderState(toProviderStateRow(next));
    return next;
}

function pushReceipt(receipt: ProcurementReceipt): void {
    procurementReceipts.unshift(receipt);
    if (procurementReceipts.length > 300) {
        procurementReceipts.length = 300;
    }

    const row: ProcurementReceiptRow = {
        id: receipt.id,
        intent: receipt.intent,
        providerId: receipt.providerId,
        url: receipt.url,
        method: receipt.method,
        status: receipt.status,
        paidAmountAtomic: receipt.paidAmountAtomic,
        responseHash: receipt.responseHash,
        latencyMs: receipt.latencyMs,
        success: receipt.success,
        schemaOk: receipt.schemaOk,
        score: receipt.score,
        txHash: receipt.txHash,
        payTo: receipt.payTo,
        attempt: receipt.attempt,
        error: receipt.error,
        createdAt: receipt.createdAt,
    };

    void logProcurementReceipt(row);
}

async function hydrateProcurementState(): Promise<void> {
    if (hydrated) return;
    if (hydrationPromise) return hydrationPromise;

    hydrationPromise = (async () => {
        const [providerRows, receiptRows] = await Promise.all([
            getProcurementProviderStates(),
            getRecentProcurementReceipts(120),
        ]);

        for (const row of providerRows) {
            providerStats.set(row.id, {
                id: row.id,
                calls: row.calls,
                successes: row.successes,
                failures: row.failures,
                avgLatencyMs: row.avgLatencyMs,
                schemaPasses: row.schemaPasses,
                qualityScoreAvg: 0.5,
                consecutiveFailures: row.consecutiveFailures,
                circuitOpenUntil: row.circuitOpenUntil,
                lastStatus: row.lastStatus ?? undefined,
                lastError: row.lastError ?? undefined,
                lastSeenAt: row.lastSeenAt ?? undefined,
                updatedAt: row.updatedAt ?? undefined,
            });
        }

        for (const row of receiptRows) {
            procurementReceipts.push({
                id: row.id,
                intent: row.intent,
                providerId: row.providerId,
                url: row.url,
                method: row.method,
                status: row.status,
                paidAmountAtomic: row.paidAmountAtomic,
                responseHash: row.responseHash,
                latencyMs: row.latencyMs,
                success: row.success,
                schemaOk: row.schemaOk,
                score: row.score,
                txHash: row.txHash,
                payTo: row.payTo,
                attempt: row.attempt,
                error: row.error,
                createdAt: row.createdAt,
            });
        }

        hydrated = true;
    })();

    await hydrationPromise;
}

export async function ensureProcurementStateReady(): Promise<void> {
    await hydrateProcurementState();
}

export function rankProcurementCandidates(input: {
    intent: string;
    candidates: ProcurementCandidate[];
    policy?: ProcurementPolicy;
}) {
    void hydrateProcurementState();

    const ranked = input.candidates
        .map((candidate) => computeScore(candidate, input.policy))
        .sort((a, b) => b.score - a.score);

    const selected = ranked.find((entry) => entry.allowed) || null;

    return {
        intent: input.intent,
        selected: selected ? {
            id: selected.candidate.id,
            url: selected.candidate.url,
            score: selected.score,
        } : null,
        ranked,
    };
}

export async function executeProcurementIntent(input: {
    intent: string;
    candidates: ProcurementCandidate[];
    policy?: ProcurementPolicy;
}) {
    await hydrateProcurementState();

    const ranking = rankProcurementCandidates(input);
    const candidates = ranking.ranked.filter((entry) => entry.allowed);

    if (candidates.length === 0) {
        throw new Error('No procurement candidates passed policy checks.');
    }

    const maxAttempts = Math.max(1, Math.min(
        input.policy?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
        candidates.length,
    ));

    const attemptErrors: string[] = [];

    for (let i = 0; i < maxAttempts; i += 1) {
        const selected = candidates[i];
        const candidate = selected.candidate;
        const method = normalizeMethod(candidate.method);

        const currentStats = getStats(candidate.id);
        if (isCircuitOpen(currentStats)) {
            attemptErrors.push(`${candidate.id}: circuit breaker open`);
            continue;
        }

        const preflight = await preflightCandidate(candidate);
        const policyCheck = evaluateCandidatePolicy(candidate, input.policy, preflight);

        if (!policyCheck.allowed) {
            const message = `${candidate.id}: ${policyCheck.reasons.join('; ')}`;
            attemptErrors.push(message);
            continue;
        }

        const maxAmountAtomic = resolveMaxAmountAtomic(candidate, input.policy, preflight.requirement);
        const started = Date.now();

        try {
            const paid = await payX402ThroughPinion(candidate.url, {
                method,
                body: candidate.body,
                headers: candidate.headers,
                maxAmountAtomic,
            });

            const latencyMs = Date.now() - started;
            const schemaOk = validateSchema(paid.data, candidate.expectedFields);
            const success = paid.status >= 200 && paid.status < 300;
            const qualityScore = computeQualityScore(paid.data, schemaOk, paid.status);
            const txHash = extractTxHash(paid.data);
            const payTo = preflight.requirement?.payTo || null;

            updateStats({
                id: candidate.id,
                status: paid.status,
                latencyMs,
                schemaOk,
                qualityScore,
                success,
                error: success ? undefined : stringify(paid.data),
            });

            const receipt: ProcurementReceipt = {
                id: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                intent: input.intent,
                providerId: candidate.id,
                url: candidate.url,
                method,
                status: paid.status,
                paidAmountAtomic: paid.paidAmount,
                responseHash: hashResponse(paid.data),
                latencyMs,
                success,
                schemaOk,
                score: selected.score,
                txHash,
                payTo,
                attempt: i + 1,
                error: success ? null : stringify(paid.data),
                createdAt: new Date().toISOString(),
            };

            pushReceipt(receipt);

            if (!success) {
                attemptErrors.push(`${candidate.id}: paid call failed with status ${paid.status}`);
                continue;
            }

            return {
                ranking,
                selected: {
                    id: candidate.id,
                    url: candidate.url,
                    score: selected.score,
                },
                receipt,
                schemaOk,
                response: paid.data,
                status: paid.status,
                paidAmountAtomic: paid.paidAmount,
            };
        } catch (error) {
            const latencyMs = Date.now() - started;
            const errMessage = (error as Error).message;
            updateStats({
                id: candidate.id,
                status: 599,
                latencyMs,
                schemaOk: false,
                qualityScore: 0,
                success: false,
                error: errMessage,
            });

            const receipt: ProcurementReceipt = {
                id: `proc-failed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                intent: input.intent,
                providerId: candidate.id,
                url: candidate.url,
                method,
                status: 599,
                paidAmountAtomic: '0',
                responseHash: hashResponse({ error: errMessage }),
                latencyMs,
                success: false,
                schemaOk: false,
                score: selected.score,
                txHash: null,
                payTo: preflight.requirement?.payTo || null,
                attempt: i + 1,
                error: errMessage,
                createdAt: new Date().toISOString(),
            };

            pushReceipt(receipt);
            attemptErrors.push(`${candidate.id}: ${errMessage}`);
        }
    }

    throw new Error(`All procurement candidates failed. ${attemptErrors.join(' | ')}`);
}

export function getProcurementState() {
    const providers = Array.from(providerStats.values())
        .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));

    return {
        providers,
        receipts: procurementReceipts.slice(0, 100),
        hydrated,
    };
}
