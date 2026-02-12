import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { baseSepolia } from 'viem/chains';

export const appChain = baseSepolia;

export const wagmiConfig = createConfig({
    chains: [appChain],
    connectors: [
        injected(), // Auto-detects all EIP-6963 wallets (Rabby, MetaMask, Coinbase, etc.)
    ],
    transports: {
        [appChain.id]: http(),
    },
});

declare module 'wagmi' {
    interface Register {
        config: typeof wagmiConfig;
    }
}
