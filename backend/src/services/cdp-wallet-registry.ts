import fs from 'fs/promises';
import path from 'path';
import type { Address } from 'viem';
import { CdpClient } from '@coinbase/cdp-sdk';
import {
    X402_AGENT_IDS,
    type X402AgentId,
    X402_AGENT_DEFINITIONS,
    getWalletRegistryPath,
    getSellerAddresses,
} from './x402-common.js';

export interface WalletRecord {
    address: Address;
    accountName: string;
    accountId?: string;
    source: 'env' | 'persisted' | 'cdp';
    createdAt: string;
}

export interface X402WalletRegistry {
    orchestrator?: WalletRecord;
    sellers: Partial<Record<X402AgentId, WalletRecord>>;
    updatedAt: string;
}

interface EnsureWalletRegistryOptions {
    createMissing?: boolean;
}

function isCdpConfigured(): boolean {
    return Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
}

async function loadRegistry(filePath: string): Promise<X402WalletRegistry> {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as X402WalletRegistry;
        return {
            sellers: parsed.sellers || {},
            orchestrator: parsed.orchestrator,
            updatedAt: parsed.updatedAt || new Date().toISOString(),
        };
    } catch {
        return {
            sellers: {},
            updatedAt: new Date().toISOString(),
        };
    }
}

async function saveRegistry(filePath: string, registry: X402WalletRegistry): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(registry, null, 2));
}

async function createCdpAccount(cdp: any, accountName: string): Promise<{ address: Address; accountId?: string }> {
    if (typeof cdp?.evm?.getOrCreateAccount === 'function') {
        const account = await cdp.evm.getOrCreateAccount({ name: accountName });
        return {
            address: account.address as Address,
            accountId: account.id,
        };
    }

    if (typeof cdp?.evm?.createAccount === 'function') {
        try {
            const account = await cdp.evm.createAccount({ name: accountName });
            return {
                address: account.address as Address,
                accountId: account.id,
            };
        } catch {
            const account = await cdp.evm.createAccount();
            return {
                address: account.address as Address,
                accountId: account.id,
            };
        }
    }

    throw new Error('CDP EVM account creation API is unavailable on this SDK version');
}

function readEnvAddress(envVar: string): Address | null {
    const value = process.env[envVar]?.trim();
    if (!value) return null;
    return value as Address;
}

export async function ensureCdpWalletRegistry(
    options: EnsureWalletRegistryOptions = {}
): Promise<X402WalletRegistry> {
    const { createMissing = true } = options;
    const filePath = getWalletRegistryPath();

    const registry = await loadRegistry(filePath);

    for (const agentId of X402_AGENT_IDS) {
        const envVar = X402_AGENT_DEFINITIONS[agentId].envVar;
        const envAddress = readEnvAddress(envVar);

        if (envAddress) {
            registry.sellers[agentId] = {
                address: envAddress,
                accountName: `${agentId}-seller`,
                source: 'env',
                createdAt: registry.sellers[agentId]?.createdAt || new Date().toISOString(),
                accountId: registry.sellers[agentId]?.accountId,
            };
            continue;
        }

        if (registry.sellers[agentId]?.address) {
            registry.sellers[agentId] = {
                ...registry.sellers[agentId],
                source: 'persisted',
            };
            continue;
        }
    }

    const envOrchestrator = readEnvAddress('X402_ORCHESTRATOR_ADDRESS');
    if (envOrchestrator) {
        registry.orchestrator = {
            address: envOrchestrator,
            accountName: 'orchestrator',
            source: 'env',
            createdAt: registry.orchestrator?.createdAt || new Date().toISOString(),
            accountId: registry.orchestrator?.accountId,
        };
    } else if (registry.orchestrator?.address) {
        registry.orchestrator = {
            ...registry.orchestrator,
            source: 'persisted',
        };
    }

    const missingSellerIds = X402_AGENT_IDS.filter((agentId) => !registry.sellers[agentId]?.address);
    const missingOrchestrator = !registry.orchestrator?.address;

    const shouldProvision = createMissing && isCdpConfigured() && (missingSellerIds.length > 0 || missingOrchestrator);

    if (shouldProvision) {
        const cdp = new CdpClient();

        if (missingOrchestrator) {
            const created = await createCdpAccount(cdp, 'arcana-x402-orchestrator');
            registry.orchestrator = {
                address: created.address,
                accountName: 'arcana-x402-orchestrator',
                accountId: created.accountId,
                source: 'cdp',
                createdAt: new Date().toISOString(),
            };
            console.log(`[x402 CDP] Created orchestrator wallet: ${created.address}`);
        }

        for (const agentId of missingSellerIds) {
            const accountName = `arcana-x402-${agentId}-seller`;
            const created = await createCdpAccount(cdp, accountName);
            registry.sellers[agentId] = {
                address: created.address,
                accountName,
                accountId: created.accountId,
                source: 'cdp',
                createdAt: new Date().toISOString(),
            };
            console.log(`[x402 CDP] Created seller wallet (${agentId}): ${created.address}`);
        }
    } else if (createMissing && !isCdpConfigured() && (missingSellerIds.length > 0 || missingOrchestrator)) {
        console.warn('[x402 CDP] Missing CDP_API_KEY_ID/CDP_API_KEY_SECRET. Using existing seller addresses only.');
    }

    registry.updatedAt = new Date().toISOString();
    await saveRegistry(filePath, registry);

    return registry;
}

export async function getSellerAddressMapFromRegistry(): Promise<Record<X402AgentId, Address>> {
    const registry = await ensureCdpWalletRegistry({ createMissing: true });
    const fallback = getSellerAddresses();

    return {
        oracle: registry.sellers.oracle?.address || fallback.oracle,
        scout: registry.sellers.scout?.address || fallback.scout,
        news: registry.sellers.news?.address || fallback.news,
        yield: registry.sellers.yield?.address || fallback.yield,
        tokenomics: registry.sellers.tokenomics?.address || fallback.tokenomics,
        nft: registry.sellers.nft?.address || fallback.nft,
        perp: registry.sellers.perp?.address || fallback.perp,
    };
}
