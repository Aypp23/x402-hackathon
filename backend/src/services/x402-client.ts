/**
 * x402 Client Compatibility Layer (Coinbase implementation)
 */

import type { Hex } from 'viem';
import {
    initX402Payments,
    getPayerAddress,
    isX402Ready as isX402PaymentsReady,
    payAndFetch,
    getX402Balance,
} from './x402-agent-payments.js';

export async function initX402Client(privateKey?: Hex): Promise<void> {
    await initX402Payments(privateKey);

    console.log('[x402] Client initialized');
    console.log(`[x402]   Address: ${getPayerAddress()}`);
}

export function getX402Address(): string | null {
    return getPayerAddress();
}

export async function getX402Balances() {
    return getX402Balance();
}

export async function depositToGateway(amount: string) {
    console.warn(`[x402] depositToGateway is deprecated in Coinbase x402 flow. Requested amount: ${amount}`);
    return { success: false, deprecated: true, amount };
}

export async function payForResource<T = unknown>(url: string, options?: RequestInit) {
    const endpoint = url.startsWith('http') ? new URL(url).pathname + new URL(url).search : url;
    const method = (options?.method?.toUpperCase() === 'POST' ? 'POST' : 'GET') as 'GET' | 'POST';
    let parsedBody: unknown;

    if (options?.body) {
        if (typeof options.body === 'string') {
            try {
                parsedBody = JSON.parse(options.body);
            } catch {
                parsedBody = options.body;
            }
        } else {
            parsedBody = options.body;
        }
    }

    return payAndFetch<T>({
        agentId: endpoint.includes('/oracle/') ? 'oracle'
            : endpoint.includes('/news/') ? 'news'
                : endpoint.includes('/yield/') ? 'yield'
                    : endpoint.includes('/tokenomics/') ? 'tokenomics'
                        : endpoint.includes('/perp/') ? 'perp'
                            : endpoint.includes('/scout/nft') || endpoint.includes('/scout/search') ? 'nft'
                                : 'scout',
        endpoint,
        method,
        body: parsedBody,
    });
}

export async function supportsGatewayPayment(url: string) {
    return Boolean(url.includes('/api/x402/'));
}

export async function withdrawFromGateway(amount: string, options?: { chain?: string; recipient?: string }) {
    console.warn(`[x402] withdrawFromGateway is deprecated in Coinbase x402 flow. Requested amount: ${amount}`);
    return { success: false, deprecated: true, amount, options };
}

export function isX402Ready(): boolean {
    return isX402PaymentsReady();
}
