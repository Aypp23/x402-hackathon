/**
 * On-Chain Analytics Service
 * Combines DeFiLlama, Etherscan, and Dune for comprehensive analytics
 */

import * as defillama from "./defillama.js";
import * as alchemy from "./alchemy.js";
import * as etherscan from "./etherscan.js";
import { fetchPrice } from "./price-oracle.js";

export interface WalletReport {
    address: string;
    ensName?: string;  // ENS reverse lookup
    walletAgeDays?: number;  // Days since first transaction
    isContract: boolean;
    ethBalance: number;
    ethBalanceUsd?: number;
    // Alchemy Data
    portfolio?: alchemy.AlchemyWalletAnalytics['portfolio'];
    history?: alchemy.AlchemyWalletAnalytics['history'];
    nftsWithFloorPrice?: { collection: string; tokenId: string; floorPriceEth: number | null }[];
    // Legacy support (derived from Alchemy)
    recentTransactions: {
        hash: string;
        from: string;
        to: string;
        value: number;
        timestamp: number;
    }[];
    recentTokenTransfers: {
        tokenSymbol: string;
        value: number;
        from: string;
        to: string;
    }[];
    recentNftTransfers: {
        name: string;
        symbol: string;
        id: string;
        action: string;
    }[];
    txCount: number;
    labels: string[];
}

export interface DexReport {
    chain: string;
    totalVolume24h: number;
    topDexes: {
        name: string;
        volume24h: number;
        change24h: number;
    }[];
}

export interface MarketOverview {
    chains: { chain: string; tvl: number }[];
    topDexVolume: DexReport[];
}

/**
 * Analyze a wallet address
 */
export async function analyzeWallet(address: string): Promise<WalletReport | null> {
    console.log(`[Analytics] Analyzing wallet: ${address}`);

    try {
        const normalizedAddress = address.toLowerCase();

        // 1. Fetch all data in parallel: Analytics, ETH Price, ENS, Wallet Age, NFTs
        const [alchemyData, ethPrice, ensName, walletAge, nftsWithFloor] = await Promise.all([
            alchemy.getWalletAnalytics(normalizedAddress),
            fetchPrice("ethereum"),
            alchemy.getEnsName(address), // Keep original case for ENS
            alchemy.getWalletAge(address),
            alchemy.getNFTsWithFloorPrice(address)
        ]);

        if (!alchemyData) throw new Error("Failed to fetch wallet analytics");

        // 2. Determine if Contract
        const isContractResult = await etherscan.isContract(normalizedAddress);

        // 3. Build Labels
        const labels: string[] = [];
        if (isContractResult) labels.push("Smart Contract");
        if (alchemyData.portfolio.totalValueUsd > 1_000_000) labels.push("Whale (>$1M)");
        else if (alchemyData.portfolio.totalValueUsd > 100_000) labels.push("High Net Worth");
        if (alchemyData.stats.txCount > 500) labels.push("High Activity");

        // Inject Real ETH Price
        if (ethPrice) {
            for (const token of alchemyData.portfolio.tokens) {
                if (token.symbol === "ETH" && token.priceUsd === 0) {
                    token.priceUsd = ethPrice.price;
                    token.valueUsd = token.balance * ethPrice.price;
                }
            }
        }

        // Recalculate total portfolio value
        alchemyData.portfolio.totalValueUsd = alchemyData.portfolio.tokens.reduce(
            (sum, t) => sum + (t.valueUsd || 0), 0
        );

        const ethToken = alchemyData.portfolio.tokens.find(t => t.symbol === "ETH");
        const ethBalance = ethToken?.balance || 0;

        // 4. Map to Legacy/Frontend compatible structure
        const recentTransactions = alchemyData.history
            .filter(h => h.asset === "ETH")
            .map(h => ({
                hash: h.hash,
                from: h.type === 'receive' ? h.counterparty : normalizedAddress,
                to: h.type === 'send' ? h.counterparty : normalizedAddress,
                value: h.amount,
                timestamp: h.timestamp
            }));

        const recentTokenTransfers = alchemyData.history
            .filter(h => h.asset !== "ETH" && h.type !== "mint")
            .map(h => ({
                tokenSymbol: h.asset,
                value: h.amount,
                from: h.type === 'receive' ? h.counterparty : normalizedAddress,
                to: h.type === 'send' ? h.counterparty : normalizedAddress
            }));

        const recentNftTransfers = alchemyData.history
            .filter(h => h.asset === "NFT" || (h.type === 'mint' || h.type === 'trade'))
            .map(h => ({
                name: h.asset,
                symbol: "NFT",
                id: "?",
                action: h.type === 'receive' || h.type === 'mint' ? "Received" : "Sent"
            }));

        return {
            address: normalizedAddress,
            ensName: ensName || undefined,
            walletAgeDays: walletAge.ageDays,
            isContract: isContractResult,
            ethBalance,
            ethBalanceUsd: alchemyData.portfolio.totalValueUsd,
            portfolio: alchemyData.portfolio,
            history: alchemyData.history,
            nftsWithFloorPrice: nftsWithFloor,
            recentTransactions,
            recentTokenTransfers,
            recentNftTransfers,
            txCount: alchemyData.stats.txCount,
            labels
        };

    } catch (error) {
        console.error(`[Analytics] Error analyzing wallet ${address}:`, error);
        return null;
    }
}

/**
 * Get DEX volume report for a chain
 */
export async function getDexReport(chain: string = "ethereum"): Promise<DexReport | null> {
    console.log(`[Analytics] Getting DEX report for: ${chain}`);

    try {
        const chainData = await defillama.getDexVolumeByChain(chain);

        if (!chainData) {
            return null;
        }

        return {
            chain: chainData.chain,
            totalVolume24h: chainData.totalVolume24h,
            topDexes: chainData.dexes.slice(0, 5).map(dex => ({
                name: dex.protocol,
                volume24h: dex.volume24h,
                change24h: dex.change24h
            }))
        };

    } catch (error) {
        console.error(`[Analytics] Error getting DEX report for ${chain}:`, error);
        return null;
    }
}

/**
 * Get market overview across chains
 */
export async function getMarketOverview(): Promise<MarketOverview | null> {
    console.log("[Analytics] Getting market overview");

    try {
        const [chainsTvl, dexOverview] = await Promise.all([
            defillama.getChainsTVL(),
            defillama.getDexVolumeOverview()
        ]);

        const topDexVolume: DexReport[] = [];

        if (dexOverview) {
            for (const chainData of dexOverview.slice(0, 5)) {
                topDexVolume.push({
                    chain: chainData.chain,
                    totalVolume24h: chainData.totalVolume24h,
                    topDexes: chainData.dexes.slice(0, 3).map(dex => ({
                        name: dex.protocol,
                        volume24h: dex.volume24h,
                        change24h: dex.change24h
                    }))
                });
            }
        }

        return {
            chains: chainsTvl || [],
            topDexVolume
        };

    } catch (error) {
        console.error("[Analytics] Error getting market overview:", error);
        return null;
    }
}

/**
 * Format wallet report as readable text for AI response
 * Updated format: ENS, Portfolio Value, Wallet Age, Tokens, Top 5 NFTs, Recent Transactions
 */
export function formatWalletReport(report: WalletReport): string {
    const lines: string[] = [];

    // Header
    lines.push(`**Wallet Address:** ${report.address}`);
    lines.push("");
    lines.push(`**ENS Name:** ${report.ensName || "None"}`);
    lines.push("");

    // Portfolio Value
    const totalValue = report.portfolio?.totalValueUsd || report.ethBalanceUsd || 0;
    lines.push(`**Total Portfolio Value:** $${formatNumber(totalValue)}`);
    lines.push("");

    // Wallet Age
    lines.push(`**Wallet Age:** ${report.walletAgeDays || 0} days`);
    lines.push("");

    // Token Holdings
    lines.push("--- TOKEN HOLDINGS ---");
    lines.push("");

    if (report.portfolio && report.portfolio.tokens.length > 0) {
        const chainNames: Record<string, string> = {
            "eth-mainnet": "Ethereum",
            "base-mainnet": "Base",
            "arb-mainnet": "Arbitrum",
            "opt-mainnet": "Optimism",
            "polygon-mainnet": "Polygon",
            "bnb-mainnet": "BNB",
            "monad-mainnet": "Monad"
        };

        // Top tokens sorted by value
        const topTokens = report.portfolio.tokens
            .filter(t => t.valueUsd >= 1.0)
            .sort((a, b) => b.valueUsd - a.valueUsd)
            .slice(0, 10);

        for (const t of topTokens) {
            const network = chainNames[t.network] || t.network;
            lines.push(`• ${t.symbol} on ${network}: ${t.balance.toFixed(6)} ($${t.valueUsd.toFixed(2)})`);
        }
    } else {
        lines.push("No tokens found.");
    }
    lines.push("");

    // Top 5 NFTs (sorted by floor price)
    lines.push("--- TOP 5 NFTs (by floor price) ---");
    lines.push("");

    if (report.nftsWithFloorPrice && report.nftsWithFloorPrice.length > 0) {
        const topNfts = report.nftsWithFloorPrice.slice(0, 5);

        for (const nft of topNfts) {
            const price = nft.floorPriceEth !== null ? `${nft.floorPriceEth} ETH` : "N/A";
            lines.push(`• ${nft.collection} #${nft.tokenId} — Floor: ${price}`);
        }
    } else {
        lines.push("No NFTs found.");
    }
    lines.push("");

    // Recent Transactions (last 10, non-spam)
    lines.push("--- RECENT TRANSACTIONS (last 10, non-spam) ---");
    lines.push("");

    if (report.history && report.history.length > 0) {
        const chainNames: Record<string, string> = {
            "eth-mainnet": "Ethereum",
            "base-mainnet": "Base",
            "arb-mainnet": "Arbitrum",
            "opt-mainnet": "Optimism",
            "polygon-mainnet": "Polygon",
            "bnb-mainnet": "BNB",
            "monad-mainnet": "Monad"
        };

        // Spam filter
        const isSpamAsset = (asset: string) => {
            if (!asset) return false;
            if (/[^\x20-\x7E]/.test(asset)) return true;
            const lower = asset.toLowerCase();
            return (
                lower.includes('t.me') ||
                lower.includes('http') ||
                lower.includes('.com') ||
                lower.includes('.io') ||
                lower.includes('.xyz') ||
                lower.includes('visit') ||
                lower.includes('claim') ||
                lower.includes('airdrop') ||
                lower.includes('voucher')
            );
        };

        const nonSpamTxs = report.history
            .filter(tx => !isSpamAsset(tx.asset))
            .slice(0, 10);

        if (nonSpamTxs.length > 0) {
            for (const tx of nonSpamTxs) {
                const network = chainNames[tx.network] || tx.network;
                const counterparty = tx.counterparty ? `${tx.counterparty.slice(0, 10)}...` : "";
                lines.push(`• ${tx.type} ${tx.amount.toFixed(4)} ${tx.asset} on ${network}${counterparty ? ` → ${counterparty}` : ""}`);
            }
        } else {
            lines.push("No recent transactions found.");
        }
    } else {
        lines.push("No recent transactions found.");
    }

    return lines.join("\n");
}


/**
 * Format DEX report as readable text
 */
export function formatDexReport(report: DexReport): string {
    const lines: string[] = [];

    lines.push(`### 📈 DEX Volume: ${report.chain.toUpperCase()}`);
    lines.push("");
    lines.push(`**Total 24h Volume:** $${formatNumber(report.totalVolume24h)}`);
    lines.push("");
    lines.push("**Top DEXs:**");

    for (const dex of report.topDexes) {
        const changeSign = dex.change24h >= 0 ? "+" : "";
        lines.push(`• ${dex.name}: $${formatNumber(dex.volume24h)} (${changeSign}${dex.change24h.toFixed(1)}%)`);
    }

    return lines.join("\n");
}

/**
 * Format market overview as readable text
 */
export function formatMarketOverview(overview: MarketOverview): string {
    const lines: string[] = [];

    lines.push("### 🌐 Market Overview");
    lines.push("");

    // TVL by chain
    lines.push("**Total Value Locked (TVL):**");

    for (const chain of overview.chains.slice(0, 8)) {
        lines.push(`• ${chain.chain}: $${formatNumber(chain.tvl)}`);
    }
    lines.push("");

    // DEX Volume
    if (overview.topDexVolume.length > 0) {
        lines.push("**DEX Volume by Chain (24h):**");
        for (const chainReport of overview.topDexVolume.slice(0, 3)) {
            lines.push(`• ${chainReport.chain}: $${formatNumber(chainReport.totalVolume24h)}`);
        }
    }

    return lines.join("\n");
}

/**
 * Helper: Format large numbers
 */
function formatNumber(num: number): string {
    if (num >= 1e9) {
        return (num / 1e9).toFixed(2) + "B";
    } else if (num >= 1e6) {
        return (num / 1e6).toFixed(2) + "M";
    } else if (num >= 1e3) {
        return (num / 1e3).toFixed(2) + "K";
    }
    return num.toFixed(2);
}

/**
 * Get current gas prices on Ethereum
 */
export async function getGasPrices(): Promise<{
    low: number;
    average: number;
    fast: number;
    baseFee: number;
} | null> {
    console.log("[Analytics] Getting gas prices");

    try {
        const gas = await etherscan.getGasOracle();
        if (!gas) return null;

        return {
            low: gas.safeGasPrice,
            average: gas.proposeGasPrice,
            fast: gas.fastGasPrice,
            baseFee: gas.suggestBaseFee
        };
    } catch (error) {
        console.error("[Analytics] Error getting gas prices:", error);
        return null;
    }
}

/**
 * Format gas oracle as readable text
 */
/**
 * Format gas oracle as readable text
 */
export function formatGasPrices(gas: { low: number; average: number; fast: number; baseFee: number }, ethPrice: number = 0): string {
    const lines: string[] = [];
    const TRANSFER_GAS = 21000;

    const calculateCost = (gwei: number): string => {
        if (!ethPrice) return "-";
        const cost = (gwei * 1e-9 * TRANSFER_GAS * ethPrice);
        return `$${cost.toFixed(2)}`;
    };

    lines.push("### ⛽ Ethereum Gas Prices");
    lines.push("");
    lines.push("| Speed | Gas (Gwei) | Est. Cost ($) | Time |");
    lines.push("|-------|-----------|---------------|------|");
    lines.push(`| 🐢 Low | ${gas.low} | ${calculateCost(gas.low)} | ~5-10m |`);
    lines.push(`| 🐇 Average | ${gas.average} | ${calculateCost(gas.average)} | ~1-3m |`);
    lines.push(`| 🚀 Fast | ${gas.fast} | ${calculateCost(gas.fast)} | ~15s |`);
    lines.push("");
    lines.push(`**Base Fee:** ${gas.baseFee.toFixed(2)} Gwei`);

    return lines.join("\n");
}

export interface GasEstimate {
    operation: string;
    gasLimit: number;
    gasPriceGwei: number;
    ethCost: number;
    usdCost: number;
    formattedCost: string;
}

/**
 * Estimate transaction cost for specific operations
 */
export async function estimateTransactionCost(operation: string): Promise<GasEstimate | null> {
    console.log(`[Analytics] Estimating cost for: ${operation}`);

    // Standard Gas Limits (approximate)
    const GAS_LIMITS: Record<string, number> = {
        "eth_transfer": 21000,
        "erc20_transfer": 65000,
        "nft_transfer": 85000,
        "swap_dex": 180000, // Uniswap V2/V3 average
        "bridge": 150000    // Standard bridge deposit
    };

    const limit = GAS_LIMITS[operation];
    if (!limit) {
        console.warn(`[Analytics] Unknown operation for gas estimate: ${operation}`);
        return null;
    }

    try {
        const [gasOracle, ethPriceData] = await Promise.all([
            etherscan.getGasOracle(),
            fetchPrice("ethereum")
        ]);

        if (!gasOracle || !ethPriceData) {
            throw new Error("Failed to fetch gas or price data");
        }

        // Use "Fast" gas price for realistic "I want to do this now" estimate
        const gasPriceGwei = gasOracle.fastGasPrice;
        const gasPriceEth = gasPriceGwei * 1e-9; // Convert Gwei to ETH

        const ethCost = limit * gasPriceEth;
        const usdCost = ethCost * ethPriceData.price;

        // Use adaptive precision for small ETH amounts (e.g. 0.000004 ETH)
        const ethCostDisplay = ethCost < 0.0001
            ? ethCost.toFixed(9).replace(/0+$/, "").replace(/\.$/, "") // Trim trailing zeros
            : ethCost.toFixed(5);

        return {
            operation,
            gasLimit: limit,
            gasPriceGwei,
            ethCost,
            usdCost,
            formattedCost: `${ethCostDisplay} ETH (~$${usdCost.toFixed(2)})`
        };

    } catch (error) {
        console.error("[Analytics] Error estimating gas cost:", error);
        return null;
    }
}
