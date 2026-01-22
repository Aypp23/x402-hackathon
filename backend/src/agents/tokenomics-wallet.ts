/**
 * Tokenomics Analyzer Wallet Service
 * Manages the Tokenomics Agent's Circle Developer-Controlled Wallet
 * 
 * Tokenomics Analyzer provides:
 * - Token supply analysis
 * - Vesting schedules
 * - Unlock events
 * - Inflation rates
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

// Tokenomics Analyzer wallet configuration
let tokenomicsWalletSetId: string | null = null;
let tokenomicsWalletId: string | null = null;
let tokenomicsWalletAddress: string | null = null;

const TOKENOMICS_WALLET_SET_NAME = "TokenomicsAnalyzerAgent";

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
 * Initialize or retrieve the Tokenomics Analyzer wallet
 */
export async function initTokenomicsWallet(): Promise<{
    walletId: string;
    address: string;
}> {
    // 1. Try to load from memory
    if (tokenomicsWalletId && tokenomicsWalletAddress) {
        console.log(`[Tokenomics Analyzer] Using existing wallet (memory): ${tokenomicsWalletAddress}`);
        return { walletId: tokenomicsWalletId, address: tokenomicsWalletAddress };
    }

    // 2. Try to load from file
    const walletConfig = loadWalletConfig();
    if (walletConfig.tokenomicsAnalyzer && walletConfig.tokenomicsAnalyzer.walletId && walletConfig.tokenomicsAnalyzer.address) {
        tokenomicsWalletSetId = walletConfig.tokenomicsAnalyzer.walletSetId;
        tokenomicsWalletId = walletConfig.tokenomicsAnalyzer.walletId;
        tokenomicsWalletAddress = walletConfig.tokenomicsAnalyzer.address;
        console.log(`[Tokenomics Analyzer] Restored wallet (file): ${tokenomicsWalletAddress}`);
        return {
            walletId: tokenomicsWalletId!,
            address: tokenomicsWalletAddress!
        };
    }

    try {
        // Create a new wallet set for Tokenomics Analyzer
        console.log("[Tokenomics Analyzer] Creating new wallet set...");
        const walletSetId = await createWalletSet(TOKENOMICS_WALLET_SET_NAME);
        tokenomicsWalletSetId = walletSetId;

        // Create a wallet on Arc Testnet
        console.log("[Tokenomics Analyzer] Creating wallet on Arc Testnet...");
        const wallet = await createWallet(walletSetId, Blockchain.ArcTestnet);

        tokenomicsWalletId = wallet.id;
        tokenomicsWalletAddress = wallet.address;

        console.log(`[Tokenomics Analyzer] ✅ Wallet created!`);
        console.log(`[Tokenomics Analyzer] Address: ${wallet.address}`);
        console.log(`[Tokenomics Analyzer] ID: ${wallet.id}`);

        // Save to file
        walletConfig.tokenomicsAnalyzer = {
            walletSetId: tokenomicsWalletSetId,
            walletId: tokenomicsWalletId,
            address: tokenomicsWalletAddress
        };
        saveWalletConfig(walletConfig);

        return {
            walletId: wallet.id,
            address: wallet.address
        };
    } catch (error) {
        console.error("[Tokenomics Analyzer] Failed to initialize wallet:", error);
        throw error;
    }
}

/**
 * Get the Tokenomics Analyzer wallet ID
 */
export function getTokenomicsWalletId(): string | null {
    return tokenomicsWalletId;
}

/**
 * Get the Tokenomics Analyzer wallet address
 */
export function getTokenomicsAddress(): string | null {
    return tokenomicsWalletAddress;
}

/**
 * Get the Tokenomics Analyzer wallet balance
 */
export async function getTokenomicsBalance(): Promise<string> {
    if (!tokenomicsWalletId) {
        throw new Error("Tokenomics Analyzer wallet not initialized");
    }
    const balance = await getWalletBalance(tokenomicsWalletId);
    return JSON.stringify(balance);
}
