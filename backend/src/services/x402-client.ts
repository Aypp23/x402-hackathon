/**
 * x402 Gasless Payments Client
 * 
 * Replaces escrow-based micropayments with Circle Gateway gasless intents.
 * Uses the @circlefin/x402-batching SDK for off-chain payment signatures.
 */

import { GatewayClient } from '@circlefin/x402-batching/client';
import type { Hex } from 'viem';
import { config } from '../config.js';

let client: GatewayClient | null = null;

/**
 * Initialize the x402 Gateway client
 * Call this once at startup with the private key
 */
export async function initX402Client(privateKey: Hex): Promise<void> {
    client = new GatewayClient({
        chain: 'arcTestnet',
        privateKey,
    });

    console.log(`[x402] Client initialized`);
    console.log(`[x402]   Address: ${client.address}`);
    console.log(`[x402]   Chain: ${client.chainName}`);

    // Check balances on init
    const balances = await client.getBalances();
    console.log(`[x402]   Wallet USDC: ${balances.wallet.formatted}`);
    console.log(`[x402]   Gateway Available: ${balances.gateway.formattedAvailable}`);

    if (parseFloat(balances.gateway.formattedAvailable) < 0.01) {
        console.log(`[x402] ⚠️ Low Gateway balance! Run deposit script to add funds.`);
    }
}

/**
 * Get the x402 client address
 */
export function getX402Address(): string | null {
    return client?.address || null;
}

/**
 * Get current balances (wallet and Gateway)
 */
export async function getX402Balances() {
    if (!client) throw new Error('[x402] Client not initialized');
    return client.getBalances();
}

/**
 * Deposit USDC from wallet to Gateway
 * This is a one-time on-chain transaction that enables gasless payments
 */
export async function depositToGateway(amount: string) {
    if (!client) throw new Error('[x402] Client not initialized');

    console.log(`[x402] Depositing ${amount} USDC to Gateway...`);
    const result = await client.deposit(amount);
    console.log(`[x402] ✅ Deposited! Tx: ${result.depositTxHash}`);

    return result;
}

/**
 * Pay for a protected resource (gasless!)
 * This signs an off-chain intent and includes it in the request header
 */
export async function payForResource<T = unknown>(url: string, options?: RequestInit) {
    if (!client) throw new Error('[x402] Client not initialized');

    const result = await client.pay<T>(url, options as any);
    console.log(`[x402] ✅ Paid ${result.formattedAmount} USDC`);

    return result;
}

/**
 * Check if a URL supports Gateway batching
 */
export async function supportsGatewayPayment(url: string) {
    if (!client) throw new Error('[x402] Client not initialized');
    return client.supports(url);
}

/**
 * Withdraw USDC from Gateway back to wallet
 */
export async function withdrawFromGateway(amount: string, options?: { chain?: string; recipient?: string }) {
    if (!client) throw new Error('[x402] Client not initialized');

    console.log(`[x402] Withdrawing ${amount} USDC from Gateway...`);
    const result = await client.withdraw(amount, options as any);
    console.log(`[x402] ✅ Withdrawn! Tx: ${result.mintTxHash}`);

    return result;
}

/**
 * Check if the x402 client is initialized and has sufficient balance
 */
export function isX402Ready(): boolean {
    return client !== null;
}
