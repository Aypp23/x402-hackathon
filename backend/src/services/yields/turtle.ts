/**
 * Turtle Finance API Service
 * Fetches yield opportunities from Turtle's vault/lending aggregator
 * https://earn.turtle.xyz
 */

const TURTLE_API_BASE = "https://earn.turtle.xyz/v1";

export interface TurtleOpportunity {
    id: string;
    name: string;
    description: string;
    type: string;
    tvl: number;
    estimatedApr: number;
    featured: boolean;
    depositTokens: Array<{
        symbol: string;
        chain: {
            name: string;
            chainId: string;
        } | null;
    }>;
    baseToken: {
        symbol: string;
        chain: {
            name: string;
            chainId: string;
        } | null;
    } | null;
    incentives: Array<{
        apr: number | null;
        status: string;
    }>;
}

export interface TurtleOpportunitySimple {
    name: string;
    asset: string;
    apy: number;
    tvl: number;
    chain: string;
    type: string;
    url: string;
}

// Cache
let turtleCache: TurtleOpportunitySimple[] = [];
let turtleCacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

/**
 * Get all Turtle opportunities
 */
export async function getTurtleOpportunities(): Promise<TurtleOpportunitySimple[]> {
    // Return cached if fresh
    if (Date.now() - turtleCacheTime < CACHE_TTL && turtleCache.length > 0) {
        return turtleCache;
    }

    try {
        console.log("[Turtle] Fetching opportunities...");

        const response = await fetch(`${TURTLE_API_BASE}/opportunities/`);

        if (!response.ok) {
            console.error(`[Turtle] API error: ${response.status}`);
            return turtleCache;
        }

        const data = await response.json();

        if (!data.opportunities || !Array.isArray(data.opportunities)) {
            console.log("[Turtle] No opportunities in response");
            return [];
        }

        // Transform to simpler format
        const opportunities: TurtleOpportunitySimple[] = data.opportunities
            .filter((o: TurtleOpportunity) => o.estimatedApr > 0 && o.tvl > 0)
            .map((o: TurtleOpportunity) => {
                // Get chain and asset from depositTokens or baseToken
                const depositToken = o.depositTokens?.[0];
                const chain = depositToken?.chain?.name || o.baseToken?.chain?.name || "unknown";
                const asset = depositToken?.symbol || o.baseToken?.symbol || "unknown";

                return {
                    name: o.name,
                    asset,
                    apy: o.estimatedApr,
                    tvl: o.tvl,
                    chain: chain.toLowerCase(),
                    type: o.type || "vault",
                    url: `https://app.turtle.xyz/earn/opportunities/${o.id}`
                };
            })
            .sort((a: TurtleOpportunitySimple, b: TurtleOpportunitySimple) => b.apy - a.apy);

        console.log(`[Turtle] Found ${opportunities.length} opportunities`);

        // Cache results
        turtleCache = opportunities;
        turtleCacheTime = Date.now();

        return opportunities;
    } catch (error) {
        console.error("[Turtle] Failed to fetch opportunities:", error);
        return turtleCache;
    }
}

/**
 * Get top Turtle opportunities by APY
 */
export async function getTopTurtleOpportunities(limit: number = 20): Promise<TurtleOpportunitySimple[]> {
    const opportunities = await getTurtleOpportunities();
    return opportunities.slice(0, limit);
}
