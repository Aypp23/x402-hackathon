import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';

const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

async function inspectMinter() {
    const client = createPublicClient({
        chain: sepolia,
        transport: http('https://ethereum-sepolia.publicnode.com')
    });

    try {
        // 1. Get Local Minter
        const localMinter = await client.readContract({
            address: TOKEN_MESSENGER,
            abi: parseAbi(['function localMinter() view returns (address)']),
            functionName: 'localMinter',
        });
        console.log(`Local Minter: ${localMinter}`);

        // 2. Check burn limits for USDC
        // function burnLimitsPerMessage(address token) view returns (uint256)
        const limit = await client.readContract({
            address: localMinter as `0x${string}`,
            abi: parseAbi(['function burnLimitsPerMessage(address) view returns (uint256)']),
            functionName: 'burnLimitsPerMessage',
            args: [USDC_SEPOLIA]
        });

        console.log(`Burn Limit for USDC: ${formatUnits(limit as bigint, 6)}`);

        if ((limit as bigint) === 0n) {
            console.error("❌ ERROR: Burn limit is 0. Token might not be supported or burning is paused.");
        } else {
            console.log("✅ Burn limit is active.");
        }

    } catch (e: any) {
        console.error("Error:", e.message || e);
    }
}

inspectMinter();
