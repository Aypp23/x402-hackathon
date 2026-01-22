/**
 * Check Agent Gateway Balances
 * 
 * This script checks the Gateway balance for each agent.
 * 
 * Usage:
 *   npx tsx scripts/check-agent-balances.ts
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { GatewayClient } from '@circlefin/x402-batching/client';
import type { Hex } from 'viem';

// Agent private keys from env
const AGENTS = [
    { name: 'Price Oracle', envKey: 'ORACLE_X402_PRIVATE_KEY' },
    { name: 'Chain Scout', envKey: 'SCOUT_X402_PRIVATE_KEY' },
    { name: 'News Scout', envKey: 'NEWS_X402_PRIVATE_KEY' },
    { name: 'Yield Optimizer', envKey: 'YIELD_X402_PRIVATE_KEY' },
    { name: 'Tokenomics', envKey: 'TOKENOMICS_X402_PRIVATE_KEY' },
];

async function main() {
    console.log('\n=== Agent Gateway Balances ===\n');

    let totalGateway = 0;
    let totalWallet = 0;

    for (const agent of AGENTS) {
        const privateKey = process.env[agent.envKey] as Hex | undefined;

        if (!privateKey) {
            console.log(`❌ ${agent.name}: Missing ${agent.envKey}`);
            continue;
        }

        try {
            const client = new GatewayClient({
                chain: 'arcTestnet',
                privateKey,
            });

            const balances = await client.getBalances();
            const gatewayBalance = parseFloat(balances.gateway.formattedAvailable);
            const walletBalance = parseFloat(balances.wallet.formatted);

            totalGateway += gatewayBalance;
            totalWallet += walletBalance;

            const status = gatewayBalance >= 0.25 ? '🔔 WITHDRAWABLE' : '';

            console.log(`📊 ${agent.name}`);
            console.log(`   Address: ${client.address}`);
            console.log(`   Gateway: ${gatewayBalance.toFixed(4)} USDC ${status}`);
            console.log(`   Wallet:  ${walletBalance.toFixed(4)} USDC`);
            console.log('');
        } catch (error) {
            console.log(`❌ ${agent.name}: ${(error as Error).message}`);
        }
    }

    console.log('─'.repeat(50));
    console.log(`📈 Total Gateway Balance: ${totalGateway.toFixed(4)} USDC`);
    console.log(`📈 Total Wallet Balance:  ${totalWallet.toFixed(4)} USDC`);
    console.log('');
    console.log(`💡 Auto-withdraw threshold: $0.25`);
}

main().catch(console.error);
