/**
 * Aave V3 Official GraphQL API Service
 * Fetches lending/borrowing rates from Aave's official API
 */

const AAVE_GRAPHQL_API = "https://api.v3.aave.com/graphql";

export interface AaveMarketSimple {
    asset: string;
    supplyApy: number;
    borrowApy: number;
    chain: string;
    url: string;
}

// Per-chain cache for Aave markets
const aaveCache: Map<number, { markets: AaveMarketSimple[], time: number }> = new Map();
const CACHE_TTL = 60_000; // 1 minute

// Chain IDs for Aave V3
const CHAIN_IDS = {
    ethereum: 1,
    polygon: 137,
    arbitrum: 42161,
    optimism: 10,
    base: 8453,
    avalanche: 43114
};

const CHAIN_NAMES: Record<number, string> = {
    1: "ethereum",
    137: "polygon",
    42161: "arbitrum",
    10: "optimism",
    8453: "base",
    43114: "avalanche"
};

/**
 * Get Aave V3 market rates from official GraphQL API
 */
export async function getAaveRates(chainId: number = 1): Promise<AaveMarketSimple[]> {
    // Return cached if fresh (per-chain cache)
    const cached = aaveCache.get(chainId);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
        return cached.markets;
    }

    try {
        console.log(`[Aave] Fetching rates from official API (chain ${chainId})...`);

        const query = `{
            markets(request: {chainIds: [${chainId}]}) {
                name
                reserves {
                    underlyingToken { symbol address }
                    supplyInfo { apy { value } }
                    borrowInfo { apy { value } }
                }
            }
        }`;

        const response = await fetch(AAVE_GRAPHQL_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query })
        });

        if (!response.ok) {
            console.error(`[Aave] API error: ${response.status}`);
            const cached = aaveCache.get(chainId);
            return cached?.markets || [];
        }

        const data = await response.json();

        if (!data.data?.markets?.[0]?.reserves) {
            console.log("[Aave] No reserves in response");
            return [];
        }

        const chainName = CHAIN_NAMES[chainId] || "ethereum";
        // Aave URL uses 'mainnet' for ethereum, others match
        const urlChainName = chainName === "ethereum" ? "mainnet" : chainName;

        const reserves = data.data.markets[0].reserves;

        // Transform to our format - APY comes as decimal (0.02 = 2%)
        const markets: AaveMarketSimple[] = reserves
            .filter((r: any) => r.supplyInfo?.apy?.value && parseFloat(r.supplyInfo.apy.value) > 0)
            .map((r: any) => {
                const asset = r.underlyingToken?.symbol || "UNKNOWN";
                const address = r.underlyingToken?.address || "";

                return {
                    asset,
                    supplyApy: parseFloat(r.supplyInfo?.apy?.value || "0") * 100, // Convert to percentage
                    borrowApy: parseFloat(r.borrowInfo?.apy?.value || "0") * 100,
                    chain: chainName,
                    // Direct link to asset on Aave using address
                    url: `https://app.aave.com/reserve-overview/?underlyingAsset=${address}&marketName=proto_${urlChainName}_v3`
                };
            })
            .sort((a: AaveMarketSimple, b: AaveMarketSimple) => b.supplyApy - a.supplyApy);

        console.log(`[Aave] Found ${markets.length} markets on ${chainName}`);

        // Cache results (per-chain)
        aaveCache.set(chainId, { markets, time: Date.now() });

        return markets;
    } catch (error) {
        console.error(`[Aave] Failed to fetch rates for chain ${chainId}:`, error);
        // Return cached if available, otherwise empty
        const cached = aaveCache.get(chainId);
        return cached?.markets || [];
    }
}

/**
 * Get top Aave supply rates across ALL supported chains
 */
export async function getTopAaveSupplyRates(limit: number = 10): Promise<AaveMarketSimple[]> {
    const allMarkets: AaveMarketSimple[] = [];

    // Fetch from all supported chains in parallel
    const chainIds = Object.values(CHAIN_IDS);
    const results = await Promise.allSettled(
        chainIds.map(chainId => getAaveRates(chainId))
    );

    for (const result of results) {
        if (result.status === 'fulfilled') {
            allMarkets.push(...result.value);
        }
    }

    // Sort by APY and return top N
    return allMarkets
        .sort((a, b) => b.supplyApy - a.supplyApy)
        .slice(0, limit);
}

/**
 * Get Aave rate for specific asset
 */
export async function getAaveAssetRate(asset: string): Promise<AaveMarketSimple | null> {
    const markets = await getAaveRates();
    const assetUpper = asset.toUpperCase();
    return markets.find(m => m.asset.toUpperCase() === assetUpper) || null;
}
