/**
 * NFT Scout Wallet Service
 * Manages the NFT Scout Agent's Circle Developer-Controlled Wallet
 * 
 * NFT Scout provides:
 * - NFT collection analytics
 * - Floor price history
 * - Sales volume trends
 */

import {
    createWalletSet,
    createWallet,
    getWalletBalance,
    Blockchain
} from "../services/circle-mcp.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLET_CONFIG_PATH = path.resolve(__dirname, "../../agent-wallets.json");

// NFT Scout wallet configuration
let nftScoutWalletSetId: string | null = null;
let nftScoutWalletId: string | null = null;
let nftScoutWalletAddress: string | null = null;

const NFT_SCOUT_WALLET_SET_NAME = "NftScoutAgent";

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
 * Initialize or retrieve the NFT Scout wallet
 */
export async function initNftScoutWallet(): Promise<{
    walletId: string;
    address: string;
}> {
    // 1. Try to load from memory
    if (nftScoutWalletId && nftScoutWalletAddress) {
        console.log(`[NFT Scout] Using existing wallet (memory): ${nftScoutWalletAddress}`);
        return { walletId: nftScoutWalletId, address: nftScoutWalletAddress };
    }

    // 2. Try to load from file
    const walletConfig = loadWalletConfig();
    if (walletConfig.nftScout && walletConfig.nftScout.walletId && walletConfig.nftScout.address) {
        nftScoutWalletSetId = walletConfig.nftScout.walletSetId;
        nftScoutWalletId = walletConfig.nftScout.walletId;
        nftScoutWalletAddress = walletConfig.nftScout.address;
        console.log(`[NFT Scout] Restored wallet (file): ${nftScoutWalletAddress}`);
        return {
            walletId: nftScoutWalletId!,
            address: nftScoutWalletAddress!
        };
    }

    try {
        // Create a new wallet set for NFT Scout
        console.log("[NFT Scout] Creating new wallet set...");
        const walletSetId = await createWalletSet(NFT_SCOUT_WALLET_SET_NAME);
        nftScoutWalletSetId = walletSetId;

        // Create a wallet on Arc Testnet
        console.log("[NFT Scout] Creating wallet on Arc Testnet...");
        const wallet = await createWallet(walletSetId, Blockchain.ArcTestnet);

        nftScoutWalletId = wallet.id;
        nftScoutWalletAddress = wallet.address;

        console.log(`[NFT Scout] ✅ Wallet created!`);
        console.log(`[NFT Scout] Address: ${wallet.address}`);
        console.log(`[NFT Scout] ID: ${wallet.id}`);

        // Save to file
        walletConfig.nftScout = {
            walletSetId: nftScoutWalletSetId,
            walletId: nftScoutWalletId,
            address: nftScoutWalletAddress
        };
        saveWalletConfig(walletConfig);

        return {
            walletId: wallet.id,
            address: wallet.address
        };
    } catch (error) {
        console.error("[NFT Scout] Failed to initialize wallet:", error);
        throw error;
    }
}

/**
 * Get the NFT Scout wallet ID
 */
export function getNftScoutWalletId(): string | null {
    return nftScoutWalletId;
}

/**
 * Get the NFT Scout wallet address
 */
export function getNftScoutAddress(): string | null {
    return nftScoutWalletAddress;
}

/**
 * Get the NFT Scout wallet balance
 */
export async function getNftScoutBalance(): Promise<string> {
    if (!nftScoutWalletId) {
        throw new Error("NFT Scout wallet not initialized");
    }
    const balance = await getWalletBalance(nftScoutWalletId);
    return JSON.stringify(balance);
}
