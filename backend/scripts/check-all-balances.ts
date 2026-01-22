
import { GatewayClient } from '@circlefin/x402-batching/client';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Convert import.meta.url to __dirname equivalent
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const agents = [
    { name: 'Main Provider', key: process.env.PRIVATE_KEY },
    { name: 'Price Oracle', key: process.env.ORACLE_X402_PRIVATE_KEY },
    { name: 'Chain Scout', key: process.env.SCOUT_X402_PRIVATE_KEY },
    { name: 'News Scout', key: process.env.NEWS_X402_PRIVATE_KEY },
    { name: 'Yield Optimizer', key: process.env.YIELD_X402_PRIVATE_KEY },
    { name: 'Tokenomics', key: process.env.TOKENOMICS_X402_PRIVATE_KEY },
    { name: 'NFT Scout', key: process.env.NFT_SCOUT_X402_PRIVATE_KEY },
];

async function main() {
    console.log('\n📊 Checking x402 Gateway Balances for All Agents...\n');
    console.log('------------------------------------------------------------------------');
    console.log(String('Agent Name').padEnd(20) + String('Gateway Balance').padEnd(20) + String('Address').padEnd(42));
    console.log('------------------------------------------------------------------------');

    for (const agent of agents) {
        if (!agent.key) {
            console.log(agent.name.padEnd(20) + '❌ Missing Key'.padEnd(20));
            continue;
        }

        try {
            const client = new GatewayClient({
                chain: 'arcTestnet',
                privateKey: agent.key as `0x${string}`,
            });

            const balances = await client.getBalances();
            const balanceStr = `${balances.gateway.formattedAvailable} USDC`;

            console.log(
                agent.name.padEnd(20) +
                balanceStr.padEnd(20) +
                client.address
            );
        } catch (error) {
            console.log(agent.name.padEnd(20) + '❌ Error fetching'.padEnd(20) + (error as Error).message);
        }
    }
    console.log('------------------------------------------------------------------------\n');
}

main().catch(console.error);
