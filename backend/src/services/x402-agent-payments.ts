/**
 * x402 Agent-to-Agent Payments (Gasless Version)
 * 
 * This uses the x402 protocol for gasless micropayments.
 * Payment functions call x402-protected seller endpoints which:
 * 1. Return 402 Payment Required
 * 2. GatewayClient signs payment intent
 * 3. Endpoint verifies + settles with Gateway
 * 4. Returns data
 * 
 * Benefits:
 * - Zero gas per query
 * - Real settlement via Circle Gateway
 * - Funds transferred to agent Gateway balances
 */

import { GatewayClient } from '@circlefin/x402-batching/client';
import type { Hex } from 'viem';

// Singleton Gateway client
let gatewayClient: GatewayClient | null = null;

// Base URL for x402 endpoints
const BASE_URL = process.env.X402_BASE_URL || 'http://localhost:3001';

// Payment tracking (for analytics/debugging)
interface PaymentRecord {
    endpoint: string;
    amount: string;
    transaction?: string;
    settledAt: Date;
    success: boolean;
}

const paymentHistory: PaymentRecord[] = [];

// Agent addresses (these receive payments)
// Agent addresses (these receive payments)
const AGENT_ADDRESSES = {
    priceOracle: process.env.ORACLE_X402_ADDRESS || '0xbaFF2E0939f89b53d4caE023078746C2eeA6E2F7',
    chainScout: process.env.SCOUT_X402_ADDRESS || '0xf09bC01bEb00b142071b648c4826Ab48572aEea5',
    nftScout: process.env.NFT_SCOUT_X402_ADDRESS || '0xEb6d935822e643Af37ec7C6a7Bd6136c0036Cd69',
    newsScout: process.env.NEWS_X402_ADDRESS || '0x32a6778E4D6634BaB9e54A9F78ff5D087179a5c4',
    yieldOptimizer: process.env.YIELD_X402_ADDRESS || '0x095691C40335E7Da13ca669EE3A07eB7422e2be3',
    tokenomics: process.env.TOKENOMICS_X402_ADDRESS || '0xc99A4f20E7433d0B6fB48ca805Ffebe989e48Ca6',
    perpStats: process.env.PERP_STATS_X402_ADDRESS || '0x89651811043ba5a04d44b17462d07a0e3cf0565e',
} as const;

// Payment amounts per agent (in USDC)
const AGENT_PRICES = {
    priceOracle: '0.001',
    chainScout: '0.002',
    newsScout: '0.001',
    yieldOptimizer: '0.001',
    tokenomics: '0.02',
    nftScout: '0.02',
    perpStats: '0.02',
} as const;

/**
 * Initialize the x402 Gateway client
 * Must be called once at startup before any payments
 */
export async function initX402Payments(privateKey: Hex): Promise<void> {
    gatewayClient = new GatewayClient({
        chain: 'arcTestnet',
        privateKey,
    });

    const balances = await gatewayClient.getBalances();

    console.log(`[x402 Payments] ✅ Initialized`);
    console.log(`[x402 Payments]    Address: ${gatewayClient.address}`);
    console.log(`[x402 Payments]    Gateway Balance: ${balances.gateway.formattedAvailable} USDC`);

    const available = parseFloat(balances.gateway.formattedAvailable);
    if (available < 1) {
        console.log(`[x402 Payments] ⚠️ Low balance! Run: npx tsx scripts/x402-deposit.ts 10`);
    } else {
        const estimatedQueries = Math.floor(available / 0.002);
        console.log(`[x402 Payments]    Estimated queries: ~${estimatedQueries}`);
    }
}

/**
 * Get current balances
 */
export async function getX402Balance() {
    if (!gatewayClient) throw new Error('[x402] Not initialized');
    return gatewayClient.getBalances();
}

/**
 * Check if x402 payments are ready
 */
export function isX402Ready(): boolean {
    return gatewayClient !== null;
}

/**
 * Get the payer address
 */
export function getPayerAddress(): string | null {
    return gatewayClient?.address || null;
}

/**
 * Pay for a resource via x402 (internal helper)
 * This handles the full 402 flow
 */
async function payForEndpoint(
    endpoint: string,
    agentName: string
): Promise<{ transactionId: string; status: string; amount?: string }> {
    if (!gatewayClient) {
        throw new Error('[x402] Not initialized');
    }

    const url = `${BASE_URL}${endpoint}`;

    try {
        const result = await gatewayClient.pay(url);

        const record: PaymentRecord = {
            endpoint,
            amount: result.formattedAmount,
            transaction: result.transaction,
            settledAt: new Date(),
            success: true,
        };
        paymentHistory.push(record);

        console.log(`[x402] ✅ Paid ${result.formattedAmount} USDC → ${agentName}`);

        return {
            transactionId: result.transaction || `x402-${Date.now()}`,
            status: 'settled',
            amount: result.formattedAmount,
        };
    } catch (error) {
        const record: PaymentRecord = {
            endpoint,
            amount: '0',
            settledAt: new Date(),
            success: false,
        };
        paymentHistory.push(record);

        console.error(`[x402] ❌ Payment failed for ${agentName}:`, (error as Error).message);

        // Return a fallback so the flow doesn't break
        return {
            transactionId: `x402-failed-${Date.now()}`,
            status: 'failed',
        };
    }
}

/**
 * Create a payment to Price Oracle via x402
 * Calls the /api/x402/oracle/price endpoint
 */
export async function createOraclePayment(taskDescription: string): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    // Extract symbol from task description if present
    const symbolMatch = taskDescription.match(/price:(\w+)/i);
    const symbol = symbolMatch?.[1] || 'BTC';

    const result = await payForEndpoint(
        `/api/x402/oracle/price?symbol=${encodeURIComponent(symbol)}`,
        'Price Oracle'
    );

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash: taskDescription,
    };
}

/**
 * Create a payment to Chain Scout via x402
 * Calls the /api/x402/scout/gas endpoint (simplest scout endpoint)
 */
export async function createScoutPayment(taskDescription: string): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    // Use gas endpoint as it's the cheapest ($0.001)
    // For wallet analysis, the actual data comes from local service call
    const result = await payForEndpoint(
        `/api/x402/scout/gas`,
        'Chain Scout'
    );

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash: taskDescription,
    };
}

/**
 * Create a payment to News Scout via x402
 * Calls the /api/x402/news/latest endpoint
 */
export async function createNewsScoutPayment(taskDescription: string): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    const result = await payForEndpoint(
        `/api/x402/news/latest`,
        'News Scout'
    );

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash: taskDescription,
    };
}

/**
 * Create a payment to Yield Optimizer via x402
 * Calls the /api/x402/yield/top endpoint
 */
export async function createYieldOptimizerPayment(taskDescription: string): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    const result = await payForEndpoint(
        `/api/x402/yield/top`,
        'Yield Optimizer'
    );

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash: taskDescription,
    };
}

/**
 * Create a payment to Tokenomics Analyzer via x402
 * Calls the /api/x402/tokenomics/analyze endpoint
 */
export async function createTokenomicsPayment(taskDescription: string): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    // Extract symbol from task description if present
    const symbolMatch = taskDescription.match(/tokenomics:(\w+)/i);
    const symbol = symbolMatch?.[1] || 'ARB';

    const result = await payForEndpoint(
        `/api/x402/tokenomics/analyze?symbol=${encodeURIComponent(symbol)}`,
        'Tokenomics Analyzer'
    );

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash: taskDescription,
    };
}

/**
 * Get payment history
 */
export function getPaymentHistory(): PaymentRecord[] {
    return [...paymentHistory];
}

/**
 * Get total paid (for analytics)
 */
export function getTotalPaid(): number {
    return paymentHistory
        .filter(p => p.success)
        .reduce((sum, p) => sum + parseFloat(p.amount || '0'), 0);
}

/**
 * Get payment count
 */
export function getPaymentCount(): number {
    return paymentHistory.filter(p => p.success).length;
}

// Export addresses for reference
export { AGENT_ADDRESSES, AGENT_PRICES };

/**
 * Create a payment to NFT Scout via x402
 * Calls the /api/x402/scout/nft endpoint
 */
export async function createNftScoutPayment(taskDescription: string): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    // Extract slug from task description if present
    const slugMatch = taskDescription.match(/nft:(\w+)/i);
    const slug = slugMatch?.[1] || 'pudgypenguins';

    const result = await payForEndpoint(
        `/api/x402/scout/nft/${encodeURIComponent(slug)}`,
        'NFT Scout'
    );

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash: taskDescription,
    };
}

/**
 * Create a payment to Perp Stats Agent via x402
 * Calls the /api/x402/perp/markets endpoint
 */
export async function createPerpStatsPayment(taskDescription: string): Promise<{
    transactionId: string;
    status: string;
    taskHash: string;
}> {
    // Default to full market list, but could parse "global" for /perp/global
    const endpoint = taskDescription.includes('global')
        ? '/api/x402/perp/global'
        : '/api/x402/perp/markets';

    const result = await payForEndpoint(
        endpoint,
        'Perp Stats Agent'
    );

    return {
        transactionId: result.transactionId,
        status: result.status,
        taskHash: taskDescription,
    };
}
