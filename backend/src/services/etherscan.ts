/**
 * Etherscan Service - Wallet Analytics
 * Docs: https://docs.etherscan.io
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env relative to this file
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
// V2 API endpoint
const ETHERSCAN_BASE_URL = "https://api.etherscan.io/v2/api";
// Default Chain ID for Ethereum Mainnet
const CHAIN_ID = "1";

// Log status on load
console.log(`[Etherscan] API key ${ETHERSCAN_API_KEY ? "loaded ✅" : "NOT SET ❌"}`);

export interface WalletBalance {
    address: string;
    balance: string;
    balanceFormatted: number;
}

export interface Transaction {
    hash: string;
    from: string;
    to: string;
    value: string;
    valueFormatted: number;
    timestamp: number;
    isError: boolean;
    functionName?: string;
}

export interface TokenTransfer {
    hash: string;
    from: string;
    to: string;
    tokenName: string;
    tokenSymbol: string;
    value: string;
    valueFormatted: number;
    timestamp: number;
}

export interface NFTTransfer {
    hash: string;
    from: string;
    to: string;
    tokenName: string;
    tokenSymbol: string;
    tokenId: string;
    timestamp: number;
}

export interface WalletAnalytics {
    address: string;
    balance: number;
    recentTransactions: Transaction[];
    recentTokenTransfers: TokenTransfer[];
    recentNftTransfers: NFTTransfer[];
    txCount: number;
    firstTxTimestamp?: number;
    fundedBy?: FundedByInfo;
}

export interface FundedByInfo {
    address: string;
    txHash: string;
    value: number;
    timestamp?: number;
}

export interface GasOracle {
    safeGasPrice: number;      // Low (slow)
    proposeGasPrice: number;   // Average
    fastGasPrice: number;      // Fast
    suggestBaseFee: number;    // Base fee
    gasUsedRatio: string;
}

/**
 * Get wallet ETH balance
 */
export async function getWalletBalance(address: string): Promise<WalletBalance | null> {
    if (!ETHERSCAN_API_KEY) return null;

    try {
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=account&action=balance&address=${address}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== "1") throw new Error(data.message || "API error");

        const balanceWei = BigInt(data.result);
        const balanceFormatted = Number(balanceWei) / 1e18;

        return {
            address,
            balance: data.result,
            balanceFormatted
        };
    } catch (error) {
        console.error(`[Etherscan] Error fetching balance for ${address}:`, error);
        return null;
    }
}

/**
 * Get recent transactions for a wallet
 */
export async function getWalletTransactions(address: string, limit: number = 10): Promise<Transaction[] | null> {
    if (!ETHERSCAN_API_KEY) return null;

    try {
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=${limit}&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== "1" && data.message !== "No transactions found") {
            const errorMsg = typeof data.result === 'string' ? `${data.message}: ${data.result}` : (data.message || "API error");
            throw new Error(errorMsg);
        }

        return (data.result || []).map((tx: any) => ({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            value: tx.value,
            valueFormatted: Number(BigInt(tx.value)) / 1e18,
            timestamp: parseInt(tx.timeStamp) * 1000,
            isError: tx.isError === "1",
            functionName: tx.functionName || undefined
        }));
    } catch (error) {
        console.error(`[Etherscan] Error fetching transactions for ${address}:`, error);
        return null;
    }
}

/**
 * Get ERC20 token transfers for a wallet
 */
export async function getTokenTransfers(address: string, limit: number = 10): Promise<TokenTransfer[] | null> {
    if (!ETHERSCAN_API_KEY) return null;

    try {
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=account&action=tokentx&address=${address}&page=1&offset=${limit}&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== "1" && data.message !== "No transactions found") {
            const errorMsg = typeof data.result === 'string' ? `${data.message}: ${data.result}` : data.message;
            throw new Error(errorMsg || "API error");
        }

        return (data.result || []).map((tx: any) => {
            const decimals = parseInt(tx.tokenDecimal) || 18;
            return {
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                tokenName: tx.tokenName,
                tokenSymbol: tx.tokenSymbol,
                value: tx.value,
                valueFormatted: Number(BigInt(tx.value)) / Math.pow(10, decimals),
                timestamp: parseInt(tx.timeStamp) * 1000
            };
        });
    } catch (error) {
        console.error(`[Etherscan] Error fetching token transfers for ${address}:`, error);
        return null;
    }
}

/**
 * Get ERC721 (NFT) transfers for a wallet
 */
export async function getNFTTransfers(address: string, limit: number = 10): Promise<NFTTransfer[] | null> {
    if (!ETHERSCAN_API_KEY) return null;

    try {
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=account&action=tokennfttx&address=${address}&page=1&offset=${limit}&sort=desc&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== "1" && data.message !== "No transactions found") {
            return []; // Gracefully handle if no NFTs found or error
        }

        return (data.result || []).map((tx: any) => ({
            hash: tx.hash,
            from: tx.from,
            to: tx.to,
            tokenName: tx.tokenName,
            tokenSymbol: tx.tokenSymbol,
            tokenId: tx.tokenID,
            timestamp: parseInt(tx.timeStamp) * 1000
        }));
    } catch (error) {
        console.error(`[Etherscan] Error fetching NFT transfers for ${address}:`, error);
        return null;
    }
}

/**
 * Get comprehensive wallet analytics
 */
export async function getWalletAnalytics(address: string): Promise<WalletAnalytics | null> {
    if (!ETHERSCAN_API_KEY) {
        console.error("[Etherscan] API key not set");
        return null;
    }

    try {
        // Batch 1: Core Essentials (Balance & Tx Count) - 2 calls
        const [balance, txCount] = await Promise.all([
            getWalletBalance(address),
            getTxCount(address)
        ]);

        // Rate limit guard (Free tier: 5 req/sec)
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Batch 2: Activity History (Tx List & Fund Origin) - 2 calls
        const [transactions, fundedBy] = await Promise.all([
            getWalletTransactions(address, 10),
            getFundedBy(address)
        ]);

        // Rate limit guard
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Batch 3: Assets (Tokens & NFTs) - 2 calls
        const [tokenTransfers, nftTransfers] = await Promise.all([
            getTokenTransfers(address, 10),
            getNFTTransfers(address, 5)
        ]);

        return {
            address,
            balance: balance?.balanceFormatted || 0,
            recentTransactions: transactions || [],
            recentTokenTransfers: tokenTransfers || [],
            recentNftTransfers: nftTransfers || [],
            txCount: txCount || 0,
            firstTxTimestamp: transactions?.length ? transactions[transactions.length - 1]?.timestamp : undefined,
            fundedBy: fundedBy || undefined
        };
    } catch (error) {
        console.error(`[Etherscan] Error fetching wallet analytics for ${address}:`, error);
        return null;
    }
}

/**
 * Get transaction count for an address
 */
async function getTxCount(address: string): Promise<number> {
    try {
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=proxy&action=eth_getTransactionCount&address=${address}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.result) {
            return parseInt(data.result, 16);
        }
        return 0;
    } catch (error) {
        return 0;
    }
}

/**
 * Check if address is a contract
 */
export async function isContract(address: string): Promise<boolean> {
    if (!ETHERSCAN_API_KEY) return false;

    try {
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=proxy&action=eth_getCode&address=${address}&tag=latest&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        // If code is not "0x", it's a contract
        return data.result && data.result !== "0x";
    } catch (error) {
        return false;
    }
}

/**
 * Get the address that first funded this wallet
 */
export async function getFundedBy(address: string): Promise<FundedByInfo | null> {
    if (!ETHERSCAN_API_KEY) return null;

    try {
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=account&action=fundedby&address=${address}&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== "1") return null;

        const result = data.result;
        return {
            address: result.fundedBy,
            txHash: result.fundingTxn, // Note: field name in response is fundingTxn, matching docs
            value: result.value ? Number(BigInt(result.value)) / 1e18 : 0,
            timestamp: result.timeStamp ? parseInt(result.timeStamp) * 1000 : undefined
        };
    } catch (error) {
        return null;
    }
}

/**
 * Get current gas prices (Gas Oracle)
 */
export async function getGasOracle(): Promise<GasOracle | null> {
    if (!ETHERSCAN_API_KEY) return null;

    try {
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=gastracker&action=gasoracle&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== "1") throw new Error(data.message || "API error");

        return {
            safeGasPrice: parseFloat(data.result.SafeGasPrice),
            proposeGasPrice: parseFloat(data.result.ProposeGasPrice),
            fastGasPrice: parseFloat(data.result.FastGasPrice),
            suggestBaseFee: parseFloat(data.result.suggestBaseFee),
            gasUsedRatio: data.result.gasUsedRatio
        };
    } catch (error) {
        console.error("[Etherscan] Error fetching gas oracle:", error);
        return null;
    }
}

/**
 * Get contract creation info
 */
export async function getContractCreation(addresses: string[]): Promise<{ address: string; creator: string; txHash: string }[] | null> {
    if (!ETHERSCAN_API_KEY) return null;

    try {
        const addressList = addresses.slice(0, 5).join(",");
        const url = `${ETHERSCAN_BASE_URL}?chainid=${CHAIN_ID}&module=contract&action=getcontractcreation&contractaddresses=${addressList}&apikey=${ETHERSCAN_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status !== "1") return null;

        return (data.result || []).map((c: any) => ({
            address: c.contractAddress,
            creator: c.contractCreator,
            txHash: c.txHash
        }));
    } catch (error) {
        console.error("[Etherscan] Error fetching contract creation:", error);
        return null;
    }
}
