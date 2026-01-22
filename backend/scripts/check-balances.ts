import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
import { BridgeKit } from '@circle-fin/bridge-kit';
import { createAdapterFromPrivateKey } from '@circle-fin/adapter-viem-v2';

async function checkBalances() {
    console.log('🔍 Checking USDC Balances...\n');

    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
        console.error('❌ PRIVATE_KEY not found in .env');
        process.exit(1);
    }

    const adapter = createAdapterFromPrivateKey({
        privateKey: privateKey as `0x${string}`
    });

    const chains = [
        'Ethereum_Sepolia',
        'Base_Sepolia',
        'Arbitrum_Sepolia',
        'Optimism_Sepolia',
        'Polygon_Amoy_Testnet'
    ];

    for (const chain of chains) {
        try {
            const balanceAction = await adapter.prepareAction(
                'usdc.balanceOf',
                {},
                { chain }
            );
            const balance = await balanceAction.execute();
            const usdcBalance = Number(balance) / 1e6;
            console.log(`${chain}: $${usdcBalance.toFixed(2)} USDC`);
        } catch (e: any) {
            console.log(`${chain}: Error - ${e.message}`);
        }
    }
}

checkBalances();
