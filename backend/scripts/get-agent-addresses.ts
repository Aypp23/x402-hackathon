
import { initTokenomicsWallet, getTokenomicsAddress } from "../src/agents/tokenomics-wallet.js";
import { initNftScoutWallet, getNftScoutAddress } from "../src/agents/nft-scout-wallet.js";
import { initYieldWallet, getYieldAddress } from "../src/agents/yield-wallet.js";
// Note: Yield wallet shared file but different keys? No, yield-wallet.ts manages Yield Agent.

async function main() {
    console.log("Initializing wallets to fetch addresses...");
    await initTokenomicsWallet();
    await initNftScoutWallet();
    // await initYieldWallet(); // Optional, checking if needed

    console.log("\n--- AGENT ADDRESSES ---");
    console.log(`Tokenomics: ${getTokenomicsAddress()}`);
    console.log(`NFT Scout:  ${getNftScoutAddress()}`);
    console.log("-----------------------\n");
}

main().catch(console.error);
