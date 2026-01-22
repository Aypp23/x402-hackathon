
import { getChatWalletId, initChatWallet } from "../src/agents/chat-wallet.js";
import { getWalletTransactions, initCircleClient } from "../src/services/circle-mcp.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
    console.log("💰 Verifying Chat Agent Transaction History...\n");

    try {
        if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
            throw new Error("Missing Circle API Key or Entity Secret");
        }

        initCircleClient(process.env.CIRCLE_API_KEY, process.env.CIRCLE_ENTITY_SECRET);
        await initChatWallet();

        const walletId = getChatWalletId();
        if (!walletId) {
            throw new Error("Chat Wallet ID not found");
        }

        const transactions = await getWalletTransactions(walletId);

        console.log(`Found ${transactions.length} transactions.\n`);

        transactions.slice(0, 10).forEach((tx, i) => {
            console.log(`[${i + 1}] ${tx.transactionType} (${tx.state}) - ${tx.createDate}`);
            console.log(`    Hash: ${tx.txHash}`);
            if (tx.amounts && tx.amounts.length > 0) {
                // Format amounts if possible
                console.log(`    Amounts: ${JSON.stringify(tx.amounts)}`);
            }
            console.log("");
        });

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
