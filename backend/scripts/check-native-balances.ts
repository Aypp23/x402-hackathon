
import { createPublicClient, http, formatEther } from 'viem';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ARC_CHAIN = {
    id: 5042002,
    name: 'Arc Testnet',
    network: 'arc-testnet',
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
    testnet: true,
};

const client = createPublicClient({
    chain: ARC_CHAIN,
    transport: http(),
});

const agents = [
    { name: 'Main Provider', address: process.env.AGENT_ADDRESS || '0x2BD5A85BFdBFB9B6CD3FB17F552a39E899BFcd40' },
    { name: 'Price Oracle', address: process.env.ORACLE_X402_ADDRESS },
    { name: 'Chain Scout', address: process.env.SCOUT_X402_ADDRESS },
    { name: 'News Scout', address: process.env.NEWS_X402_ADDRESS },
    { name: 'Yield Optimizer', address: process.env.YIELD_X402_ADDRESS },
    { name: 'Tokenomics', address: process.env.TOKENOMICS_X402_ADDRESS },
    { name: 'NFT Scout', address: process.env.NFT_SCOUT_X402_ADDRESS },
];

async function main() {
    console.log('\n⛽ Checking Native USDC (Gas) Balances...\n');
    console.log('------------------------------------------------------------------------');
    console.log(String('Agent Name').padEnd(20) + String('Native Balance').padEnd(20) + String('Address').padEnd(42));
    console.log('------------------------------------------------------------------------');

    for (const agent of agents) {
        if (!agent.address) {
            console.log(agent.name.padEnd(20) + '❌ Missing Address'.padEnd(20));
            continue;
        }

        try {
            const balance = await client.getBalance({ address: agent.address as `0x${string}` });
            const balanceStr = `${formatEther(balance)} USDC`;

            console.log(
                agent.name.padEnd(20) +
                balanceStr.padEnd(20) +
                agent.address
            );
        } catch (error) {
            console.log(agent.name.padEnd(20) + '❌ Error fetching'.padEnd(20) + (error as Error).message);
        }
    }
    console.log('------------------------------------------------------------------------\n');
}

main().catch(console.error);
