
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    initX402Payments,
    createNftScoutPayment
} from '../src/services/x402-agent-payments.js';

// Load env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;

async function main() {
    console.log("🚀 Boosting NFT Scout Earnings...");

    // Initialize Main Provider Gateway Client
    await initX402Payments(PRIVATE_KEY);

    const target = { name: 'NFT Scout ($0.02)', count: 20, fn: () => createNftScoutPayment("nft:pudgypenguins") };

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
        await new Promise(r => setTimeout(r, 200));
    }
    console.log(`\n   ✅ ${success}/${target.count} succeeded.`);
    console.log("\n✨ Done! Wait for Auto-Withdrawal.");
}

main().catch(console.error);
