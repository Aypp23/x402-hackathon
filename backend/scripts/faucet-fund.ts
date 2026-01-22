
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initCircleClient, requestTestnetTokens, Blockchain } from '../src/services/circle-mcp.js';

// Load env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

    if (!apiKey || !entitySecret) {
        throw new Error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET");
    }

    console.log("Initializing Circle Client...");
    initCircleClient(apiKey, entitySecret);

    const agents = [
        { name: 'Tokenomics', address: process.env.TOKENOMICS_X402_ADDRESS },
        { name: 'NFT Scout', address: process.env.NFT_SCOUT_X402_ADDRESS },
    ];

    for (const agent of agents) {
        if (!agent.address) {
            console.log(`Skipping ${agent.name} (no address)`);
            continue;
        }
        console.log(`Requesting Testnet Tokens for ${agent.name} (${agent.address})...`);
        try {
            // Request both USDC and Native (ETH)
            await requestTestnetTokens(agent.address, Blockchain.ArcTestnet, { usdc: true, native: true });
            console.log(` -> Success!`);
        } catch (e) {
            console.error(` -> Failed: ${(e as Error).message}`);
        }
    }
}

main().catch(console.error);
