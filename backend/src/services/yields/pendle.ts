/**
 * Pendle Finance API Service
 * Fetches fixed yield markets (PT/YT) from Pendle
 */

const PENDLE_API_BASE = "https://api-v2.pendle.finance/core/v1";

export interface PendleMarket {
    address: string;
    name: string;
    symbol: string;
    expiry: string;
    pt: {
        address: string;
        price: number;
    };
    yt: {
        address: string;
        price: number;
    };
    impliedApy: number;
    underlyingApy: number;
    chainId: number;
}

export interface PendleMarketSimple {
    name: string;
    address: string;
    asset: string;
    fixedApy: number;
    underlyingApy: number;
    expiry: string;
    daysToExpiry: number;
    chain: string;
    url: string;
}

// Pendle chain IDs
const PENDLE_CHAINS: Record<number, string> = {
    1: "ethereum",
    42161: "arbitrum",
    56: "bsc",
    10: "optimism"
};

/**
 * Get Pendle markets for a chain
 */
export async function getPendleMarkets(chainId: number = 1): Promise<PendleMarketSimple[]> {
    try {
        console.log(`[Pendle] Fetching markets for chain ${chainId}...`);

        const response = await fetch(`${PENDLE_API_BASE}/${chainId}/markets`);

        if (!response.ok) {
            console.error(`[Pendle] API error: ${response.status}`);
            return [];
        }

        const data = await response.json();
        const markets = data.results || data || [];

        if (!Array.isArray(markets)) {
            return [];
        }

        const now = Date.now();

        // Transform to simpler format
        const simplified: PendleMarketSimple[] = markets
            .filter((m: any) => m.impliedApy !== undefined)
            .map((m: any) => {
                const expiryDate = new Date(m.expiry);
                const daysToExpiry = Math.ceil((expiryDate.getTime() - now) / (1000 * 60 * 60 * 24));
                const chainName = PENDLE_CHAINS[chainId] || "ethereum";

                return {
                    name: m.name || m.symbol,
                    address: m.address,
                    asset: m.underlyingAsset?.symbol || m.name?.split("-")[0] || "UNKNOWN",
                    fixedApy: (m.impliedApy || 0) * 100, // Convert to percentage
                    underlyingApy: (m.underlyingApy || 0) * 100,
                    expiry: m.expiry,
                    daysToExpiry: daysToExpiry > 0 ? daysToExpiry : 0,
                    chain: chainName,
                    url: `https://app.pendle.finance/trade/markets/${m.address}?chain=${chainName}`
                };
            })
            .filter((m: PendleMarketSimple) => m.daysToExpiry > 0) // Only active markets
            .sort((a: PendleMarketSimple, b: PendleMarketSimple) => b.fixedApy - a.fixedApy);

        console.log(`[Pendle] Found ${simplified.length} active markets`);
        return simplified;
    } catch (error) {
        console.error("[Pendle] Failed to fetch markets:", error);
        return [];
    }
}

/**
 * Get top Pendle fixed yield opportunities across ALL supported chains
 */
export async function getTopPendleYields(limit: number = 10): Promise<PendleMarketSimple[]> {
    const allMarkets: PendleMarketSimple[] = [];

    // Fetch from all supported chains in parallel
    const chainIds = Object.keys(PENDLE_CHAINS).map(Number);
    const results = await Promise.allSettled(
        chainIds.map(chainId => getPendleMarkets(chainId))
    );

    for (const result of results) {
        if (result.status === 'fulfilled') {
            allMarkets.push(...result.value);
        }
    }

    // Sort by APY and return top N
    return allMarkets
        .sort((a, b) => b.fixedApy - a.fixedApy)
        .slice(0, limit);
}
