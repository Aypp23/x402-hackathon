
import { getNewsScoutWalletId, getNewsScoutAgentInfo, initNewsScoutWallet, getNewsScoutBalance } from "../src/agents/news-scout-wallet.js";
import { getWalletBalance, initCircleClient } from "../src/services/circle-mcp.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
    console.log("💰 Verifying News Scout Payment Receipt...\n");

    try {
        if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
            throw new Error("Missing Circle API Key or Entity Secret");
        }

        initCircleClient(process.env.CIRCLE_API_KEY, process.env.CIRCLE_ENTITY_SECRET);
        await initNewsScoutWallet();

        const balanceData = await getNewsScoutBalance();
        // balanceData is a JSON string based on my previous edits
        console.log("Raw News Scout Balance Response:", balanceData);

        const parsed = JSON.parse(balanceData);
        console.log(`\n💳 News Scout Address: ${parsed.address}`);
        console.log(`💵 USDC Balance: ${parsed.balance}`);

        // Check Chat Agent as control
        const { initChatWallet, getChatBalance } = await import("../src/agents/chat-wallet.js");
        await initChatWallet();
        const chatBalance = await getChatBalance();
        console.log(`\nControl Check - Chat Agent Balance: ${chatBalance.balance} (Addr: ${chatBalance.address})`);

    } catch (e) {
        console.error("Error:", e);
    }
}

main();
