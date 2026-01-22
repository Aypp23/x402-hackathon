/**
 * Gateway Service
 * 
 * Circle Gateway allows users to establish a unified USDC balance
 * by depositing USDC to the Gateway Wallet contract on any supported chain.
 * Once deposited, funds can be spent on any destination chain instantly.
 * 
 * Gateway Contracts (Arc Testnet):
 * - GatewayWallet: 0x0077777d7EBA4688BDeF3E311b846F25870A19B9
 * - GatewayMinter: 0x0022222ABE238Cc2C7Bb1f21003F0a260052475B
 * 
 * Supported Source Chains:
 * - Ethereum Sepolia
 * - Base Sepolia
 * - Arbitrum Sepolia
 * - Avalanche Fuji
 * 
 * Destination: Arc Testnet (domain 26)
 */

import { publicClient, createAgentWallet } from "../blockchain.js";
import { config } from "../config.js";
import { parseEther, formatEther, encodeFunctionData } from "viem";

// Gateway contract addresses
const GATEWAY_WALLET = config.gateway.wallet;
const GATEWAY_MINTER = config.gateway.minter;

// USDC addresses on different chains (for reference)
const USDC_ADDRESSES = {
    "ETH-SEPOLIA": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "BASE-SEPOLIA": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "ARB-SEPOLIA": "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    "ARC-TESTNET": "0x3600000000000000000000000000000000000000", // Native
} as const;

// Minimal ERC20 ABI for transfer
const ERC20_ABI = [
    {
        name: "transfer",
        type: "function",
        inputs: [
            { name: "to", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        name: "approve",
        type: "function",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
    },
    {
        name: "balanceOf",
        type: "function",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ name: "", type: "uint256" }],
    },
] as const;

/**
 * Get unified USDC balance for an address
 * This queries the Gateway for the total USDC available across all chains
 * 
 * NOTE: On Arc Testnet, we can check the native balance directly
 * as Gateway deposits appear as native USDC
 */
export async function getUnifiedBalance(address: `0x${string}`): Promise<{
    total: string;
    breakdown: { chain: string; amount: string }[];
}> {
    // For Arc, the unified balance is the native USDC balance
    const balance = await publicClient.getBalance({ address });

    return {
        total: formatEther(balance),
        breakdown: [
            { chain: "ARC-TESTNET", amount: formatEther(balance) },
        ],
    };
}

/**
 * Deposit USDC to Gateway (from Arc Testnet)
 * 
 * On Arc, you deposit native USDC directly to the GatewayWallet contract.
 * This creates a unified balance that can be spent on any supported chain.
 * 
 * @param privateKey Agent's private key
 * @param amount Amount of USDC to deposit (human readable, e.g., "10.0")
 */
export async function depositToGateway(
    privateKey: `0x${string}`,
    amount: string
): Promise<{ txHash: `0x${string}` }> {
    const { account, walletClient } = createAgentWallet(privateKey);

    // Convert to wei (18 decimals for native USDC on Arc)
    const amountWei = parseEther(amount);

    // Send native USDC to Gateway Wallet
    const hash = await walletClient.sendTransaction({
        to: GATEWAY_WALLET,
        value: amountWei,
    });

    // Wait for confirmation
    await publicClient.waitForTransactionReceipt({ hash });

    console.log(`[Gateway] Deposited ${amount} USDC to Gateway. Tx: ${hash}`);

    return { txHash: hash };
}

/**
 * Spend from unified balance (on Arc Testnet)
 * 
 * When you have a unified Gateway balance, you can spend it on any chain.
 * This function enables spending on Arc Testnet.
 * 
 * @param privateKey Agent's private key
 * @param to Destination address
 * @param amount Amount to spend (human readable)
 */
export async function spendFromGateway(
    privateKey: `0x${string}`,
    to: `0x${string}`,
    amount: string
): Promise<{ txHash: `0x${string}` }> {
    const { account, walletClient } = createAgentWallet(privateKey);

    const amountWei = parseEther(amount);

    // On Arc, spending is just a native transfer since Gateway
    // balance IS the native USDC balance
    const hash = await walletClient.sendTransaction({
        to,
        value: amountWei,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    console.log(`[Gateway] Spent ${amount} USDC to ${to}. Tx: ${hash}`);

    return { txHash: hash };
}

/**
 * Check if an address has deposited to Gateway
 */
export async function hasGatewayDeposit(address: `0x${string}`): Promise<boolean> {
    const balance = await publicClient.getBalance({ address });
    return balance > 0n;
}

/**
 * Get Gateway contract addresses
 */
export function getGatewayContracts() {
    return {
        wallet: GATEWAY_WALLET,
        minter: GATEWAY_MINTER,
        domain: 26, // Arc domain
    };
}

/**
 * Cross-chain deposit instructions
 * 
 * To deposit from another chain (e.g., Base Sepolia) to Arc via Gateway:
 * 1. Approve USDC to GatewayWallet on source chain
 * 2. Call depositForBurn on source chain's TokenMessenger
 * 3. Wait for attestation
 * 4. Funds appear on Arc as native USDC
 */
export function getCrossChainDepositInstructions(sourceChain: keyof typeof USDC_ADDRESSES) {
    return {
        steps: [
            `1. Get USDC on ${sourceChain} from Circle Faucet`,
            `2. Approve USDC (${USDC_ADDRESSES[sourceChain]}) to Gateway`,
            `3. Deposit to GatewayWallet (${GATEWAY_WALLET})`,
            `4. Wait for finality (~15 min on ETH, instant on BASE)`,
            `5. Funds appear as native USDC on Arc Testnet`,
        ],
        contracts: {
            sourceUSDC: USDC_ADDRESSES[sourceChain],
            gatewayWallet: GATEWAY_WALLET,
        },
    };
}

/**
 * Verify Gateway contracts are active on the network
 * Verified against Circle MCP Resource: gatewayTransferBalance
 */
export async function checkGatewayStatus(): Promise<{ wallet: boolean; minter: boolean }> {
    try {
        const [walletCode, minterCode] = await Promise.all([
            publicClient.getBytecode({ address: GATEWAY_WALLET }),
            publicClient.getBytecode({ address: GATEWAY_MINTER }),
        ]);

        const walletActive = !!walletCode && walletCode.length > 2;
        const minterActive = !!minterCode && minterCode.length > 2;

        console.log(`[Gateway] Status Check: Wallet=${walletActive}, Minter=${minterActive}`);
        return { wallet: walletActive, minter: minterActive };
    } catch (e) {
        console.error("[Gateway] Status check failed:", e);
        return { wallet: false, minter: false };
    }
}

export { USDC_ADDRESSES, GATEWAY_WALLET, GATEWAY_MINTER };
