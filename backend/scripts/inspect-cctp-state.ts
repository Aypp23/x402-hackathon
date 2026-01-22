import { createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';

const TOKEN_MESSENGER = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA';
const ARC_DOMAIN = 26;

async function inspectCCTP() {
    const client = createPublicClient({
        chain: sepolia,
        transport: http('https://ethereum-sepolia.publicnode.com')
    });

    try {
        console.log(`Inspecting TokenMessenger at ${TOKEN_MESSENGER}...`);

        // Check RemoteTokenMessenger for Domain 26
        // mapping(uint32 => bytes32) public remoteTokenMessengers;
        const remoteMessenger = await client.readContract({
            address: TOKEN_MESSENGER,
            abi: parseAbi(['function remoteTokenMessengers(uint32) view returns (bytes32)']),
            functionName: 'remoteTokenMessengers',
            args: [ARC_DOMAIN]
        });

        console.log(`Remote TokenMessenger for Domain ${ARC_DOMAIN}: ${remoteMessenger}`);

        if (remoteMessenger === '0x0000000000000000000000000000000000000000000000000000000000000000') {
            console.error("❌ ERROR: Domain 26 is NOT supported/configured on Sepolia TokenMessenger.");
        } else {
            console.log("✅ Domain 26 is configured.");
        }

    } catch (e: any) {
        console.error("Failed to inspect:", e.message || e);
    }
}

inspectCCTP();
