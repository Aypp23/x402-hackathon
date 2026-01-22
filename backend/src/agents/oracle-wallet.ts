/**
 * Oracle Wallet Service
 * Manages the Price Oracle Agent's Circle Developer-Controlled Wallet
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

// Oracle wallet configuration - stored in memory (in production, use database)
let oracleWalletSetId: string | null = null;
let oracleWalletId: string | null = null;
let oracleWalletAddress: string | null = null;

const ORACLE_WALLET_SET_NAME = "PriceOracleAgent";


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
 * Initialize or retrieve the Oracle wallet
 * Creates a new wallet if one doesn't exist
 */
export async function initOracleWallet(): Promise<{
    walletId: string;
    address: string;
}> {
    // 1. Try to load from memory
    if (oracleWalletId && oracleWalletAddress) {
        console.log(`[Oracle Wallet] Using existing wallet (memory): ${oracleWalletAddress}`);
        return { walletId: oracleWalletId, address: oracleWalletAddress };
    }

    // 2. Try to load from file
    const config = loadWalletConfig();
    if (config.oracle && config.oracle.walletId && config.oracle.address) {
        oracleWalletSetId = config.oracle.walletSetId;
        oracleWalletId = config.oracle.walletId;
        oracleWalletAddress = config.oracle.address;
        console.log(`[Oracle Wallet] Restored wallet (file): ${oracleWalletAddress}`);
        return {
            walletId: oracleWalletId!,
            address: oracleWalletAddress!
        };
    }

    try {
        // Create a new wallet set for the Oracle
        console.log("[Oracle Wallet] Creating new wallet set...");
        const walletSetId = await createWalletSet(ORACLE_WALLET_SET_NAME);
        oracleWalletSetId = walletSetId;

        // Create a wallet on Arc Testnet
        console.log("[Oracle Wallet] Creating wallet on Arc Testnet...");
        const wallet = await createWallet(walletSetId, Blockchain.ArcTestnet);

        oracleWalletId = wallet.id;
        oracleWalletAddress = wallet.address;

        console.log(`[Oracle Wallet] ✅ Wallet created!`);
        console.log(`[Oracle Wallet] Address: ${wallet.address}`);

        // Save to file
        config.oracle = {
            walletSetId: oracleWalletSetId,
            walletId: oracleWalletId,
            address: oracleWalletAddress
        };
        saveWalletConfig(config);

        return {
            walletId: wallet.id,
            address: wallet.address,
        };
    } catch (error) {
        console.error("[Oracle Wallet] Failed to initialize wallet:", error);
        throw error;
    }
}

/**
 * Get the Oracle wallet address
 */
export function getOracleAddress(): string | null {
    return oracleWalletAddress;
}

/**
 * Get the Oracle wallet ID
 */
export function getOracleWalletId(): string | null {
    return oracleWalletId;
}

/**
 * Get the Oracle wallet USDC balance
 */
export async function getOracleBalance(): Promise<{
    balance: string;
    address: string | null;
}> {
    if (!oracleWalletId) {
        return { balance: "0", address: null };
    }

    try {
        const balanceData = await getWalletBalance(oracleWalletId);

        // Find USDC balance
        const usdcBalance = balanceData.tokenBalances.find(
            (b) => b.token.symbol === "USDC" || b.token.symbol === "USD"
        );

        return {
            balance: usdcBalance?.amount || "0",
            address: oracleWalletAddress,
        };
    } catch (error) {
        console.error("[Oracle Wallet] Failed to get balance:", error);
        return { balance: "0", address: oracleWalletAddress };
    }
}

/**
 * Withdraw funds from Oracle wallet to a destination address
 */
export async function withdrawOracleFunds(
    amount: string,
    destinationAddress: string
): Promise<{ transactionId: string; status: string }> {
    if (!oracleWalletId) {
        throw new Error("Oracle wallet not initialized");
    }

    console.log(`[Oracle Wallet] Withdrawing ${amount} USDC to ${destinationAddress}`);

    const result = await transferUSDC(oracleWalletId, destinationAddress, amount);

    console.log(`[Oracle Wallet] Withdrawal initiated: ${result.transactionId}`);
    return result;
}

/**
 * Set wallet IDs manually (for restoring from config/database)
 */
export function setOracleWallet(walletSetId: string, walletId: string, address: string): void {
    oracleWalletSetId = walletSetId;
    oracleWalletId = walletId;
    oracleWalletAddress = address;
    console.log(`[Oracle Wallet] Restored wallet: ${address}`);
}

/**
 * Get Oracle agent info for registration
 */
export function getOracleAgentInfo(): {
    name: string;
    price: bigint;
    address: string | null;
} {
    return {
        name: "Price Oracle Agent",
        price: BigInt(0.001e18), // $0.001 per query
        address: oracleWalletAddress,
    };
}

/**
 * Register the Oracle agent on-chain in AgentRegistry
 */
export async function registerOracleAgent(
    agentRegistryAddress: string
): Promise<{ transactionId: string; status: string }> {
    if (!oracleWalletId) {
        throw new Error("Oracle wallet not initialized");
    }

    // Import executeContractFunction dynamically to avoid circular deps
    const { executeContractFunction } = await import("../services/circle-mcp.js");

    const agentInfo = getOracleAgentInfo();

    console.log(`[Oracle Wallet] Registering agent on-chain...`);
    console.log(`[Oracle Wallet] Name: ${agentInfo.name}`);
    console.log(`[Oracle Wallet] Price: ${agentInfo.price.toString()}`);
    console.log(`[Oracle Wallet] Registry: ${agentRegistryAddress}`);

    // Call registerAgent(name, serviceType, pricePerTask)
    const result = await executeContractFunction(
        oracleWalletId,
        agentRegistryAddress,
        "registerAgent(string,string,uint256)",
        [agentInfo.name, "oracle", agentInfo.price]
    );

    console.log(`[Oracle Wallet] Registration tx: ${result.transactionId}`);
    return result;
}

