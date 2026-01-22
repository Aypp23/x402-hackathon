/**
 * Yield Optimizer Service
 * Aggregates yields from multiple DeFi protocols
 */

import { getLidoAPR } from "./yields/lido.js";
import { getYearnVaults, getTopYearnVaults, YearnVaultSimple } from "./yields/yearn.js";
import { getBeefyVaults, getTopBeefyVaults, BeefyVaultSimple } from "./yields/beefy.js";
import { getCurvePools, getTopCurvePools, CurvePoolSimple } from "./yields/curve.js";
import { getAaveRates, getTopAaveSupplyRates, AaveMarketSimple } from "./yields/aave.js";
import { getPendleMarkets, getTopPendleYields, PendleMarketSimple } from "./yields/pendle.js";
import { getTopTurtleOpportunities, TurtleOpportunitySimple } from "./yields/turtle.js";

// Unified yield opportunity interface
export interface YieldOpportunity {
    protocol: string;
    name: string;
    asset: string;
    apy: number;
    tvl?: number;
    chain: string;
    risk: "LOW" | "MEDIUM" | "HIGH";
    type: "staking" | "lending" | "vault" | "lp" | "fixed";
    url?: string;
}

export interface YieldSummary {
    opportunities: YieldOpportunity[];
    totalCount: number;
    fetchedAt: string;
}

/**
 * Calculate risk level based on research:
 * - Protocol security tier (audits, TVL, exploit history)
 * - APY sustainability (organic vs ponzinomics)
 * - Yield type (staking/lending=safe, LP=IL risk)
 * - TVL modifier
 */
function calculateRisk(
    tvl: number | undefined,
    protocol: string,
    apy?: number,
    yieldType?: string
): "LOW" | "MEDIUM" | "HIGH" {

    // Protocol tiers based on security research (Jan 2026)
    // Tier 1: $10B+ TVL, 5+ major audits, 0 core exploits
    const tier1 = ["lido", "aave", "pendle", "compound"];
    // Tier 2: $500M+ TVL, 3+ audits, minor incidents
    const tier2 = ["yearn", "curve"];

    const protocolLower = protocol.toLowerCase();
    const isTier1 = tier1.includes(protocolLower);
    const isTier2 = tier2.includes(protocolLower);

    // Start with base risk score from protocol tier
    // Lower score = lower risk
    let riskScore = isTier1 ? 1.0 : isTier2 ? 2.0 : 3.0;

    // APY sustainability factor
    // Extremely high APY = ponzinomics/unsustainable
    if (apy && apy > 75) riskScore += 2.0;        // Almost certainly unsustainable
    else if (apy && apy > 30) riskScore += 1.5;   // High risk of impermanent loss
    else if (apy && apy > 15) riskScore += 0.5;   // Elevated but possible
    // 0-15% is sustainable organic yield - no penalty

    // Yield type factor
    // LP pools have impermanent loss risk
    if (yieldType === "lp") riskScore += 0.5;
    // Non-tier-1/2 vaults have additional strategy risk
    if (yieldType === "vault" && !isTier1 && !isTier2) riskScore += 0.5;
    // Staking and lending are safest
    if (yieldType === "staking" || yieldType === "lending" || yieldType === "fixed") {
        riskScore -= 0.3; // Bonus for safe yield types
    }

    // TVL modifier - large TVL = battle-tested
    if (tvl && tvl > 1_000_000_000) riskScore -= 0.5;      // $1B+ = very safe
    else if (tvl && tvl > 100_000_000) riskScore -= 0.2;   // $100M+ = reasonably safe
    else if (tvl && tvl < 10_000_000) riskScore += 0.5;    // <$10M = risky

    // Convert score to risk level
    // Score 0-1.5 = LOW, 1.5-2.5 = MEDIUM, 2.5+ = HIGH
    if (riskScore <= 1.5) return "LOW";
    if (riskScore <= 2.5) return "MEDIUM";
    return "HIGH";
}

/**
 * Get staking yields (Lido)
 */
export async function getStakingYields(): Promise<YieldOpportunity[]> {
    const yields: YieldOpportunity[] = [];

    // Lido stETH
    const lidoAPR = await getLidoAPR();
    if (lidoAPR) {
        yields.push({
            protocol: "Lido",
            name: "stETH Staking",
            asset: "ETH → stETH",
            apy: lidoAPR.apr,
            tvl: 30_000_000_000, // ~$30B TVL
            chain: "ethereum",
            risk: "LOW",
            type: "staking",
            url: "https://stake.lido.fi"
        });
    }

    return yields;
}

/**
 * Get lending yields (Aave) - ALL CHAINS
 */
export async function getLendingYields(): Promise<YieldOpportunity[]> {
    const markets = await getTopAaveSupplyRates(1000);  // Fetch from all chains

    return markets.map(m => ({
        protocol: "Aave",
        name: `${m.asset} Supply`,
        asset: m.asset,
        apy: m.supplyApy,
        chain: m.chain,
        risk: calculateRisk(undefined, "aave", m.supplyApy, "lending"),
        type: "lending" as const,
        url: m.url  // Direct asset link
    }));
}

/**
 * Get vault yields (Yearn + Beefy)
 */
export async function getVaultYields(limit: number = 1000): Promise<YieldOpportunity[]> {
    const [yearnVaults, beefyVaults] = await Promise.all([
        getTopYearnVaults(limit / 2),
        getTopBeefyVaults(limit / 2)
    ]);

    const yearnYields: YieldOpportunity[] = yearnVaults.map(v => ({
        protocol: "Yearn",
        name: v.name,
        asset: v.asset,
        apy: v.apy,
        tvl: v.tvl,
        chain: v.chain,
        risk: calculateRisk(v.tvl, "yearn", v.apy, "vault"),
        type: "vault" as const,
        url: v.url  // Direct vault link
    }));

    const beefyYields: YieldOpportunity[] = beefyVaults.map(v => ({
        protocol: "Beefy",
        name: v.name,
        asset: v.asset,
        apy: v.apy,
        chain: v.chain,
        risk: calculateRisk(undefined, "beefy", v.apy, "vault"),
        type: "vault" as const,
        url: v.url  // Direct vault link
    }));

    return [...yearnYields, ...beefyYields].sort((a, b) => b.apy - a.apy);
}

/**
 * Get LP yields (Curve) - ALL CHAINS
 */
export async function getLPYields(): Promise<YieldOpportunity[]> {
    const pools = await getTopCurvePools(1000);  // Fetch from all chains

    return pools.map(p => ({
        protocol: "Curve",
        name: p.name,
        asset: p.name,
        apy: p.apy,
        chain: p.chain,
        risk: calculateRisk(undefined, "curve", p.apy, "lp"),
        type: "lp" as const,
        url: p.url  // Direct pool link
    }));
}

/**
 * Get fixed yields (Pendle) - ALL CHAINS
 */
export async function getFixedYields(): Promise<YieldOpportunity[]> {
    const markets = await getTopPendleYields(1000);  // Fetch from all chains

    return markets.map(m => ({
        protocol: "Pendle",
        name: `${m.name} (${m.daysToExpiry}d)`,
        asset: m.asset,
        apy: m.fixedApy,
        chain: m.chain,
        risk: calculateRisk(undefined, "pendle", m.fixedApy, "fixed"),
        type: "fixed" as const,
        url: m.url  // Direct market link
    }));
}

/**
 * Get Turtle yields (aggregated vaults/lending)
 */
export async function getTurtleYields(): Promise<YieldOpportunity[]> {
    // Fetch all opportunities (up to 1000) so that downstream filtering by chain/asset works
    const opportunities = await getTopTurtleOpportunities(1000);

    return opportunities.map(o => ({
        protocol: "Turtle",
        name: o.name,
        asset: o.asset,
        apy: o.apy,
        tvl: o.tvl,
        chain: o.chain,
        risk: calculateRisk(o.tvl, "turtle", o.apy, o.type === "lending" ? "lending" : "vault"),
        type: o.type === "lending" ? "lending" as const : "vault" as const,
        url: o.url
    }));
}

/**
 * Get top yields across all protocols
 */
export async function getTopYields(options?: {
    chain?: string;
    minApy?: number;
    maxApy?: number;
    type?: string;
    protocol?: string;
    limit?: number;
}): Promise<YieldSummary> {
    const limit = options?.limit || 20;

    // Fetch from all sources in parallel
    const [staking, lending, vaults, lp, fixed, turtle] = await Promise.all([
        getStakingYields(),
        getLendingYields(),
        getVaultYields(20),
        getLPYields(),
        getFixedYields(),
        getTurtleYields()
    ]);

    // Combine all yields
    let allYields = [...staking, ...lending, ...vaults, ...lp, ...fixed, ...turtle];

    // Filter out dust (minimum 1% APY unless explicitly requested lower)
    if (!options?.minApy || options.minApy < 1) {
        allYields = allYields.filter(y => y.apy >= 1);
    }

    // Apply filters
    if (options?.chain) {
        allYields = allYields.filter(y =>
            y.chain.toLowerCase() === options.chain!.toLowerCase()
        );
    }

    if (options?.minApy) {
        allYields = allYields.filter(y => y.apy >= options.minApy!);
    }

    if (options?.maxApy) {
        allYields = allYields.filter(y => y.apy <= options.maxApy!);
    }

    if (options?.type) {
        allYields = allYields.filter(y => y.type === options.type);
    }

    // Filter by protocol
    if (options?.protocol) {
        allYields = allYields.filter(y =>
            y.protocol.toLowerCase() === options.protocol!.toLowerCase()
        );
    }

    // Balanced sorting: include top yields from each risk level
    // This ensures users see options across risk spectrum, not just highest APY
    const lowRisk = allYields.filter(y => y.risk === "LOW").sort((a, b) => b.apy - a.apy);
    const medRisk = allYields.filter(y => y.risk === "MEDIUM").sort((a, b) => b.apy - a.apy);
    const highRisk = allYields.filter(y => y.risk === "HIGH").sort((a, b) => b.apy - a.apy);

    // Interleave: take top from each risk level in rounds
    const balanced: typeof allYields = [];
    const maxRounds = Math.ceil(limit / 3);

    for (let i = 0; i < maxRounds && balanced.length < limit; i++) {
        if (lowRisk[i]) balanced.push(lowRisk[i]);
        if (balanced.length < limit && medRisk[i]) balanced.push(medRisk[i]);
        if (balanced.length < limit && highRisk[i]) balanced.push(highRisk[i]);
    }

    // If we don't have enough balanced yields, fill with remaining sorted by APY
    if (balanced.length < limit) {
        const remaining = allYields
            .filter(y => !balanced.includes(y))
            .sort((a, b) => b.apy - a.apy);
        balanced.push(...remaining.slice(0, limit - balanced.length));
    }

    return {
        opportunities: balanced.slice(0, limit),
        totalCount: allYields.length,
        fetchedAt: new Date().toISOString()
    };
}

/**
 * Get yields for a specific asset
 */
export async function getYieldsForAsset(asset: string): Promise<YieldOpportunity[]> {
    const { opportunities } = await getTopYields({ limit: 100 });
    const assetLower = asset.toLowerCase();

    return opportunities.filter(y =>
        y.asset.toLowerCase().includes(assetLower)
    );
}

/**
 * Compare two protocols
 */
export async function compareProtocols(protocolA: string, protocolB: string): Promise<{
    protocolA: { name: string; avgApy: number; count: number };
    protocolB: { name: string; avgApy: number; count: number };
}> {
    const { opportunities } = await getTopYields({ limit: 100 });

    const aYields = opportunities.filter(y =>
        y.protocol.toLowerCase() === protocolA.toLowerCase()
    );
    const bYields = opportunities.filter(y =>
        y.protocol.toLowerCase() === protocolB.toLowerCase()
    );

    const avgA = aYields.length > 0
        ? aYields.reduce((sum, y) => sum + y.apy, 0) / aYields.length
        : 0;
    const avgB = bYields.length > 0
        ? bYields.reduce((sum, y) => sum + y.apy, 0) / bYields.length
        : 0;

    return {
        protocolA: { name: protocolA, avgApy: avgA, count: aYields.length },
        protocolB: { name: protocolB, avgApy: avgB, count: bYields.length }
    };
}

/**
 * Format yields for display
 */
export function formatYieldSummary(summary: YieldSummary): string {
    const lines: string[] = [];

    lines.push("### 🌾 Top DeFi Yields\n");

    for (const y of summary.opportunities.slice(0, 10)) {
        const riskEmoji = y.risk === "LOW" ? "🟢" : y.risk === "MEDIUM" ? "🟡" : "🔴";
        const typeEmoji = {
            staking: "🥩",
            lending: "🏦",
            vault: "🏛️",
            lp: "💧",
            fixed: "📌"
        }[y.type];

        lines.push(`${typeEmoji} **${y.protocol}** - ${y.name}`);
        lines.push(`   APY: **${y.apy.toFixed(2)}%** | ${riskEmoji} ${y.risk} | ${y.chain}`);
        lines.push("");
    }

    lines.push(`_${summary.totalCount} opportunities found at ${new Date(summary.fetchedAt).toLocaleTimeString()}_`);

    return lines.join("\n");
}
