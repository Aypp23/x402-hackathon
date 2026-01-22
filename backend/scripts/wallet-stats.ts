/**
 * Get wallet stats using Alchemy API - alchemy_getAssetTransfers
 * Based on alchemy.txt documentation
 */

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const WALLET = "0x34676Ff553357C1B2887c6FBaaFa6f9270D6ee92";

async function getFirstTransaction(address: string) {
    // Use alchemy_getAssetTransfers with order: asc to get oldest first
    const response = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "alchemy_getAssetTransfers",
            params: [{
                fromAddress: address,
                category: ["external", "erc20", "erc721", "erc1155"],
                maxCount: "0x1",
                order: "asc",
                withMetadata: true
            }]
        })
    });

    const data = await response.json();

    if (data.result?.transfers?.length > 0) {
        return data.result.transfers[0];
    }

    // Also check toAddress
    const response2 = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "alchemy_getAssetTransfers",
            params: [{
                toAddress: address,
                category: ["external", "erc20", "erc721", "erc1155"],
                maxCount: "0x1",
                order: "asc",
                withMetadata: true
            }]
        })
    });

    const data2 = await response2.json();
    return data2.result?.transfers?.[0] || null;
}

async function getTransactionCount(address: string) {
    const response = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getTransactionCount",
            params: [address, "latest"]
        })
    });

    const data = await response.json();
    return parseInt(data.result, 16);
}

async function main() {
    console.log("=== ALCHEMY API WALLET STATS ===");
    console.log(`Wallet: ${WALLET}`);
    console.log(`API Key: ${ALCHEMY_API_KEY ? "✅ Loaded" : "❌ Missing"}`);
    console.log("");

    // Get first transaction
    console.log("Fetching first transaction (order: asc, withMetadata: true)...");
    const firstTx = await getFirstTransaction(WALLET);

    if (firstTx && firstTx.metadata?.blockTimestamp) {
        const firstTxDate = new Date(firstTx.metadata.blockTimestamp);
        const now = new Date();
        const ageMs = now.getTime() - firstTxDate.getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

        console.log(`\n--- FIRST TRANSACTION ---`);
        console.log(`Block: ${firstTx.blockNum}`);
        console.log(`Timestamp: ${firstTx.metadata.blockTimestamp}`);
        console.log(`Date: ${firstTxDate.toISOString()}`);
        console.log(`Wallet Age: ${ageDays} days`);
        console.log(`Category: ${firstTx.category}`);
        console.log(`Hash: ${firstTx.hash}`);
    } else {
        console.log("Could not find first transaction");
        console.log("Raw response:", JSON.stringify(firstTx, null, 2));
    }

    // Get nonce (tx count)
    const txCount = await getTransactionCount(WALLET);
    console.log(`\n--- TRANSACTION COUNT ---`);
    console.log(`Nonce (ETH Mainnet): ${txCount}`);
}

main().catch(console.error);
