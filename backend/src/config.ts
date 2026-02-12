import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
    path: path.resolve(__dirname, "../.env"),
    override: process.env.NODE_ENV !== "production",
});

// Shared app configuration
export const config = {
    // Base Sepolia defaults
    chain: {
        id: Number(process.env.CHAIN_ID || 84532),
        name: process.env.CHAIN_NAME || "Base Sepolia",
        rpcUrl: process.env.CHAIN_RPC_URL || "https://sepolia.base.org",
        explorerUrl: process.env.CHAIN_EXPLORER_URL || "https://sepolia.basescan.org",
    },

    // Deployed contracts (override per environment)
    contracts: {
        policyVault: (process.env.POLICY_VAULT_ADDRESS || "0x7062d477c70B1879D826215265b928e51e548e5d") as `0x${string}`,
        escrow: (process.env.ESCROW_ADDRESS || "0x14B5D6E8fE67cAE89f5a78737F86274178cdc6f8") as `0x${string}`,
        agentRegistry: (process.env.AGENT_REGISTRY_ADDRESS || "0xec48D77c949244ef5871555aDA2b657Fa5006c49") as `0x${string}`,
    },

    // Token defaults
    tokens: {
        usdc: (process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`,
        eurc: (process.env.EURC_ADDRESS || "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a") as `0x${string}`,
        usyc: (process.env.USYC_ADDRESS || "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C") as `0x${string}`,
    },

    // Agent Settings
    agent: {
        resellerPrice: BigInt(0.02e18), // $0.02 per query (18 decimals)
        providerPrice: BigInt(0.01e18), // $0.01 per task (18 decimals)
        escrowTimeout: 300, // 5 minutes
    },

    // Gemini API
    gemini: {
        model: "gemini-2.5-flash", // Cutting edge fast model
    },

    // Price Oracle Agent
    oracle: {
        price: BigInt(0.001e18), // $0.001 per query (18 decimals)
        cacheSeconds: 30,
    },
};
