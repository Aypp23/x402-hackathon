import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

import { GatewayClient } from '@circlefin/x402-batching/client';

// Agent private keys would be needed to check their Gateway balances
// For now, we can check by looking at the Gateway contract

const ORACLE_ADDRESS = '0x14d1ac294a0d86d16362f98dedbded7cac5821f4';

async function main() {
    console.log("=== Agent Gateway Balances ===\n");
    console.log("With x402, payments go to the receiver's Gateway Balance.");
    console.log("The receiver must call withdraw() to move funds to their wallet.\n");
    console.log("Price Oracle Address:", ORACLE_ADDRESS);
    console.log("\nTo check if the Oracle received funds, they would need to:");
    console.log("1. Initialize GatewayClient with their private key");
    console.log("2. Call getBalances() to see their Gateway balance");
    console.log("3. Call withdraw() to move funds to their wallet");
}

main();
