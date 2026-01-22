/**
 * Chain Scout Wallet Service
 * Manages the Chain Scout Agent's Circle Developer-Controlled Wallet
 * 
 * Chain Scout provides:
 * - Wallet analytics (balance, transactions, labels)
 * - DEX volume data
 * - Whale tracking
 */

import {
    createWalletSet,
    createWallet,
    getWalletBalance,
    transferUSDC,
    listWallets,
    Blockchain
} from "../services/circle-mcp.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLET_CONFIG_PATH = path.resolve(__dirname, "../../agent-wallets.json");

// Chain Scout wallet configuration
let scoutWalletSetId: string | null = null;
let scoutWalletId: string | null = null;
let scoutWalletAddress: string | null = null;

const SCOUT_WALLET_SET_NAME = "ChainScoutAgent";

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
 * Initialize or retrieve the Chain Scout wallet
 */
export async function initScoutWallet(): Promise<{
    walletId: string;
    address: string;
}> {
    // 1. Try to load from memory
    if (scoutWalletId && scoutWalletAddress) {
        console.log(`[Chain Scout] Using existing wallet (memory): ${scoutWalletAddress}`);
        return { walletId: scoutWalletId, address: scoutWalletAddress };
    }

    // 2. Try to load from file
    const walletConfig = loadWalletConfig();
    if (walletConfig.scout && walletConfig.scout.walletId && walletConfig.scout.address) {
        scoutWalletSetId = walletConfig.scout.walletSetId;
        scoutWalletId = walletConfig.scout.walletId;
        scoutWalletAddress = walletConfig.scout.address;
        console.log(`[Chain Scout] Restored wallet (file): ${scoutWalletAddress}`);
        return {
            walletId: scoutWalletId!,
            address: scoutWalletAddress!
        };
    }

    try {
        // Create a new wallet set for Chain Scout
        console.log("[Chain Scout] Creating new wallet set...");
        const walletSetId = await createWalletSet(SCOUT_WALLET_SET_NAME);
        scoutWalletSetId = walletSetId;

        // Create a wallet on Arc Testnet
        console.log("[Chain Scout] Creating wallet on Arc Testnet...");
        const wallet = await createWallet(walletSetId, Blockchain.ArcTestnet);

        scoutWalletId = wallet.id;
        scoutWalletAddress = wallet.address;

        console.log(`[Chain Scout] ✅ Wallet created!`);
        console.log(`[Chain Scout] Address: ${wallet.address}`);
        console.log(`[Chain Scout] ID: ${wallet.id}`);

        // Save to file
        walletConfig.scout = {
            walletSetId: scoutWalletSetId,
            walletId: scoutWalletId,
            address: scoutWalletAddress
        };
        saveWalletConfig(walletConfig);

        return {
            walletId: wallet.id,
            address: wallet.address,
        };
    } catch (error) {
        console.error("[Chain Scout] Failed to initialize wallet:", error);
        throw error;
    }
}

/**
 * Get the Chain Scout wallet address
 */
export function getScoutAddress(): string | null {
    return scoutWalletAddress;
}

/**
 * Get the Chain Scout wallet ID
 */
export function getScoutWalletId(): string | null {
    return scoutWalletId;
}

/**
 * Get the Chain Scout wallet USDC balance
 */
export async function getScoutBalance(): Promise<{
    balance: string;
    address: string | null;
}> {
    if (!scoutWalletId) {
        return { balance: "0", address: null };
    }

    try {
        const balanceData = await getWalletBalance(scoutWalletId);

        const usdcBalance = balanceData.tokenBalances.find(
            (b) => b.token.symbol === "USDC" || b.token.symbol === "USD"
        );

        return {
            balance: usdcBalance?.amount || "0",
            address: scoutWalletAddress,
        };
    } catch (error) {
        console.error("[Chain Scout] Failed to get balance:", error);
        return { balance: "0", address: scoutWalletAddress };
    }
}

/**
 * Set wallet IDs manually (for restoring from config/database)
 */
export function setScoutWallet(walletSetId: string, walletId: string, address: string): void {
    scoutWalletSetId = walletSetId;
    scoutWalletId = walletId;
    scoutWalletAddress = address;
    console.log(`[Chain Scout] Restored wallet: ${address}`);
}

/**
 * Get Chain Scout agent info for registration
 */
export function getScoutAgentInfo(): {
    name: string;
    serviceType: string;
    price: bigint;
    address: string | null;
    description: string;
} {
    return {
        name: "Chain Scout",
        serviceType: "analytics",
        price: BigInt(0.002e18), // $0.002 per query (more comprehensive than price oracle)
        address: scoutWalletAddress,
        description: "On-chain analytics: wallet analysis, DEX volume, whale tracking"
    };
}

/**
 * Register the Chain Scout agent on-chain in AgentRegistry
 */
export async function registerScoutAgent(
    agentRegistryAddress: string
): Promise<{ transactionId: string; status: string }> {
    if (!scoutWalletId) {
        throw new Error("Chain Scout wallet not initialized");
    }

    const { executeContractFunction } = await import("../services/circle-mcp.js");

    const agentInfo = getScoutAgentInfo();

    console.log(`[Chain Scout] Registering agent on-chain...`);
    console.log(`[Chain Scout] Name: ${agentInfo.name}`);
    console.log(`[Chain Scout] Service: ${agentInfo.serviceType}`);
    console.log(`[Chain Scout] Price: ${agentInfo.price.toString()}`);
    console.log(`[Chain Scout] Registry: ${agentRegistryAddress}`);

    // Call registerAgent(name, serviceType, pricePerTask)
    const result = await executeContractFunction(
        scoutWalletId,
        agentRegistryAddress,
        "registerAgent(string,string,uint256)",
        [agentInfo.name, agentInfo.serviceType, agentInfo.price]
    );

    console.log(`[Chain Scout] Registration tx: ${result.transactionId}`);
    return result;
}
