/**
 * x402 Gateway Client Service
 * 
 * Provides a singleton GatewayClient for making x402 payments.
 * Used by gemini.ts to pay for agent services.
 */

import { GatewayClient } from '@circlefin/x402-batching/client';
import type { Hex } from 'viem';

let gatewayClient: GatewayClient | null = null;
let baseUrl = 'http://localhost:3001';

/**
 * Initialize the Gateway client for buying agent services
 */
export function initGatewayClient(privateKey: Hex, serverUrl?: string): void {
    gatewayClient = new GatewayClient({
        chain: 'arcTestnet',
        privateKey,
    });

    if (serverUrl) {
        baseUrl = serverUrl;
    }

    console.log(`[x402 Client] Initialized for buying agent services`);
    console.log(`[x402 Client]   Address: ${gatewayClient.address}`);
    console.log(`[x402 Client]   Base URL: ${baseUrl}`);
}

/**
 * Check if client is initialized
 */
export function isGatewayClientReady(): boolean {
    return gatewayClient !== null;
}

/**
 * Get the gateway client address
 */
export function getGatewayClientAddress(): string | null {
    return gatewayClient?.address || null;
}

/**
 * Pay for a resource via x402
 * This handles the full 402 flow: request → 402 → sign → retry
 */
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
    if (!gatewayClient) {
        throw new Error('[x402 Client] Not initialized. Call initGatewayClient first.');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;

    const fetchOptions: { method?: 'GET' | 'POST'; body?: string; headers?: Record<string, string> } = {};

    if (options?.method) {
        fetchOptions.method = options.method;
    }

    if (options?.body) {
        fetchOptions.body = JSON.stringify(options.body);
        fetchOptions.headers = { 'Content-Type': 'application/json' };
    }

    try {
        const result = await gatewayClient.pay<T>(url, fetchOptions);

        console.log(`[x402 Client] ✅ Paid ${result.formattedAmount} USDC for ${endpoint}`);

        return {
            data: result.data,
            payment: {
                amount: result.formattedAmount,
                transaction: result.transaction,
            },
        };
    } catch (error) {
        console.error(`[x402 Client] ❌ Payment failed for ${endpoint}:`, (error as Error).message);
        throw error;
    }
}

/**
 * Pay for Oracle price data
 */
export async function payForPrice(symbol: string) {
    return payForResource<{ success: boolean; data: { price: number; symbol: string } }>(
        `/api/x402/oracle/price?symbol=${encodeURIComponent(symbol)}`
    );
}

/**
 * Pay for Chain Scout analysis
 */
export async function payForWalletAnalysis(address: string) {
    return payForResource<{ success: boolean; data: unknown }>(
        `/api/x402/scout/analyze?address=${encodeURIComponent(address)}`
    );
}

/**
 * Pay for News search
 */
export async function payForNewsSearch(query: string) {
    return payForResource<{ success: boolean; data: unknown }>(
        `/api/x402/news/search?query=${encodeURIComponent(query)}`
    );
}

/**
 * Pay for Yield optimization
 */
export async function payForYieldSearch(options?: { token?: string; minApy?: number; maxRisk?: string }) {
    const params = new URLSearchParams();
    if (options?.token) params.set('token', options.token);
    if (options?.minApy) params.set('minApy', options.minApy.toString());
    if (options?.maxRisk) params.set('maxRisk', options.maxRisk);

    return payForResource<{ success: boolean; data: unknown }>(
        `/api/x402/yield/best?${params.toString()}`
    );
}

/**
 * Pay for trending news
 */
export async function payForTrendingNews() {
    return payForResource<{ success: boolean; data: unknown }>(
        `/api/x402/news/trending`
    );
}

/**
 * Pay for transaction history
 */
export async function payForTransactionHistory(address: string, limit = 10) {
    return payForResource<{ success: boolean; data: unknown }>(
        `/api/x402/scout/transactions?address=${encodeURIComponent(address)}&limit=${limit}`
    );
}
