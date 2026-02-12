import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import type { Address } from 'viem';

export type X402AgentId = 'oracle' | 'scout' | 'news' | 'yield' | 'tokenomics' | 'nft' | 'perp';

export const BASE_SEPOLIA_NETWORK = 'eip155:84532';
export const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://www.x402.org/facilitator';
export const X402_BASE_URL = process.env.X402_BASE_URL || 'http://localhost:3001';

interface X402AgentDefinition {
    id: X402AgentId;
    name: string;
    envVar: string;
    fallbackAddress: Address;
    priceUsd: number;
    price: string;
}

export const X402_AGENT_DEFINITIONS: Record<X402AgentId, X402AgentDefinition> = {
    oracle: {
        id: 'oracle',
        name: 'Price Oracle',
        envVar: 'ORACLE_X402_ADDRESS',
        fallbackAddress: '0xbaFF2E0939f89b53d4caE023078746C2eeA6E2F7',
        priceUsd: 0.01,
        price: '$0.01',
    },
    scout: {
        id: 'scout',
        name: 'Chain Scout',
        envVar: 'SCOUT_X402_ADDRESS',
        fallbackAddress: '0xf09bC01bEb00b142071b648c4826Ab48572aEea5',
        priceUsd: 0.01,
        price: '$0.01',
    },
    news: {
        id: 'news',
        name: 'News Scout',
        envVar: 'NEWS_X402_ADDRESS',
        fallbackAddress: '0x32a6778E4D6634BaB9e54A9F78ff5D087179a5c4',
        priceUsd: 0.01,
        price: '$0.01',
    },
    yield: {
        id: 'yield',
        name: 'Yield Optimizer',
        envVar: 'YIELD_X402_ADDRESS',
        fallbackAddress: '0x095691C40335E7Da13ca669EE3A07eB7422e2be3',
        priceUsd: 0.01,
        price: '$0.01',
    },
    tokenomics: {
        id: 'tokenomics',
        name: 'Tokenomics Analyzer',
        envVar: 'TOKENOMICS_X402_ADDRESS',
        fallbackAddress: '0xc99A4f20E7433d0B6fB48ca805Ffebe989e48Ca6',
        priceUsd: 0.02,
        price: '$0.02',
    },
    nft: {
        id: 'nft',
        name: 'NFT Scout',
        envVar: 'NFT_SCOUT_X402_ADDRESS',
        fallbackAddress: '0xEb6d935822e643Af37ec7C6a7Bd6136c0036Cd69',
        priceUsd: 0.02,
        price: '$0.02',
    },
    perp: {
        id: 'perp',
        name: 'Perp Stats',
        envVar: 'PERP_STATS_X402_ADDRESS',
        fallbackAddress: '0x89651811043ba5a04d44b17462d07a0e3cf0565e',
        priceUsd: 0.02,
        price: '$0.02',
    },
};

export const X402_AGENT_IDS = Object.keys(X402_AGENT_DEFINITIONS) as X402AgentId[];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REGISTRY_PATH = path.resolve(__dirname, '../../cdp-wallets.json');

export function getWalletRegistryPath(): string {
    return process.env.X402_CDP_WALLET_REGISTRY_PATH || DEFAULT_REGISTRY_PATH;
}

export function getDefaultSellerAddresses(): Record<X402AgentId, Address> {
    return {
        oracle: (process.env.ORACLE_X402_ADDRESS as Address) || X402_AGENT_DEFINITIONS.oracle.fallbackAddress,
        scout: (process.env.SCOUT_X402_ADDRESS as Address) || X402_AGENT_DEFINITIONS.scout.fallbackAddress,
        news: (process.env.NEWS_X402_ADDRESS as Address) || X402_AGENT_DEFINITIONS.news.fallbackAddress,
        yield: (process.env.YIELD_X402_ADDRESS as Address) || X402_AGENT_DEFINITIONS.yield.fallbackAddress,
        tokenomics: (process.env.TOKENOMICS_X402_ADDRESS as Address) || X402_AGENT_DEFINITIONS.tokenomics.fallbackAddress,
        nft: (process.env.NFT_SCOUT_X402_ADDRESS as Address) || X402_AGENT_DEFINITIONS.nft.fallbackAddress,
        perp: (process.env.PERP_STATS_X402_ADDRESS as Address) || X402_AGENT_DEFINITIONS.perp.fallbackAddress,
    };
}

export function readPersistedSellerAddresses(): Partial<Record<X402AgentId, Address>> {
    const pathToRegistry = getWalletRegistryPath();
    if (!fs.existsSync(pathToRegistry)) {
        return {};
    }

    try {
        const raw = fs.readFileSync(pathToRegistry, 'utf8');
        const parsed = JSON.parse(raw) as {
            sellers?: Partial<Record<X402AgentId, { address: Address }>>;
        };

        const out: Partial<Record<X402AgentId, Address>> = {};
        for (const id of X402_AGENT_IDS) {
            const addr = parsed.sellers?.[id]?.address;
            if (addr) {
                out[id] = addr;
            }
        }

        return out;
    } catch (error) {
        console.warn('[x402] Failed reading persisted wallet registry:', (error as Error).message);
        return {};
    }
}

export function getSellerAddresses(overrides?: Partial<Record<X402AgentId, Address>>): Record<X402AgentId, Address> {
    const defaults = getDefaultSellerAddresses();
    const persisted = readPersistedSellerAddresses();

    return {
        ...defaults,
        ...persisted,
        ...(overrides || {}),
    };
}

export function getAgentPriceUsd(agentId: X402AgentId): number {
    return X402_AGENT_DEFINITIONS[agentId].priceUsd;
}

export function getAgentPrice(agentId: X402AgentId): string {
    return X402_AGENT_DEFINITIONS[agentId].price;
}

export function getAgentName(agentId: X402AgentId): string {
    return X402_AGENT_DEFINITIONS[agentId].name;
}

export function mapEndpointToAgent(endpoint: string): X402AgentId | null {
    if (endpoint.includes('/scout/nft') || endpoint.includes('/scout/search')) return 'nft';
    if (endpoint.includes('/oracle/')) return 'oracle';
    if (endpoint.includes('/scout/')) return 'scout';
    if (endpoint.includes('/news/')) return 'news';
    if (endpoint.includes('/yield/')) return 'yield';
    if (endpoint.includes('/tokenomics/')) return 'tokenomics';
    if (endpoint.includes('/perp/')) return 'perp';
    return null;
}
