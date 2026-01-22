/**
 * Deposit USDC into Circle Gateway for gasless payments
 * 
 * Usage:
 *   npx tsx scripts/x402-deposit.ts [amount]
 * 
 * Example:
 *   npx tsx scripts/x402-deposit.ts 5    # Deposit 5 USDC
 *   npx tsx scripts/x402-deposit.ts      # Deposit 1 USDC (default)
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env from project root (parent of backend/)
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
import { GatewayClient } from '@circlefin/x402-batching/client';
import type { Hex } from 'viem';

const PRIVATE_KEY = process.env.PRIVATE_KEY as Hex | undefined;
const DEPOSIT_AMOUNT = process.argv[2] || '1';

if (!PRIVATE_KEY) {
    console.error('❌ Error: PRIVATE_KEY not found in .env');
    process.exit(1);
}

async function main() {
    console.log('\n=== x402 Gateway Deposit ===\n');

    const gateway = new GatewayClient({
        chain: 'arcTestnet',
        privateKey: PRIVATE_KEY!,
    });

    console.log(`Address: ${gateway.address}`);
    console.log(`Chain: ${gateway.chainName}`);

    // Check balances before
    console.log('\n📊 Current Balances:');
    const before = await gateway.getBalances();
    console.log(`   Wallet USDC: ${before.wallet.formatted}`);
    console.log(`   Gateway Available: ${before.gateway.formattedAvailable}`);

    // Check if we have enough to deposit
    if (parseFloat(before.wallet.formatted) < parseFloat(DEPOSIT_AMOUNT)) {
        console.error(`\n❌ Insufficient USDC balance.`);
        console.error(`   Needed: ${DEPOSIT_AMOUNT} USDC`);
        console.error(`   Available: ${before.wallet.formatted} USDC`);
        console.error(`\n💡 Get testnet USDC from: https://faucet.circle.com (Arc Testnet)`);
        process.exit(1);
    }

    // Deposit
    console.log(`\n💸 Depositing ${DEPOSIT_AMOUNT} USDC to Gateway...`);
    const result = await gateway.deposit(DEPOSIT_AMOUNT);

    if (result.approvalTxHash) {
        console.log(`   Approval Tx: ${result.approvalTxHash}`);
    }
    console.log(`   Deposit Tx: ${result.depositTxHash}`);

    // Check balances after
    console.log('\n📊 Updated Balances:');
    const after = await gateway.getBalances();
    console.log(`   Wallet USDC: ${after.wallet.formatted}`);
    console.log(`   Gateway Available: ${after.gateway.formattedAvailable}`);

    console.log('\n✅ Done! You can now make gasless payments.');
    console.log('   Each agent query will sign off-chain intents (no gas!).\n');
}

main().catch(console.error);
