import { createPublicClient, http, parseAbi } from 'viem';
import { sepolia } from 'viem/chains';

const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
const USER_ADDRESS = '0x2bd5a85bfdbfb9b6cd3fb17f552a39e899bfcd40';

async function checkBalance() {
    const client = createPublicClient({
        chain: sepolia,
        transport: http('https://ethereum-sepolia.publicnode.com')
    });

    const abi = parseAbi([
        'function balanceOf(address owner) view returns (uint256)',
        'function decimals() view returns (uint8)'
    ]);

    try {
        const [balance, decimals] = await Promise.all([
            client.readContract({
                address: USDC_SEPOLIA,
                abi,
                functionName: 'balanceOf',
                args: [USER_ADDRESS]
            }),
            client.readContract({
                address: USDC_SEPOLIA,
                abi,
                functionName: 'decimals'
            })
        ]);

        const formatted = Number(balance) / (10 ** decimals);
        console.log(`User Address: ${USER_ADDRESS}`);
        console.log(`USDC Balance (Sepolia): ${formatted}`);
        console.log(`Raw Balance: ${balance}`);
    } catch (e) {
        console.error("Error fetching balance:", e);
    }
}

checkBalance();
