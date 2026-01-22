/**
 * Yearn Finance yDaemon API Service
 * Fetches vault data with APY from Yearn
 */

const YEARN_API_BASE = "https://ydaemon.yearn.fi";

// Chain ID mapping
export const YEARN_CHAINS: Record<string, number> = {
    ethereum: 1,
    optimism: 10,
    polygon: 137,
    arbitrum: 42161
};

export interface YearnVault {
    address: string;
    name: string;
    symbol: string;
    token: {
        address: string;
        name: string;
        symbol: string;
    };
    tvl: {
        totalAssets: string;
        tvl: number;
        price: number;
    };
    apr: {
        type: string;
        netAPR: number;
        fees: {
            performance: number;
            management: number;
        };
        forwardAPR?: {
            netAPR: number;
        };
    };
    version: string;
    category: string;
    chainId: number;
}

export interface YearnVaultSimple {
    address: string;
    name: string;
    symbol: string;
    asset: string;
    apy: number;
    forwardApy: number;
    tvl: number;
    chain: string;
    category: string;
    url: string;
}

/**
 * Get all Yearn vaults for a specific chain
 */
export async function getYearnVaults(chainId: number = 1): Promise<YearnVaultSimple[]> {
    try {
        console.log(`[Yearn] Fetching vaults for chain ${chainId}...`);

        const response = await fetch(`${YEARN_API_BASE}/${chainId}/vaults/all`);

        if (!response.ok) {
            console.error(`[Yearn] API error: ${response.status}`);
            return [];
        }

        const vaults: YearnVault[] = await response.json();

        // Get chain name from chainId
        const chainName = Object.entries(YEARN_CHAINS).find(([, id]) => id === chainId)?.[0] || "unknown";

        // Transform to simpler format
        const simplified: YearnVaultSimple[] = vaults
            .filter(v => v.tvl?.tvl > 0) // Only vaults with TVL
            .map(v => ({
                address: v.address,
                name: v.name,
                symbol: v.symbol,
                asset: v.token?.symbol || "UNKNOWN",
                apy: (v.apr?.netAPR || 0) * 100, // Convert to percentage
                forwardApy: (v.apr?.forwardAPR?.netAPR || v.apr?.netAPR || 0) * 100,
                tvl: v.tvl?.tvl || 0,
                chain: chainName,
                category: v.category || "Vault",
                // Direct link to vault
                url: `https://yearn.fi/v3/${chainId}/${v.address}`
            }))
            .sort((a, b) => b.apy - a.apy);

        console.log(`[Yearn] Found ${simplified.length} vaults on ${chainName}`);
        return simplified;
    } catch (error) {
        console.error("[Yearn] Failed to fetch vaults:", error);
        return [];
    }
}

/**
 * Get top Yearn vaults across all chains
 */
export async function getTopYearnVaults(limit: number = 10): Promise<YearnVaultSimple[]> {
    const allVaults: YearnVaultSimple[] = [];

    // Fetch from all supported chains
    for (const [chain, chainId] of Object.entries(YEARN_CHAINS)) {
        try {
            const vaults = await getYearnVaults(chainId);
            allVaults.push(...vaults);
        } catch (e) {
            console.error(`[Yearn] Error fetching ${chain} vaults:`, e);
        }
    }

    // Sort by APY and return top N
    return allVaults
        .sort((a, b) => b.apy - a.apy)
        .slice(0, limit);
}
