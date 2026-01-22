// Config for Arc Testnet Agent Marketplace
export const config = {
    // Arc Testnet
    chain: {
        id: 5042002,
        name: "Arc Testnet",
        rpcUrl: "https://rpc.testnet.arc.network",
        explorerUrl: "https://explorer.testnet.arc.network",
    },

    // Deployed Contracts (v3 - ERC20 Escrow)
    contracts: {
        policyVault: "0x7062d477c70B1879D826215265b928e51e548e5d" as `0x${string}`,
        escrow: "0x14B5D6E8fE67cAE89f5a78737F86274178cdc6f8" as `0x${string}`,
        agentRegistry: "0xec48D77c949244ef5871555aDA2b657Fa5006c49" as `0x${string}`,
    },

    // Arc Native Tokens
    tokens: {
        usdc: "0x3600000000000000000000000000000000000000" as `0x${string}`, // Native USDC
        eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" as `0x${string}`,
        usyc: "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as `0x${string}`,
    },

    // Gateway Contracts
    gateway: {
        wallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9" as `0x${string}`,
        minter: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B" as `0x${string}`,
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
