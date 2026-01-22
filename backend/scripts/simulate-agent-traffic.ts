
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { initX402Payments, createTokenomicsPayment, createNftScoutPayment } from '../src/services/x402-agent-payments.js';

async function main() {
    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    if (!privateKey) throw new Error("Missing PRIVATE_KEY in .env");

    console.log("Initializing x402 Payments...");
    await initX402Payments(privateKey);

    console.log("\n--- Simulating Tokenomics Traffic ($0.02/req) ---");
    // Target: > $0.25 (13 requests = $0.26)
    for (let i = 1; i <= 14; i++) {
        console.log(`[Tokenomics] Request ${i}/14...`);
        try {
            const res = await createTokenomicsPayment(`Analyze tokenomics for TOKEN_${i}`);
            console.log(` -> Validated: ${res.status} (TX: ${res.transactionId})`);
        } catch (e) {
            console.error(` -> Failed: ${(e as Error).message}`);
        }
    }

    console.log("\n--- Simulating NFT Scout Traffic ($0.02/req) ---");
    // Target: > $0.25 (13 requests = $0.26)
    const collections = ['pudgypenguins', 'boredapeyachtclub', 'azuki', 'doodles-official', 'cool-cats-nft'];
    for (let i = 1; i <= 14; i++) {
        const slug = collections[i % collections.length];
        console.log(`[NFT Scout] Request ${i}/14 (${slug})...`);
        try {
            const res = await createNftScoutPayment(`Analyze nft:${slug}`);
            console.log(` -> Validated: ${res.status} (TX: ${res.transactionId})`);
        } catch (e) {
            console.error(` -> Failed: ${(e as Error).message}`);
        }
    }
}

main().catch(console.error);
