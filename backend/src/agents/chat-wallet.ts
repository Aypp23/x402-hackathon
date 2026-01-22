/**
 * Chat Agent Wallet Service
 * Manages the Chat Agent's Circle Developer-Controlled Wallet
 */

import {
    createWalletSet,
    createWallet,
    getWalletBalance,
    transferUSDC,
    executeContractFunction,
    Blockchain
} from "../services/circle-mcp.js";
import { config } from "../config.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WALLET_CONFIG_PATH = path.resolve(__dirname, "../../agent-wallets.json");

// Chat Agent wallet configuration
let chatWalletSetId: string | null = null;
let chatWalletId: string | null = null;
let chatWalletAddress: string | null = null;

const CHAT_WALLET_SET_NAME = "ChatAgent";



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
 * Initialize or retrieve the Chat Agent wallet
 */
export async function initChatWallet(): Promise<{
    walletId: string;
    address: string;
}> {
    // 1. Try to load from memory
    if (chatWalletId && chatWalletAddress) {
        console.log(`[Chat Wallet] Using existing wallet (memory): ${chatWalletAddress}`);
        return { walletId: chatWalletId, address: chatWalletAddress };
    }

    // 2. Try to load from file
    const walletConfig = loadWalletConfig();
    if (walletConfig.chat && walletConfig.chat.walletId && walletConfig.chat.address) {
        chatWalletSetId = walletConfig.chat.walletSetId;
        chatWalletId = walletConfig.chat.walletId;
        chatWalletAddress = walletConfig.chat.address;
        console.log(`[Chat Wallet] Restored wallet (file): ${chatWalletAddress}`);
        return {
            walletId: chatWalletId!,
            address: chatWalletAddress!
        };
    }

    try {
        // Create a new wallet set for the Chat Agent
        console.log("[Chat Wallet] Creating new wallet set...");
        const walletSetId = await createWalletSet(CHAT_WALLET_SET_NAME);
        chatWalletSetId = walletSetId;

        // Create a wallet on Arc Testnet
        console.log("[Chat Wallet] Creating wallet on Arc Testnet...");
        const wallet = await createWallet(walletSetId, Blockchain.ArcTestnet);

        chatWalletId = wallet.id;
        chatWalletAddress = wallet.address;

        console.log(`[Chat Wallet] ✅ Wallet created!`);
        console.log(`[Chat Wallet] Address: ${wallet.address}`);
        console.log(`[Chat Wallet] ID: ${wallet.id}`);

        // Save to file
        walletConfig.chat = {
            walletSetId: chatWalletSetId,
            walletId: chatWalletId,
            address: chatWalletAddress
        };
        saveWalletConfig(walletConfig);

        return {
            walletId: wallet.id,
            address: wallet.address,
        };
    } catch (error) {
        console.error("[Chat Wallet] Failed to initialize wallet:", error);
        throw error;
    }
}

/**
 * Get the Chat Agent wallet address
 */
export function getChatAddress(): string | null {
    return chatWalletAddress;
}

/**
 * Get the Chat Agent wallet ID
 */
export function getChatWalletId(): string | null {
    return chatWalletId;
}

/**
 * Get the Chat Agent wallet USDC balance
 */
export async function getChatBalance(): Promise<{
    balance: string;
    address: string | null;
}> {
    if (!chatWalletId) {
        return { balance: "0", address: null };
    }

    try {
        const balanceData = await getWalletBalance(chatWalletId);

        // Find USDC balance
        const usdcBalance = balanceData.tokenBalances.find(
            (b) => b.token.symbol === "USDC" || b.token.symbol === "USD"
        );

        return {
            balance: usdcBalance?.amount || "0",
            address: chatWalletAddress,
        };
    } catch (error) {
        console.error("[Chat Wallet] Failed to get balance:", error);
        return { balance: "0", address: chatWalletAddress };
    }
}

/**
 * Set wallet IDs manually (for restoring from config/database)
 */
export function setChatWallet(walletSetId: string, walletId: string, address: string): void {
    chatWalletSetId = walletSetId;
    chatWalletId = walletId;
    chatWalletAddress = address;
    console.log(`[Chat Wallet] Restored wallet: ${address}`);
}
