// Frontend user payment settings (Base Sepolia)
export const PAYMENT_TOKEN = {
    chainId: 84532,
    symbol: "USDC",
    decimals: 6,
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
    rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org",
} as const;

// User query payments are sent to this backend-controlled receiver.
export const PROVIDER_AGENT_ADDRESS = (import.meta.env.VITE_PROVIDER_PAY_TO || import.meta.env.VITE_ADMIN_ADDRESS || "0x2BD5A85BFdBFB9B6CD3FB17F552a39E899BFcd40") as `0x${string}`;
