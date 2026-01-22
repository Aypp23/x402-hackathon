/**
 * Curve Finance API Service
 * Fetches pool/gauge data with APYs from Curve
 */

const CURVE_API_BASE = "https://api.curve.finance/v1";

export interface CurvePool {
    name: string;
    shortName: string;
    poolAddress: string;
    lpTokenPrice: number | null;
    gaugeCrvApy: [number, number]; // [min, max]
    type: string;
    blockchainId: string;
}

export interface CurvePoolSimple {
    name: string;
    address: string;
    chain: string;
    apy: number;
    maxApy: number;
    lpPrice: number;
    type: string;
    url: string;
}

/**
 * Get all Curve pools with gauge APYs
 */
export async function getCurvePools(chain: string = "ethereum"): Promise<CurvePoolSimple[]> {
    try {
        console.log(`[Curve] Fetching gauges for ${chain}...`);

        const response = await fetch(`${CURVE_API_BASE}/getAllGauges?blockchainId=${chain}`);

        if (!response.ok) {
            console.error(`[Curve] API error: ${response.status}`);
            return [];
        }

        const data = await response.json();

        if (!data.success || !data.data) {
            return [];
        }

        // Transform to simpler format
        const pools: CurvePoolSimple[] = Object.values(data.data as Record<string, CurvePool>)
            .filter((p: any) => p.gaugeCrvApy && (p.gaugeCrvApy[0] > 0 || p.gaugeCrvApy[1] > 0))
            .map((p: any) => ({
                name: p.shortName || p.name,
                address: p.poolAddress,
                chain: p.blockchainId || chain,
                apy: p.gaugeCrvApy[0] || 0, // Min APY
                maxApy: p.gaugeCrvApy[1] || p.gaugeCrvApy[0] || 0, // Max APY (with boost)
                lpPrice: p.lpTokenPrice || 0,
                type: p.type || "stable",
                // Direct link to pool (prefer official URL from API)
                url: p.poolUrls?.deposit?.[0] || `https://curve.fi/#/${p.blockchainId || chain}/pools/${p.poolAddress}/deposit`
            }))
            .sort((a, b) => b.apy - a.apy);

        console.log(`[Curve] Found ${pools.length} pools with APY on ${chain}`);
        return pools;
    } catch (error) {
        console.error("[Curve] Failed to fetch pools:", error);
        return [];
    }
}

// Supported Curve chains
const CURVE_CHAINS = ["ethereum", "polygon", "arbitrum", "optimism", "base"];

/**
 * Get top Curve pools across ALL supported chains
 */
export async function getTopCurvePools(limit: number = 10): Promise<CurvePoolSimple[]> {
    const allPools: CurvePoolSimple[] = [];

    // Fetch from all supported chains in parallel
    const results = await Promise.allSettled(
        CURVE_CHAINS.map(chain => getCurvePools(chain))
    );

    for (const result of results) {
        if (result.status === 'fulfilled') {
            allPools.push(...result.value);
        }
    }

    // Sort by APY and return top N
    return allPools
        .sort((a, b) => b.apy - a.apy)
        .slice(0, limit);
}
