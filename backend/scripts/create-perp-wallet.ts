
import {
    createWalletSet,
    createWallet,
    Blockchain,
    initCircleClient
} from "../src/services/circle-mcp.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
const WALLET_CONFIG_PATH = path.resolve(__dirname, "../agent-wallets.json");

const AGENT_KEY = "perpStats";
const WALLET_SET_NAME = "PerpStatsAgent";

// Helper to load wallet config
function loadWalletConfig(): any {
    if (fs.existsSync(WALLET_CONFIG_PATH)) {
        try {
            const data = fs.readFileSync(WALLET_CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        } catch (e) {
            console.error("Failed to parse wallet config:", e);
        }
    }
    return {};
}

// Helper to save wallet config
function saveWalletConfig(config: any) {
    try {
        fs.writeFileSync(WALLET_CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`Saved to ${WALLET_CONFIG_PATH}`);
    } catch (e) {
        console.error("Failed to save wallet config:", e);
    }
}

async function main() {
    console.log(`🚀 Creating Wallet for ${AGENT_KEY}...`);

    if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
        throw new Error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET");
    }

    // Initialize Client
    initCircleClient(process.env.CIRCLE_API_KEY, process.env.CIRCLE_ENTITY_SECRET);

    const config = loadWalletConfig();

    if (config[AGENT_KEY]) {
        console.log(`⚠️ Wallet already exists for ${AGENT_KEY}:`);
        console.log(config[AGENT_KEY]);
        return;
    }

    try {
        console.log(`Creating Wallet Set: ${WALLET_SET_NAME}...`);
        const walletSetId = await createWalletSet(WALLET_SET_NAME);
        console.log(`Wallet Set ID: ${walletSetId}`);

        console.log(`Creating Wallet on Arc Testnet...`);
        const wallet = await createWallet(walletSetId, Blockchain.ArcTestnet);

        console.log(`✅ Wallet Created!`);
        console.log(`Address: ${wallet.address}`);
        console.log(`ID: ${wallet.id}`);

        // Save
        config[AGENT_KEY] = {
            walletSetId,
            walletId: wallet.id,
            address: wallet.address
        };

        saveWalletConfig(config);
        console.log("Don't forget to update .env with PERP_STATS_X402_ADDRESS!");

    } catch (error) {
        console.error("Failed to create wallet:", error);
    }
}

main();
