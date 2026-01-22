
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    initX402Payments,
    createOraclePayment,
    createScoutPayment,
    createNewsScoutPayment,
    createYieldOptimizerPayment,
    createTokenomicsPayment,
    createNftScoutPayment
} from '../src/services/x402-agent-payments.js';

// Load env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;

async function main() {
    console.log("🚀 Boosting ALL Agent Earnings to trigger withdrawals...");

    // Initialize Main Provider Gateway Client
    await initX402Payments(PRIVATE_KEY);

    // Counts (calculated to hit > $0.25 with buffer)
    const TARGETS = [
        { name: 'Price Oracle ($0.01)', count: 30, fn: () => createOraclePayment("price:BTC") },
        { name: 'Chain Scout ($0.01)', count: 20, fn: () => createScoutPayment("scout:gas") }, // Use cheap gas endpoint
        { name: 'News Scout ($0.01)', count: 30, fn: () => createNewsScoutPayment("news:latest") },
        { name: 'Yield ($0.01)', count: 30, fn: () => createYieldOptimizerPayment("yield:top") },
        { name: 'Tokenomics ($0.02)', count: 15, fn: () => createTokenomicsPayment("tokenomics:ARB") },
        { name: 'NFT Scout ($0.02)', count: 20, fn: () => createNftScoutPayment("nft:pudgypenguins") },
    ];

    for (const target of TARGETS) {
        console.log(`\n👉 Boosting ${target.name} with ${target.count} requests...`);

        let success = 0;
        for (let i = 0; i < target.count; i++) {
            try {
                const res = await target.fn();
                if (res.status === 'settled') {
                    process.stdout.write('.');
                    success++;
                } else {
                    process.stdout.write('x');
                }
            } catch (e) {
                process.stdout.write('E');
            }
            // Rate limit delay (200ms)
            await new Promise(r => setTimeout(r, 200));
        }
        console.log(`\n   ✅ ${success}/${target.count} succeeded.`);
    }

    console.log("\n✨ Boost Complete! Check logs for [Auto-Withdraw] triggers in ~5 minutes.");
}

main().catch(console.error);
