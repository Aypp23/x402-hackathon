/**
 * x402 Buyer Client Compatibility Layer
 *
 * Legacy adapter kept for existing imports while the implementation uses
 * Coinbase x402 buyer flow (fetch wrapper + CDP/private-key signer).
 */

import type { Hex } from 'viem';
import {
    initX402Payments,
    isX402Ready,
    getPayerAddress,
    payAndFetch,
    fetchPaidOraclePrice,
    fetchPaidScoutAnalysis,
    fetchPaidNewsSearch,
    fetchPaidYieldTop,
    fetchPaidYieldAsset,
} from './x402-agent-payments.js';

let baseUrl = 'http://localhost:3001';

export async function initGatewayClient(privateKey?: Hex, serverUrl?: string): Promise<void> {
    if (serverUrl) {
        baseUrl = serverUrl;
    }

    await initX402Payments(privateKey);

    console.log('[x402 Client] Initialized for buying agent services');
    console.log(`[x402 Client]   Address: ${getPayerAddress()}`);
    console.log(`[x402 Client]   Base URL: ${baseUrl}`);
}

export function isGatewayClientReady(): boolean {
    return isX402Ready();
}

export function getGatewayClientAddress(): string | null {
    return getPayerAddress();
}

export async function payForResource<T = unknown>(
    endpoint: string,
    options?: {
        method?: 'GET' | 'POST';
        body?: unknown;
    }
): Promise<{
    data: T;
    payment: {
        amount: string;
        transaction?: string;
    };
}> {
    const resolvedEndpoint = endpoint.startsWith('http')
        ? endpoint.replace(baseUrl, '')
        : endpoint;

    const inferredAgent: 'oracle' | 'scout' | 'news' | 'yield' | 'tokenomics' | 'nft' | 'perp' =
        resolvedEndpoint.includes('/oracle/') ? 'oracle'
            : resolvedEndpoint.includes('/news/') ? 'news'
                : resolvedEndpoint.includes('/yield/') ? 'yield'
                    : resolvedEndpoint.includes('/tokenomics/') ? 'tokenomics'
                        : resolvedEndpoint.includes('/perp/') ? 'perp'
                            : resolvedEndpoint.includes('/scout/nft') || resolvedEndpoint.includes('/scout/search') ? 'nft'
                                : 'scout';

    const result = await payAndFetch<T>({
        agentId: inferredAgent,
        endpoint: resolvedEndpoint,
        method: options?.method,
        body: options?.body,
    });

    return {
        data: result.data,
        payment: {
            amount: result.payment.amount,
            transaction: result.payment.txHash || result.payment.receiptRef,
        },
    };
}

export async function payForPrice(symbol: string) {
    return fetchPaidOraclePrice(symbol);
}

export async function payForWalletAnalysis(address: string) {
    return fetchPaidScoutAnalysis(address);
}

export async function payForNewsSearch(query: string) {
    return fetchPaidNewsSearch(query);
}

export async function payForYieldSearch(options?: { token?: string; minApy?: number; maxRisk?: string }) {
    if (options?.token) {
        return fetchPaidYieldAsset(options.token);
    }

    return fetchPaidYieldTop({
        minApy: options?.minApy,
    });
}

export async function payForTrendingNews() {
    return payForResource('/api/x402/news/trending');
}

export async function payForTransactionHistory(address: string, limit = 10) {
    return payForResource(`/api/x402/scout/analyze?address=${encodeURIComponent(address)}&limit=${limit}`);
}
