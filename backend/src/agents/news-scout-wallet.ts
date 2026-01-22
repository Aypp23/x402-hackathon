/**
 * News Scout Wallet Service
 * Manages the News Scout Agent's Circle Developer-Controlled Wallet
 * 
 * News Scout provides:
 * - Crypto news aggregation from 7 trusted sources
 * - Breaking news alerts
 * - Trending topics with sentiment analysis
 */

import {
    createWalletSet,
    createWallet,
    getWalletBalance,
    listWallets,
    Blockchain
} from "../services/circle-mcp.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLET_CONFIG_PATH = path.resolve(__dirname, "../../agent-wallets.json");

// News Scout wallet configuration
let newsScoutWalletSetId: string | null = null;
let newsScoutWalletId: string | null = null;
let newsScoutWalletAddress: string | null = null;

const NEWS_SCOUT_WALLET_SET_NAME = "NewsScoutAgent";

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
    } catch (e) {
        console.error("Failed to save wallet config:", e);
    }
}

/**
 * Initialize or retrieve the News Scout wallet
 */
export async function initNewsScoutWallet(): Promise<{
    walletId: string;
    address: string;
}> {
    // 1. Try to load from memory
    if (newsScoutWalletId && newsScoutWalletAddress) {
        console.log(`[News Scout] Using existing wallet (memory): ${newsScoutWalletAddress}`);
        return { walletId: newsScoutWalletId, address: newsScoutWalletAddress };
    }

    // 2. Try to load from file
    const walletConfig = loadWalletConfig();
    if (walletConfig.newsScout && walletConfig.newsScout.walletId && walletConfig.newsScout.address) {
        newsScoutWalletSetId = walletConfig.newsScout.walletSetId;
        newsScoutWalletId = walletConfig.newsScout.walletId;
        newsScoutWalletAddress = walletConfig.newsScout.address;
        console.log(`[News Scout] Restored wallet (file): ${newsScoutWalletAddress}`);
        return {
            walletId: newsScoutWalletId!,
            address: newsScoutWalletAddress!
        };
    }

    try {
        // Create a new wallet set for News Scout
        console.log("[News Scout] Creating new wallet set...");
        const walletSetId = await createWalletSet(NEWS_SCOUT_WALLET_SET_NAME);
        newsScoutWalletSetId = walletSetId;

        // Create a wallet on Arc Testnet
        console.log("[News Scout] Creating wallet on Arc Testnet...");
        const wallet = await createWallet(walletSetId, Blockchain.ArcTestnet);

        newsScoutWalletId = wallet.id;
        newsScoutWalletAddress = wallet.address;

        console.log(`[News Scout] ✅ Wallet created!`);
        console.log(`[News Scout] Address: ${wallet.address}`);
        console.log(`[News Scout] ID: ${wallet.id}`);

        // Save to file
        walletConfig.newsScout = {
            walletSetId: newsScoutWalletSetId,
            walletId: newsScoutWalletId,
            address: newsScoutWalletAddress
        };
        saveWalletConfig(walletConfig);

        return {
            walletId: wallet.id,
            address: wallet.address
        };
    } catch (error) {
        console.error("[News Scout] Failed to initialize wallet:", error);
        throw error;
    }
}

/**
 * Get the News Scout wallet ID
 */
export function getNewsScoutWalletId(): string | null {
    return newsScoutWalletId;
}

/**
 * Get the News Scout wallet address
 */
export function getNewsScoutAddress(): string | null {
    return newsScoutWalletAddress;
}

/**
 * Get the News Scout wallet balance
 */
export async function getNewsScoutBalance(): Promise<string> {
    if (!newsScoutWalletId) {
        throw new Error("News Scout wallet not initialized");
    }
    const balance = await getWalletBalance(newsScoutWalletId);
    return JSON.stringify(balance);
}
