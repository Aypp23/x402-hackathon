import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config.js";

// Import ABIs
import PolicyVaultABI from "./abi/PolicyVault.json" with { type: "json" };
import EscrowABI from "./abi/Escrow.json" with { type: "json" };
import AgentRegistryABI from "./abi/AgentRegistry.json" with { type: "json" };

// Define Arc Testnet chain
const arcTestnet = {
    id: config.chain.id,
    name: config.chain.name,
    nativeCurrency: {
        decimals: 18,
        name: "USDC",
        symbol: "USDC",
    },
    rpcUrls: {
        default: { http: [config.chain.rpcUrl] },
    },
    blockExplorers: {
        default: { name: "ArcScan", url: config.chain.explorerUrl },
    },
} as const;

// Create public client for reading blockchain state
export const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
});

// Create wallet client for signing transactions
export function createAgentWallet(privateKey: `0x${string}`) {
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
        account,
        chain: arcTestnet,
        transport: http(),
    });
    return { account, walletClient };
}

// Contract instances
export const contracts = {
    policyVault: {
        address: config.contracts.policyVault,
        abi: PolicyVaultABI.abi,
    },
    escrow: {
        address: config.contracts.escrow,
        abi: EscrowABI.abi,
    },
    agentRegistry: {
        address: config.contracts.agentRegistry,
        abi: AgentRegistryABI.abi,
    },
};

// Helper functions
export async function getBalance(address: `0x${string}`): Promise<bigint> {
    return publicClient.getBalance({ address });
}

export async function getVaultBalance(): Promise<bigint> {
    return publicClient.readContract({
        ...contracts.policyVault,
        functionName: "getBalance",
    }) as Promise<bigint>;
}

export async function getRemainingDailyLimit(): Promise<bigint> {
    return publicClient.readContract({
        ...contracts.policyVault,
        functionName: "getRemainingDaily",
    }) as Promise<bigint>;
}

export async function isVaultFrozen(): Promise<boolean> {
    return publicClient.readContract({
        ...contracts.policyVault,
        functionName: "frozen",
    }) as Promise<boolean>;
}
