/**
 * Check x402 Gateway balances
 * 
 * Usage:
 *   npx tsx scripts/x402-check-balance.ts
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (parent of backend/)
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import { GatewayClient } from '@circlefin/x402-batching/client';
import type { Hex } from 'viem';

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;

if (!PRIVATE_KEY) {
    console.error('❌ Error: PRIVATE_KEY not found in .env');
    process.exit(1);
}

async function main() {
    console.log('\n=== x402 Gateway Balance Check ===\n');

    const gateway = new GatewayClient({
        chain: 'arcTestnet',
        privateKey: PRIVATE_KEY!,
    });

    console.log(`Address: ${gateway.address}`);
    console.log(`Chain: ${gateway.chainName}`);

    const balances = await gateway.getBalances();

    console.log('\n📊 Balances:');
    console.log(`   Wallet USDC:       ${balances.wallet.formatted}`);
    console.log(`   Gateway Total:     ${balances.gateway.formattedTotal}`);
    console.log(`   Gateway Available: ${balances.gateway.formattedAvailable}`);

    const available = parseFloat(balances.gateway.formattedAvailable);
    const queryCost = 0.002; // Average cost per agent query
    const estimatedQueries = Math.floor(available / queryCost);

    console.log(`\n💡 Estimated queries remaining: ~${estimatedQueries} (at $${queryCost}/query)`);

    if (available < 0.01) {
        console.log('\n⚠️ Low balance! Run deposit script:');
        console.log('   npx tsx scripts/x402-deposit.ts 5\n');
    } else {
        console.log('');
    }
}

main().catch(console.error);
