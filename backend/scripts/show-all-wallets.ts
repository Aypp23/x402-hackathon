
import { getChatAddress, initChatWallet } from "../src/agents/chat-wallet.js";
import { getOracleAddress, initOracleWallet } from "../src/agents/oracle-wallet.js";
import { getScoutAddress, initScoutWallet } from "../src/agents/scout-wallet.js";
import { getNewsScoutAddress, initNewsScoutWallet } from "../src/agents/news-scout-wallet.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function main() {
    console.log("🔍 Retrieving Agent Wallet Addresses...\n");

    try {
        // Ensure they are initialized (restores from file if exists)
        await initChatWallet();
        await initOracleWallet();
        await initScoutWallet();
        await initNewsScoutWallet();

        console.log(`🤖 Chat Agent:   ${getChatAddress()}`);
        console.log(`🔮 Price Oracle: ${getOracleAddress()}`);
        console.log(`🕵️ Chain Scout:  ${getScoutAddress()}`);
        console.log(`📰 News Scout:   ${getNewsScoutAddress()}`);

    } catch (e) {
        console.error("Error:", e);
    }
    console.log("\nDone.");
}

main();
