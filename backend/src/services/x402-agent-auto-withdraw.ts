/**
 * x402 Agent Auto-Withdraw Service
 * 
 * Monitors agent Gateway balances and withdraws earnings to their wallets
 * only when balance exceeds threshold (to optimize for gas costs).
 * 
 * Gas cost on Arc is ~$0.023 USDC per withdrawal, so we wait until
 * balance > $0.25 (10% gas overhead) before withdrawing.
 */

import { GatewayClient } from '@circlefin/x402-batching/client';

// Configuration
const WITHDRAW_THRESHOLD = 0.25; // Only withdraw when balance > $0.25 (10% gas overhead)
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

// Agent private keys (from env)
interface AgentConfig {
    name: string;
    privateKey: `0x${string}` | undefined;
}

function getAgentConfigs(): AgentConfig[] {
    return [
        { name: 'Price Oracle', privateKey: process.env.ORACLE_X402_PRIVATE_KEY as `0x${string}` | undefined },
        { name: 'Chain Scout', privateKey: process.env.SCOUT_X402_PRIVATE_KEY as `0x${string}` | undefined },
        { name: 'NFT Scout', privateKey: process.env.NFT_SCOUT_X402_PRIVATE_KEY as `0x${string}` | undefined },
        { name: 'News Scout', privateKey: process.env.NEWS_X402_PRIVATE_KEY as `0x${string}` | undefined },
        { name: 'Yield Optimizer', privateKey: process.env.YIELD_X402_PRIVATE_KEY as `0x${string}` | undefined },
        { name: 'Tokenomics Analyzer', privateKey: process.env.TOKENOMICS_X402_PRIVATE_KEY as `0x${string}` | undefined },
        { name: 'Universal Perp Stats', privateKey: process.env.PERP_STATS_X402_PRIVATE_KEY as `0x${string}` | undefined },
    ];
}

async function checkAndWithdrawForAgent(name: string, privateKey: `0x${string}`): Promise<void> {
    try {
        const client = new GatewayClient({
            chain: 'arcTestnet',
            privateKey,
        });

        const balances = await client.getBalances();
        // Use 'available' balance (per SDK docs this is usable for payments/withdrawals)
        const available = parseFloat(balances.gateway.formattedAvailable);
        const withdrawable = parseFloat(balances.gateway.formattedWithdrawable);

        if (available >= WITHDRAW_THRESHOLD) {
            // Protocol charges a fee (approx 0.001 USDC). We subtract a safe buffer.
            const buffer = 0.002;
            const amountToWithdraw = (available - buffer);
            const amountString = amountToWithdraw.toFixed(6);

            console.log(`[Auto-Withdraw] ${name}: Withdrawing ${amountString} USDC (Buffer: ${buffer})...`);

            const result = await client.withdraw(amountString);

            console.log(`[Auto-Withdraw] ${name}: ✅ Success! TX: ${result.mintTxHash}`);
            console.log(`[Auto-Withdraw] ${name}:    Amount: ${result.formattedAmount} USDC`);
        } else {
            console.log(`[Auto-Withdraw] ${name}: Available ${available} USDC (Withdrawable: ${withdrawable}, Threshold: ${WITHDRAW_THRESHOLD})`);
        }
    } catch (error) {
        console.error(`[Auto-Withdraw] ${name}: Error - ${(error as Error).message}`);
    }
}

async function runAutoWithdrawCycle(): Promise<void> {
    console.log(`[Auto-Withdraw] Checking agent balances...`);

    const agents = getAgentConfigs();

    for (const agent of agents) {
        if (agent.privateKey) {
            await checkAndWithdrawForAgent(agent.name, agent.privateKey);
        }
    }
}

let withdrawInterval: NodeJS.Timeout | null = null;

export function startAutoWithdraw(): void {
    console.log(`[Auto-Withdraw] 🏧 Service started (threshold: $${WITHDRAW_THRESHOLD}, every ${CHECK_INTERVAL_MS / 60000} mins)`);

    // Run immediately, then on interval
    runAutoWithdrawCycle().catch(console.error);

    withdrawInterval = setInterval(() => {
        runAutoWithdrawCycle().catch(console.error);
    }, CHECK_INTERVAL_MS);
}

export function stopAutoWithdraw(): void {
    if (withdrawInterval) {
        clearInterval(withdrawInterval);
        withdrawInterval = null;
        console.log('[Auto-Withdraw] 🛑 Service stopped');
    }
}

// Export for manual testing
export { runAutoWithdrawCycle, WITHDRAW_THRESHOLD };
