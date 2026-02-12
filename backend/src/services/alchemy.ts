import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { fetchTokenPrice, fetchTokenPricesBatch } from "./price-oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env relative to this file
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

// Log status on load
console.log(`[Alchemy] API key ${ALCHEMY_API_KEY ? "loaded ✅" : "NOT SET ❌"}`);

const SUPPORTED_NETWORKS = [
    "eth-mainnet",
    "base-mainnet",
    "arb-mainnet",
    "opt-mainnet",
    "polygon-mainnet",
    "bnb-mainnet"
];

// Public RPC fallbacks (used when Alchemy fails)
const PUBLIC_RPC_FALLBACKS: Record<string, string> = {
    "eth-mainnet": "https://eth.llamarpc.com",
    "base-mainnet": "https://mainnet.base.org",
    "arb-mainnet": "https://arb1.arbitrum.io/rpc",
    "opt-mainnet": "https://mainnet.optimism.io",
    "polygon-mainnet": "https://polygon-rpc.com",
    "bnb-mainnet": "https://bsc-dataseed.binance.org",
    "monad-mainnet": "https://rpc.monad.xyz"
};

function getRpcUrl(network: string): string {
    // Prefer Alchemy, fallback to public RPC
    if (ALCHEMY_API_KEY) {
        return `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;
    }
    return PUBLIC_RPC_FALLBACKS[network] || `https://${network}.g.alchemy.com/v2/demo`;
}

/**
 * Fetch with automatic fallback to public RPC if Alchemy fails
 */
async function fetchWithFallback(network: string, body: any): Promise<any> {
    const alchemyUrl = ALCHEMY_API_KEY
        ? `https://${network}.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
        : null;
    const publicUrl = PUBLIC_RPC_FALLBACKS[network];

    // Try Alchemy first
    if (alchemyUrl) {
        try {
            const response = await fetch(alchemyUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (err) {
            // DNS or network error, fall through to public RPC
            console.warn(`[Alchemy] ${network} failed, trying public RPC...`);
        }
    }

    // Fallback to public RPC
    if (publicUrl) {
        try {
            const response = await fetch(publicUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (err) {
            // Both failed
        }
    }

    return { error: { message: `All RPCs failed for ${network}` } };
}

// ============ Interfaces ============

export interface AlchemyToken {
    network: string;
    symbol: string;
    name: string;
    balance: number;
    priceUsd: number;
    valueUsd: number;
    logoUrl?: string;
    contractAddress: string;
    isSpam: boolean;
}

export interface AlchemyNFT {
    network: string;
    collectionName: string;
    tokenId: string;
    imageUrl?: string;
    floorPriceEth?: number;
}

export interface AlchemyHistoryItem {
    network: string;
    hash: string;
    timestamp: number;
    type: 'send' | 'receive' | 'mint' | 'trade' | 'unknown';
    asset: string;
    amount: number;
    counterparty: string;
    status: 'success' | 'failed';
}

export interface AlchemyWalletAnalytics {
    address: string;
    ensName?: string;
    portfolio: {
        totalValueUsd: number;
        tokens: AlchemyToken[];
        nfts: AlchemyNFT[];
    };
    history: AlchemyHistoryItem[];
    stats: {
        txCount: number;
        ageDays: number;
        totalGasSpentEth: number;
    };
}

// ============ API Methods ============

/**
 * Get comprehensive wallet analytics using Alchemy across multiple chains
 */
export async function getWalletAnalytics(address: string): Promise<AlchemyWalletAnalytics | null> {
    if (!ALCHEMY_API_KEY) {
        console.error("[Alchemy] API key not set");
        return null;
    }

    try {
        // Fetch data from all supported networks in parallel
        const networkPromises = SUPPORTED_NETWORKS.map(network => getNetworkData(network, address));
        const results = await Promise.all(networkPromises);

        // Aggregate results
        let totalValueUsd = 0;
        let allTokens: AlchemyToken[] = [];
        let allNfts: AlchemyNFT[] = [];
        let allHistory: AlchemyHistoryItem[] = [];
        let totalTxCount = 0;

        for (const res of results) {
            if (res) {
                totalValueUsd += res.portfolio.totalValueUsd;
                allTokens = [...allTokens, ...res.portfolio.tokens];
                allNfts = [...allNfts, ...res.portfolio.nfts];
                allHistory = [...allHistory, ...res.history];
                totalTxCount += res.stats.txCount;
            }
        }

        // Sort unified history by timestamp desc
        allHistory.sort((a, b) => b.timestamp - a.timestamp);

        console.log("[DEBUG] History counts:", JSON.stringify(results.map((r, i) => `${SUPPORTED_NETWORKS[i]}: ${r?.history.length || 0}`)));

        // Sort unified tokens by value (desc)
        allTokens.sort((a, b) => b.valueUsd - a.valueUsd);

        return {
            address,
            portfolio: {
                totalValueUsd,
                tokens: allTokens,
                nfts: allNfts
            },
            history: allHistory.slice(0, 50), // Limit total history items returned
            stats: {
                txCount: totalTxCount,
                ageDays: 0, // Placeholder
                totalGasSpentEth: 0 // Placeholder
            }
        };

    } catch (error) {
        console.error(`[Alchemy] Error analyzing wallet ${address}:`, error);
        return null;
    }
}

/**
 * Fetch data for a single network
 */
async function getNetworkData(network: string, address: string) {
    try {
        const [portfolio, history] = await Promise.all([
            getWalletPortfolio(network, address),
            getWalletHistory(network, address)
        ]);

        return {
            portfolio,
            history,
            stats: {
                txCount: history.length
            }
        };
    } catch (error) {
        console.warn(`[Alchemy] Failed to fetch data for ${network}:`, error);
        return null;
    }
}

/**
 * Fetch Portfolio (Tokens + Prices + Metadata) for a specific network
 */
async function getWalletPortfolio(network: string, address: string) {
    try {
        const data = await fetchWithFallback(network, {
            id: 1,
            jsonrpc: "2.0",
            method: "alchemy_getTokenBalances",
            params: [address, "erc20"]
        });

        if (data.error) throw new Error(data.error.message);

        // Filter out zero balances
        const rawTokens = data.result.tokenBalances.filter((t: any) =>
            BigInt(t.tokenBalance) > BigInt(0)
        );

        // Known stablecoin addresses (ensure these are always included)
        const STABLECOIN_ADDRS = new Set([
            "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base USDC
            "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // ETH USDC
            "0xaf88d065e77c8cc2239327c5edb3a432268e5831", // ARB USDC
            "0x0b2c639c533813f4aa9d7837caf62653d097ff85", // OPT USDC
            "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", // Polygon USDC
            "0xdac17f958d2ee523a2206206994597c13d831ec7", // ETH USDT
            "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", // ARB USDT
            "0x6b175474e89094c44da98b954eedeac495271d0f", // ETH DAI
        ]);

        // Sort: stablecoins first, then by balance (desc)
        const sortedTokens = rawTokens.sort((a: any, b: any) => {
            const aIsStable = STABLECOIN_ADDRS.has(a.contractAddress.toLowerCase());
            const bIsStable = STABLECOIN_ADDRS.has(b.contractAddress.toLowerCase());
            if (aIsStable && !bIsStable) return -1;
            if (!aIsStable && bIsStable) return 1;
            // Compare by balance for non-stablecoins
            return Number(BigInt(b.tokenBalance) - BigInt(a.tokenBalance));
        });

        // Limit to top 50 tokens per chain (increased from 15 to capture more high-value tokens)
        const topTokens = sortedTokens.slice(0, 50);

        // Step 1: Fetch all metadata in parallel
        const tokensMeta = await Promise.all(topTokens.map(async (t: any) => {
            const meta = await getTokenMetadata(network, t.contractAddress);
            const balance = Number(BigInt(t.tokenBalance)) / Math.pow(10, meta.decimals || 18);
            return {
                contractAddress: t.contractAddress.toLowerCase(),
                symbol: meta.symbol || "UNK",
                name: meta.name || "Unknown",
                balance,
                logoUrl: meta.logo
            };
        }));

        // Step 2: Collect all addresses for batch pricing
        const contractAddresses = tokensMeta.map(t => t.contractAddress);

        // Step 3: Batch fetch prices (one API call for all tokens on this chain)
        const priceMap = await fetchTokenPricesBatch(network, contractAddresses);

        // Step 4: Build final tokens with prices
        const tokensWithPrices: AlchemyToken[] = tokensMeta.map(t => {
            const priceUsd = priceMap.get(t.contractAddress) || 0;
            const valueUsd = t.balance * priceUsd;
            return {
                network,
                symbol: t.symbol,
                name: t.name,
                balance: t.balance,
                priceUsd,
                valueUsd,
                logoUrl: t.logoUrl,
                contractAddress: t.contractAddress,
                isSpam: false
            };
        });

        // Add Native Token
        const nativeBalance = await getNativeBalance(network, address);
        let nativeSymbol = "ETH";
        if (network.includes("polygon")) nativeSymbol = "MATIC";
        else if (network.includes("bnb")) nativeSymbol = "BNB";

        const nativePrice = await fetchTokenPrice(network, "native") || 0;

        const nativeToken: AlchemyToken = {
            network,
            symbol: nativeSymbol,
            name: "Native Token",
            balance: nativeBalance,
            priceUsd: nativePrice,
            valueUsd: nativeBalance * nativePrice,
            contractAddress: "native",
            logoUrl: "https://assets.coingecko.com/coins/images/279/small/ethereum.png?1595348880",
            isSpam: false
        };

        // Combine
        let allTokens = nativeBalance > 0 ? [nativeToken, ...tokensWithPrices] : tokensWithPrices;

        // Filter: keep only tokens with value >= $1 OR stablecoins
        const STABLECOIN_SYMBOLS = ["USDC", "USDT", "DAI", "EURC", "BUSD"];
        allTokens = allTokens.filter(t => {
            if (STABLECOIN_SYMBOLS.includes(t.symbol.toUpperCase())) return true;
            if (t.valueUsd >= 1.0) return true;
            return false;
        });

        // Sort by USD value (highest first) AFTER prices are known
        allTokens.sort((a, b) => b.valueUsd - a.valueUsd);

        const totalValueUsd = allTokens.reduce((sum, t) => sum + t.valueUsd, 0);

        return { tokens: allTokens, nfts: [], totalValueUsd };

    } catch (error) {
        console.error(`[Alchemy] Error fetching portfolio for ${network}:`, error);
        return { tokens: [], nfts: [], totalValueUsd: 0 };
    }
}

async function getNativeBalance(network: string, address: string): Promise<number> {
    try {
        const data = await fetchWithFallback(network, {
            id: 1,
            jsonrpc: "2.0",
            method: "eth_getBalance",
            params: [address, "latest"]
        });
        return parseInt(data.result, 16) / 1e18;
    } catch {
        return 0;
    }
}

async function getTokenMetadata(network: string, address: string): Promise<any> {
    try {
        const data = await fetchWithFallback(network, {
            id: 1,
            jsonrpc: "2.0",
            method: "alchemy_getTokenMetadata",
            params: [address]
        });
        return data.result || { decimals: 18, symbol: '?', name: '?' };
    } catch {
        return { decimals: 18, symbol: '?', name: '?' };
    }
}

/**
 * Fetch History (Transfers) for a specific network
 */

/**
 * Get latest block number for a network
 */
async function getLatestBlock(network: string): Promise<number> {
    try {
        const data = await fetchWithFallback(network, {
            id: 99,
            jsonrpc: "2.0",
            method: "eth_blockNumber",
            params: []
        });
        if (data.result) {
            return parseInt(data.result, 16);
        }
    } catch {
        // ignore
    }
    return 0;
}

/**
 * Fetch History (Transfers) for a specific network
 */
async function getWalletHistory(network: string, address: string): Promise<AlchemyHistoryItem[]> {
    try {
        // Fetch Sends & Receives in parallel
        // Also fetch latest block for timestamp estimation if needed (BNB)
        const [data, dataRx, latestBlock] = await Promise.all([
            fetchWithFallback(network, {
                id: 1,
                jsonrpc: "2.0",
                method: "alchemy_getAssetTransfers",
                params: [{
                    fromBlock: "0x0",
                    fromAddress: address,
                    category: ["external", "erc20"],
                    withMetadata: true,
                    excludeZeroValue: true,
                    maxCount: "0x32",
                    order: "desc"
                }]
            }),
            fetchWithFallback(network, {
                id: 1,
                jsonrpc: "2.0",
                method: "alchemy_getAssetTransfers",
                params: [{
                    fromBlock: "0x0",
                    toAddress: address,
                    category: ["external", "erc20"],
                    withMetadata: true,
                    excludeZeroValue: true,
                    maxCount: "0x32",
                    order: "desc"
                }]
            }),
            getLatestBlock(network)
        ]);

        if (data.error) throw new Error(data.error.message);

        const sends = (data.result?.transfers || []).map((t: any) => mapTransfer(t, 'send', network, latestBlock));
        const receives = (dataRx.result?.transfers || []).map((t: any) => mapTransfer(t, 'receive', network, latestBlock));

        return [...sends, ...receives];

    } catch (error) {
        console.error(`[Alchemy] Error fetching history for ${network}:`, error);
        return [];
    }
}

function mapTransfer(t: any, type: 'send' | 'receive', network: string, currentBlock: number = 0): AlchemyHistoryItem {
    let timestamp = Date.now();
    try {
        if (t.metadata?.blockTimestamp) {
            timestamp = new Date(t.metadata.blockTimestamp).getTime();
        } else if (t.blockNum) {
            // Timestamp missing (common on BNB/Polygon via Alchemy)
            // Heuristic: Estimate based on block depth
            const txBlock = parseInt(t.blockNum, 16);

            if (currentBlock > 0 && txBlock <= currentBlock) {
                // Average block times (ms)
                const BLOCK_TIMES: Record<string, number> = {
                    "bnb-mainnet": 3000,
                    "polygon-mainnet": 2200,
                    "default": 12000
                };
                const avgTime = BLOCK_TIMES[network] || BLOCK_TIMES["default"];
                const blockDiff = currentBlock - txBlock;
                timestamp = Date.now() - (blockDiff * avgTime);
            } else {
                // Fallback if no current block
                // Use blockNum * 1000 to maintain relative sort order (even if dates are 1970s)
                timestamp = txBlock * 1000;
            }
        }
    } catch {
        // Ignore parsing errors, keep Date.now()
    }

    return {
        network: network,
        hash: t.hash,
        timestamp,
        type,
        asset: t.asset || "UNK",
        amount: t.value || 0,
        counterparty: type === 'send' ? t.to : t.from,
        status: 'success'
    };
}

// ============ NEW: Wallet Analysis Feature ============

/**
 * Get ENS name for an address using viem
 */
export async function getEnsName(address: string): Promise<string | null> {
    if (!ALCHEMY_API_KEY) return null;

    try {
        const { createPublicClient, http } = await import('viem');
        const { mainnet } = await import('viem/chains');

        const client = createPublicClient({
            chain: mainnet,
            transport: http(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`)
        });

        const ensName = await client.getEnsName({
            address: address as `0x${string}`
        });

        return ensName || null;
    } catch (e) {
        console.error("[Alchemy] Error getting ENS name:", e);
        return null;
    }
}

/**
 * Get wallet age by finding the first transaction
 */
export async function getWalletAge(address: string): Promise<{ ageDays: number; firstTxDate: string | null }> {
    if (!ALCHEMY_API_KEY) return { ageDays: 0, firstTxDate: null };

    try {
        // Get first outgoing tx
        const response = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "alchemy_getAssetTransfers",
                params: [{
                    fromAddress: address,
                    category: ["external", "erc20", "erc721", "erc1155"],
                    maxCount: "0x1",
                    order: "asc",
                    withMetadata: true
                }]
            })
        });
        const data = await response.json();

        let firstTx = data.result?.transfers?.[0];

        // Also check incoming txs
        const response2 = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "alchemy_getAssetTransfers",
                params: [{
                    toAddress: address,
                    category: ["external", "erc20", "erc721", "erc1155"],
                    maxCount: "0x1",
                    order: "asc",
                    withMetadata: true
                }]
            })
        });
        const data2 = await response2.json();
        const firstIncoming = data2.result?.transfers?.[0];

        // Use the earlier of the two
        if (firstIncoming?.metadata?.blockTimestamp) {
            if (!firstTx?.metadata?.blockTimestamp ||
                new Date(firstIncoming.metadata.blockTimestamp) < new Date(firstTx.metadata.blockTimestamp)) {
                firstTx = firstIncoming;
            }
        }

        if (firstTx?.metadata?.blockTimestamp) {
            const firstDate = new Date(firstTx.metadata.blockTimestamp);
            const now = new Date();
            const ageDays = Math.floor((now.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24));
            return { ageDays, firstTxDate: firstDate.toISOString() };
        }
    } catch (e) {
        console.error("[Alchemy] Error getting wallet age:", e);
    }

    return { ageDays: 0, firstTxDate: null };
}

/**
 * Get NFTs with floor prices
 */
export async function getNFTsWithFloorPrice(address: string): Promise<{ collection: string; tokenId: string; floorPriceEth: number | null }[]> {
    if (!ALCHEMY_API_KEY) return [];

    try {
        const response = await fetch(
            `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getNFTsForOwner?owner=${address}&withMetadata=true`,
            { method: 'GET' }
        );
        const data = await response.json();

        const nfts = (data.ownedNfts || []).map((nft: any) => ({
            collection: nft.contract?.name || nft.name || "Unknown",
            tokenId: nft.tokenId?.slice(0, 10) || "N/A",
            floorPriceEth: nft.contract?.openSeaMetadata?.floorPrice || null
        }));

        // Sort by floor price (highest first), nulls last
        nfts.sort((a: any, b: any) => {
            if (a.floorPriceEth === null && b.floorPriceEth === null) return 0;
            if (a.floorPriceEth === null) return 1;
            if (b.floorPriceEth === null) return -1;
            return b.floorPriceEth - a.floorPriceEth;
        });

        return nfts;
    } catch (e) {
        console.error("[Alchemy] Error getting NFTs:", e);
        return [];
    }
}

/**
 * Check if a transaction is spam
 */
function isSpamTransaction(tx: AlchemyHistoryItem): boolean {
    const spamPatterns = [
        /t\.me\//i,
        /claim/i,
        /airdrop/i,
        /visit/i,
        /http/i,
        /\.com/i,
        /reward/i,
        /free/i
    ];

    return spamPatterns.some(pattern => pattern.test(tx.asset));
}

/**
 * Analyze a wallet and return formatted markdown
 */
export async function analyzeWallet(address: string): Promise<string> {
    console.log(`[Alchemy] Analyzing wallet ${address}...`);

    // Fetch all data in parallel
    const [ensName, walletAge, analytics, nfts] = await Promise.all([
        getEnsName(address),
        getWalletAge(address),
        getWalletAnalytics(address),
        getNFTsWithFloorPrice(address)
    ]);

    if (!analytics) {
        return `Error: Could not analyze wallet ${address}`;
    }

    // Filter non-spam transactions and take last 10
    const nonSpamTxs = analytics.history
        .filter(tx => !isSpamTransaction(tx))
        .slice(0, 10);

    // Top 5 NFTs by floor price
    const top5NFTs = nfts.slice(0, 5);

    // Format output
    let output = `**Wallet Address:** ${address}\n`;
    output += `**ENS Name:** ${ensName || "None"}\n\n`;
    output += `**Total Portfolio Value:** $${analytics.portfolio.totalValueUsd.toFixed(2)}\n\n`;
    output += `**Wallet Age:** ${walletAge.ageDays} days\n\n`;

    // Token Holdings
    output += `--- TOKEN HOLDINGS ---\n\n`;
    output += `| Network | Token | Balance | Value (USD) |\n`;
    output += `|---------|-------|---------|-------------|\n`;
    for (const token of analytics.portfolio.tokens.slice(0, 10)) {
        output += `| ${token.network} | ${token.symbol} | ${token.balance.toFixed(6)} | $${token.valueUsd.toFixed(2)} |\n`;
    }

    // Top 5 NFTs
    output += `\n--- TOP 5 NFTs (by floor price) ---\n\n`;
    if (top5NFTs.length > 0) {
        output += `| NFT Collection | Token ID | Floor Price |\n`;
        output += `|----------------|----------|-------------|\n`;
        for (const nft of top5NFTs) {
            const price = nft.floorPriceEth !== null ? `${nft.floorPriceEth} ETH` : "N/A";
            output += `| ${nft.collection} | #${nft.tokenId} | ${price} |\n`;
        }
    } else {
        output += `No NFTs found.\n`;
    }

    // Recent Transactions
    output += `\n--- RECENT TRANSACTIONS (last 10, non-spam) ---\n\n`;
    if (nonSpamTxs.length > 0) {
        output += `| Network | Type | Asset | Amount | Counterparty |\n`;
        output += `|---------|------|-------|--------|--------------|\n`;
        for (const tx of nonSpamTxs) {
            const counterparty = tx.counterparty ? `${tx.counterparty.slice(0, 10)}...` : "N/A";
            output += `| ${tx.network} | ${tx.type} | ${tx.asset} | ${tx.amount.toFixed(4)} | ${counterparty} |\n`;
        }
    } else {
        output += `No recent transactions found.\n`;
    }

    return output;
}
