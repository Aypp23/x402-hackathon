import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';

// Define Arc Testnet as a custom chain
export const arcTestnet = defineChain({
    id: 5042002,
    name: 'Arc Testnet',
    nativeCurrency: {
        name: 'USDC',
        symbol: 'USDC',
        decimals: 18,
    },
    rpcUrls: {
        default: { http: ['https://rpc.testnet.arc.network'] },
    },
    blockExplorers: {
        default: { name: 'Arc Explorer', url: 'https://explorer.testnet.arc.network' },
    },
    testnet: true,
});

export const wagmiConfig = createConfig({
    chains: [arcTestnet],
    connectors: [
        injected(), // Auto-detects all EIP-6963 wallets (Rabby, MetaMask, Coinbase, etc.)
    ],
    transports: {
        [arcTestnet.id]: http(),
    },
});

declare module 'wagmi' {
    interface Register {
        config: typeof wagmiConfig;
    }
}
