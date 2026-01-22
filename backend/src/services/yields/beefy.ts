/**
 * Beefy Finance API Service
 * Fetches vault data and APYs from Beefy
 */

const BEEFY_API_BASE = "https://api.beefy.finance";

export interface BeefyVault {
    id: string;
    name: string;
    chain: string;
    status: string;
    assets: string[];
    platformId: string;
    token: string;
    tokenAddress?: string;
    earnedToken: string;
    earnedTokenAddress?: string;
    pricePerFullShare?: string;
    risks?: string[];
}

export interface BeefyVaultSimple {
    id: string;
    name: string;
    chain: string;
    asset: string;
    platform: string;
    apy: number;
    status: string;
    risks: string[];
    url: string;
}

// Cache for APYs
let apyCache: Record<string, number> = {};
let apyCacheTime = 0;
const APY_CACHE_TTL = 60_000; // 1 minute

/**
 * Fetch all Beefy APYs
 */
async function fetchBeefyAPYs(): Promise<Record<string, number>> {
    // Return cached if fresh
    if (Date.now() - apyCacheTime < APY_CACHE_TTL && Object.keys(apyCache).length > 0) {
        return apyCache;
    }

    try {
        console.log("[Beefy] Fetching APYs...");
        const response = await fetch(`${BEEFY_API_BASE}/apy`);

        if (!response.ok) {
            console.error(`[Beefy] APY API error: ${response.status}`);
            return apyCache;
        }

        apyCache = await response.json();
        apyCacheTime = Date.now();
        console.log(`[Beefy] Cached ${Object.keys(apyCache).length} APYs`);
        return apyCache;
    } catch (error) {
        console.error("[Beefy] Failed to fetch APYs:", error);
        return apyCache;
    }
}

/**
 * Get all Beefy vaults with APYs
 */
export async function getBeefyVaults(chain?: string): Promise<BeefyVaultSimple[]> {
    try {
        console.log(`[Beefy] Fetching vaults${chain ? ` for ${chain}` : ""}...`);

        // Fetch vaults and APYs in parallel
        const [vaultsRes, apys] = await Promise.all([
            fetch(`${BEEFY_API_BASE}/vaults`),
            fetchBeefyAPYs()
        ]);

        if (!vaultsRes.ok) {
            console.error(`[Beefy] Vaults API error: ${vaultsRes.status}`);
            return [];
        }

        const vaults: BeefyVault[] = await vaultsRes.json();

        // Filter and transform
        const simplified: BeefyVaultSimple[] = vaults
            .filter(v => v.status === "active")
            .filter(v => !chain || v.chain.toLowerCase() === chain.toLowerCase())
            .map(v => ({
                id: v.id,
                name: v.name,
                chain: v.chain,
                asset: v.assets?.join("-") || v.token || "UNKNOWN",
                platform: v.platformId || "unknown",
                apy: (apys[v.id] || 0) * 100, // Convert to percentage
                status: v.status,
                risks: v.risks || [],
                // Direct link to vault
                url: `https://app.beefy.com/vault/${v.id}`
            }))
            .filter(v => v.apy > 0) // Only vaults with APY
            .sort((a, b) => b.apy - a.apy);

        console.log(`[Beefy] Found ${simplified.length} active vaults${chain ? ` on ${chain}` : ""}`);
        return simplified;
    } catch (error) {
        console.error("[Beefy] Failed to fetch vaults:", error);
        return [];
    }
}

/**
 * Get top Beefy vaults by APY
 */
export async function getTopBeefyVaults(limit: number = 20, chain?: string): Promise<BeefyVaultSimple[]> {
    const vaults = await getBeefyVaults(chain);
    return vaults.slice(0, limit);
}

/**
 * Get Beefy vaults for specific asset
 */
export async function getBeefyVaultsByAsset(asset: string): Promise<BeefyVaultSimple[]> {
    const vaults = await getBeefyVaults();
    const assetLower = asset.toLowerCase();

    return vaults.filter(v =>
        v.asset.toLowerCase().includes(assetLower) ||
        v.name.toLowerCase().includes(assetLower)
    );
}
