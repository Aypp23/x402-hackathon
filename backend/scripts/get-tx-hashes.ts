
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { initCircleClient, getTransactionStatus } from "../src/services/circle-mcp.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

async function run() {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

    if (!apiKey || !entitySecret) {
        console.error("❌ Missing Circle keys");
        process.exit(1);
    }

    initCircleClient(apiKey, entitySecret);

    const txIds = [
        "1e89310b-7711-56e8-9827-252e3b9decf3"  // Latest Escrow Oracle
    ];

    console.log("Resolving Transaction Hashes...");

    for (const id of txIds) {
        try {
            const status = await getTransactionStatus(id);
            console.log(`\nID: ${id}`);
            console.log("Raw Status:", JSON.stringify(status, null, 2));
        } catch (e) {
            console.error(`Failed to fetch ${id}:`, e);
        }
    }
}

run();
