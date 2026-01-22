/**
 * x402 Auto-Refill Service
 * 
 * Automatically monitors Gateway balance and refills from Circle MCP wallet when low.
 * 
 * Flow:
 * 1. Check x402 Gateway balance
 * 2. If below threshold, get Chat Agent Circle wallet balance
 * 3. Transfer USDC from Circle wallet to EOA (0x2BD5A85B...)
 * 4. Wait for transfer confirmation
 * 5. Deposit to Gateway
 * 
 * Usage:
 *   - As script: npx tsx scripts/x402-auto-refill.ts
 *   - As service: imported and started in index.ts
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { GatewayClient } from '@circlefin/x402-batching/client';
import {
    initCircleClient,
    transferUSDC,
    getWalletBalance,
    getTransactionStatus
} from '../src/services/circle-mcp.js';
import { getChatWalletId } from '../src/agents/chat-wallet.js';
import type { Hex } from 'viem';

// Configuration
const CONFIG = {
    // Threshold below which to trigger refill (in USDC)
    lowBalanceThreshold: 5,

    // Amount to refill when triggered (in USDC)
    refillAmount: 20,

    // Check interval in milliseconds (5 minutes)
    checkIntervalMs: 5 * 60 * 1000,

    // EOA address (where x402 deposits are)
    eoaAddress: '0x2BD5A85BFdBFB9B6CD3FB17F552a39E899BFcd40',
};

// Get private key
const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;

if (!PRIVATE_KEY) {
    console.error('❌ PRIVATE_KEY not found in .env');
    process.exit(1);
}

let gatewayClient: GatewayClient | null = null;
let isRefilling = false;

/**
 * Initialize the Gateway client
 */
async function initClient() {
    if (!gatewayClient) {
        gatewayClient = new GatewayClient({
            chain: 'arcTestnet',
            privateKey: PRIVATE_KEY!,
        });
    }
    return gatewayClient;
}

/**
 * Check Gateway balance
 */
async function checkGatewayBalance(): Promise<number> {
    const client = await initClient();
    const balances = await client.getBalances();
    return parseFloat(balances.gateway.formattedAvailable);
}

/**
 * Check Circle MCP wallet balance
 */
async function checkCircleBalance(): Promise<number> {
    const walletId = getChatWalletId();
    if (!walletId) {
        throw new Error('Chat wallet not initialized');
    }

    const balances = await getWalletBalance(walletId);
    const usdcBalance = balances.tokenBalances.find(
        b => b.token.symbol === 'USDC'
    );

    if (!usdcBalance) return 0;

    // Convert from smallest unit to USDC (6 or 18 decimals depending on chain)
    const decimals = usdcBalance.token.decimals;
    return parseFloat(usdcBalance.amount) / Math.pow(10, decimals);
}

/**
 * Transfer USDC from Circle wallet to EOA
 */
async function transferToEOA(amount: number): Promise<string> {
    const walletId = getChatWalletId();
    if (!walletId) {
        throw new Error('Chat wallet not initialized');
    }

    console.log(`[Auto-Refill] Transferring ${amount} USDC from Circle wallet to EOA...`);

    const result = await transferUSDC(
        walletId,
        CONFIG.eoaAddress,
        amount.toString()
    );

    // Wait for transaction to complete
    let attempts = 0;
    while (attempts < 30) {
        const status = await getTransactionStatus(result.transactionId);
        if (status.state === 'COMPLETE') {
            console.log(`[Auto-Refill] ✅ Transfer complete! TxHash: ${status.txHash}`);
            return status.txHash || result.transactionId;
        }
        if (status.state === 'FAILED') {
            throw new Error(`Transfer failed: ${JSON.stringify(status)}`);
        }
        await new Promise(r => setTimeout(r, 2000));
        attempts++;
    }

    throw new Error('Transfer timed out');
}

/**
 * Deposit USDC to Gateway
 */
async function depositToGateway(amount: number): Promise<string> {
    const client = await initClient();

    console.log(`[Auto-Refill] Depositing ${amount} USDC to Gateway...`);

    const result = await client.deposit(amount.toString());
    console.log(`[Auto-Refill] ✅ Deposit complete! TxHash: ${result.depositTxHash}`);

    return result.depositTxHash;
}

/**
 * Check and refill if needed
 */
export async function checkAndRefill(): Promise<{
    refilled: boolean;
    gatewayBalance: number;
    circleBalance: number;
    amountRefilled?: number;
}> {
    if (isRefilling) {
        console.log('[Auto-Refill] Already refilling, skipping...');
        return { refilled: false, gatewayBalance: 0, circleBalance: 0 };
    }

    try {
        isRefilling = true;

        // Check Gateway balance
        const gatewayBalance = await checkGatewayBalance();
        console.log(`[Auto-Refill] Gateway balance: ${gatewayBalance} USDC`);

        if (gatewayBalance >= CONFIG.lowBalanceThreshold) {
            console.log(`[Auto-Refill] Balance OK (threshold: ${CONFIG.lowBalanceThreshold})`);
            return { refilled: false, gatewayBalance, circleBalance: 0 };
        }

        console.log(`[Auto-Refill] ⚠️ Balance below threshold! Starting refill...`);

        // Check Circle wallet balance
        const circleBalance = await checkCircleBalance();
        console.log(`[Auto-Refill] Circle wallet balance: ${circleBalance} USDC`);

        const refillAmount = Math.min(CONFIG.refillAmount, circleBalance);

        if (refillAmount < 1) {
            console.log(`[Auto-Refill] ❌ Insufficient Circle balance to refill`);
            return { refilled: false, gatewayBalance, circleBalance };
        }

        // Step 1: Transfer from Circle to EOA
        await transferToEOA(refillAmount);

        // Wait a moment for the transfer to be indexed
        await new Promise(r => setTimeout(r, 3000));

        // Step 2: Deposit from EOA to Gateway
        await depositToGateway(refillAmount);

        const newBalance = await checkGatewayBalance();
        console.log(`[Auto-Refill] ✅ Refill complete! New Gateway balance: ${newBalance} USDC`);

        return {
            refilled: true,
            gatewayBalance: newBalance,
            circleBalance: circleBalance - refillAmount,
            amountRefilled: refillAmount,
        };

    } catch (error) {
        console.error('[Auto-Refill] ❌ Error:', (error as Error).message);
        return { refilled: false, gatewayBalance: 0, circleBalance: 0 };
    } finally {
        isRefilling = false;
    }
}

/**
 * Start the auto-refill service (runs in background)
 */
export function startAutoRefillService(): NodeJS.Timeout {
    console.log(`[Auto-Refill] 🔄 Service started (check every ${CONFIG.checkIntervalMs / 60000} mins)`);
    console.log(`[Auto-Refill]    Threshold: ${CONFIG.lowBalanceThreshold} USDC`);
    console.log(`[Auto-Refill]    Refill amount: ${CONFIG.refillAmount} USDC`);

    // Initial check after 30 seconds
    setTimeout(() => checkAndRefill(), 30000);

    // Then check periodically
    return setInterval(() => checkAndRefill(), CONFIG.checkIntervalMs);
}

/**
 * Stop the auto-refill service
 */
export function stopAutoRefillService(intervalId: NodeJS.Timeout): void {
    clearInterval(intervalId);
    console.log('[Auto-Refill] Service stopped');
}

// Run as script if executed directly
const isScript = process.argv[1]?.includes('x402-auto-refill');
if (isScript) {
    console.log('\n=== x402 Auto-Refill - Manual Check ===\n');

    // Initialize Circle client
    const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
    const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;

    if (CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET) {
        initCircleClient(CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET);
    }

    checkAndRefill()
        .then(result => {
            console.log('\n📊 Result:', result);
            process.exit(0);
        })
        .catch(err => {
            console.error('Error:', err);
            process.exit(1);
        });
}
