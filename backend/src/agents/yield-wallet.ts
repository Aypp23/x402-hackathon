/**
 * Yield Optimizer Wallet Service
 * Manages the Yield Optimizer Agent's Circle Developer-Controlled Wallet
 * 
 * Yield Optimizer provides:
 * - DeFi yield aggregation from Lido, Yearn, Beefy, Curve, Aave, Pendle
 * - APY comparisons across protocols
 * - Risk-based yield recommendations
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

// Yield Optimizer wallet configuration
let yieldWalletSetId: string | null = null;
let yieldWalletId: string | null = null;
let yieldWalletAddress: string | null = null;

const YIELD_WALLET_SET_NAME = "YieldOptimizerAgent";

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
 * Initialize or retrieve the Yield Optimizer wallet
 */
export async function initYieldWallet(): Promise<{
    walletId: string;
    address: string;
}> {
    // 1. Try to load from memory
    if (yieldWalletId && yieldWalletAddress) {
        console.log(`[Yield Optimizer] Using existing wallet (memory): ${yieldWalletAddress}`);
        return { walletId: yieldWalletId, address: yieldWalletAddress };
    }

    // 2. Try to load from file
    const walletConfig = loadWalletConfig();
    if (walletConfig.yieldOptimizer && walletConfig.yieldOptimizer.walletId && walletConfig.yieldOptimizer.address) {
        yieldWalletSetId = walletConfig.yieldOptimizer.walletSetId;
        yieldWalletId = walletConfig.yieldOptimizer.walletId;
        yieldWalletAddress = walletConfig.yieldOptimizer.address;
        console.log(`[Yield Optimizer] Restored wallet (file): ${yieldWalletAddress}`);
        return {
            walletId: yieldWalletId!,
            address: yieldWalletAddress!
        };
    }

    try {
        // Create a new wallet set for Yield Optimizer
        console.log("[Yield Optimizer] Creating new wallet set...");
        const walletSetId = await createWalletSet(YIELD_WALLET_SET_NAME);
        yieldWalletSetId = walletSetId;

        // Create a wallet on Arc Testnet
        console.log("[Yield Optimizer] Creating wallet on Arc Testnet...");
        const wallet = await createWallet(walletSetId, Blockchain.ArcTestnet);

        yieldWalletId = wallet.id;
        yieldWalletAddress = wallet.address;

        console.log(`[Yield Optimizer] ✅ Wallet created!`);
        console.log(`[Yield Optimizer] Address: ${wallet.address}`);
        console.log(`[Yield Optimizer] ID: ${wallet.id}`);

        // Save to file
        walletConfig.yieldOptimizer = {
            walletSetId: yieldWalletSetId,
            walletId: yieldWalletId,
            address: yieldWalletAddress
        };
        saveWalletConfig(walletConfig);

        return {
            walletId: wallet.id,
            address: wallet.address
        };
    } catch (error) {
        console.error("[Yield Optimizer] Failed to initialize wallet:", error);
        throw error;
    }
}

/**
 * Get the Yield Optimizer wallet ID
 */
export function getYieldWalletId(): string | null {
    return yieldWalletId;
}

/**
 * Get the Yield Optimizer wallet address
 */
export function getYieldAddress(): string | null {
    return yieldWalletAddress;
}

/**
 * Get the Yield Optimizer wallet balance
 */
export async function getYieldBalance(): Promise<string> {
    if (!yieldWalletId) {
        throw new Error("Yield Optimizer wallet not initialized");
    }
    const balance = await getWalletBalance(yieldWalletId);
    return JSON.stringify(balance);
}
