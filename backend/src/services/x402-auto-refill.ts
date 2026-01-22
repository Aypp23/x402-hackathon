/**
 * x402 Auto-Refill Service
 * 
 * Monitors Gateway balance and automatically refills from Circle MCP wallet when low.
 */

import { GatewayClient } from '@circlefin/x402-batching/client';
import { transferUSDC, getWalletBalance, getTransactionStatus } from './circle-mcp.js';
import { getChatWalletId } from '../agents/chat-wallet.js';
import type { Hex } from 'viem';

// Configuration
const CONFIG = {
    lowBalanceThreshold: 5,    // Trigger refill when below 5 USDC
    refillAmount: 20,          // Amount to transfer (20 USDC)
    checkIntervalMs: 5 * 60 * 1000, // Check every 5 minutes
    eoaAddress: '0x2BD5A85BFdBFB9B6CD3FB17F552a39E899BFcd40',
};

let gatewayClient: GatewayClient | null = null;
let isRefilling = false;
let serviceInterval: NodeJS.Timeout | null = null;

/**
 * Initialize the Gateway client for auto-refill
 */
export function initAutoRefillClient(privateKey: Hex) {
    gatewayClient = new GatewayClient({
        chain: 'arcTestnet',
        privateKey,
    });
}

/**
 * Check Gateway balance
 */
async function checkGatewayBalance(): Promise<number> {
    if (!gatewayClient) return 0;
    const balances = await gatewayClient.getBalances();
    return parseFloat(balances.gateway.formattedAvailable);
}

/**
 * Check Circle MCP wallet balance
 */
async function checkCircleBalance(): Promise<number> {
    const walletId = getChatWalletId();
    if (!walletId) return 0;

    try {
        const balances = await getWalletBalance(walletId);
        const usdcBalance = balances.tokenBalances.find(b => b.token.symbol === 'USDC');
        if (!usdcBalance) return 0;

        const decimals = usdcBalance.token.decimals;
        return parseFloat(usdcBalance.amount) / Math.pow(10, decimals);
    } catch {
        return 0;
    }
}

/**
 * Transfer USDC from Circle wallet to EOA
 */
async function transferToEOA(amount: number): Promise<string> {
    const walletId = getChatWalletId();
    if (!walletId) throw new Error('Chat wallet not initialized');

    console.log(`[Auto-Refill] Transferring ${amount} USDC from Circle → EOA...`);

    const result = await transferUSDC(walletId, CONFIG.eoaAddress, amount.toString());

    // Wait for completion
    for (let i = 0; i < 30; i++) {
        const status = await getTransactionStatus(result.transactionId);
        if (status.state === 'COMPLETE') {
            console.log(`[Auto-Refill] ✅ Transfer complete: ${status.txHash}`);
            return status.txHash || result.transactionId;
        }
        if (status.state === 'FAILED') throw new Error('Transfer failed');
        await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error('Transfer timed out');
}

/**
 * Deposit USDC to Gateway
 */
async function depositToGateway(amount: number): Promise<string> {
    if (!gatewayClient) throw new Error('Gateway client not initialized');

    console.log(`[Auto-Refill] Depositing ${amount} USDC to Gateway...`);
    const result = await gatewayClient.deposit(amount.toString());
    console.log(`[Auto-Refill] ✅ Deposit complete: ${result.depositTxHash}`);

    return result.depositTxHash;
}

/**
 * Check and refill if needed
 */
export async function checkAndRefill(): Promise<boolean> {
    if (isRefilling || !gatewayClient) return false;

    try {
        isRefilling = true;

        const gatewayBalance = await checkGatewayBalance();

        if (gatewayBalance >= CONFIG.lowBalanceThreshold) {
            return false;
        }

        console.log(`[Auto-Refill] ⚠️ Low balance (${gatewayBalance} USDC), starting refill...`);

        const circleBalance = await checkCircleBalance();
        const refillAmount = Math.min(CONFIG.refillAmount, circleBalance);

        if (refillAmount < 1) {
            console.log(`[Auto-Refill] ❌ Insufficient Circle balance`);
            return false;
        }

        await transferToEOA(refillAmount);
        await new Promise(r => setTimeout(r, 3000)); // Wait for indexing
        await depositToGateway(refillAmount);

        const newBalance = await checkGatewayBalance();
        console.log(`[Auto-Refill] ✅ Done! New balance: ${newBalance} USDC`);

        return true;

    } catch (error) {
        console.error('[Auto-Refill] ❌', (error as Error).message);
        return false;
    } finally {
        isRefilling = false;
    }
}

/**
 * Start the auto-refill service
 */
export function startAutoRefillService(): void {
    if (serviceInterval) return;

    console.log(`[Auto-Refill] 🔄 Service started (every ${CONFIG.checkIntervalMs / 60000} mins)`);

    // Initial check after 30 seconds
    setTimeout(() => checkAndRefill(), 30000);

    // Periodic checks
    serviceInterval = setInterval(() => checkAndRefill(), CONFIG.checkIntervalMs);
}

/**
 * Stop the auto-refill service
 */
export function stopAutoRefillService(): void {
    if (serviceInterval) {
        clearInterval(serviceInterval);
        serviceInterval = null;
        console.log('[Auto-Refill] Service stopped');
    }
}
