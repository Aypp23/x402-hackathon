
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';

// Load env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Arc Testnet Config
const arcTestnet = defineChain({
    id: 5042002, // Arc Testnet (Circle / USDC)
    name: 'Arc Testnet',
    network: 'arc-testnet',
    nativeCurrency: {
        decimals: 18,
        name: 'USDC',
        symbol: 'USDC',
    },
    rpcUrls: {
        default: { http: ['https://rpc.testnet.arc.network'] },
        public: { http: ['https://rpc.testnet.arc.network'] },
    },
});

async function main() {
    const privateKey = process.env.PRIVATE_KEY as `0x${string}`;
    if (!privateKey) throw new Error("Missing PRIVATE_KEY");

    const account = privateKeyToAccount(privateKey);
    const client = createWalletClient({
        account,
        chain: arcTestnet,
        transport: http(),
    });

    console.log(`Funding from: ${account.address}`);

    // Check balance logic (using public client? wallet client can't get balance directly usually? need public client)
    // viem wallet client can't get balance. Need public client.
    // Simpler: just try to send.

    const agents = [
        { name: 'Tokenomics', address: process.env.TOKENOMICS_X402_ADDRESS },
        { name: 'NFT Scout', address: process.env.NFT_SCOUT_X402_ADDRESS },
        // Fund others too just in case
        { name: 'Yield', address: process.env.YIELD_X402_ADDRESS },
        { name: 'Scout', address: process.env.SCOUT_X402_ADDRESS },
        { name: 'News Scout', address: process.env.NEWS_X402_ADDRESS },
        { name: 'Perp Stats', address: process.env.PERP_STATS_X402_ADDRESS },
    ];

    for (const agent of agents) {
        if (!agent.address) {
            console.log(`Skipping ${agent.name} (no address)`);
            continue;
        }
        console.log(`Sending 2.0 ETH/USDC to ${agent.name} (${agent.address})...`);
        try {
            const hash = await client.sendTransaction({
                to: agent.address as `0x${string}`,
                value: parseEther('2.0'),
                kzg: undefined // Viem sometimes complains about blobs if not set?
            });
            console.log(` -> Sent! TX: ${hash}`);
        } catch (e) {
            console.error(` -> Failed: ${(e as Error).message}`);
        }
    }
}

main().catch(console.error);
