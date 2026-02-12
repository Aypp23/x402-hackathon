/**
 * Gemini Service with Price Oracle + Tavily Web Search
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { config } from "../config.js";
import { fetchPrice, PriceData } from "./price-oracle.js";
import {
    type PaidCallResult,
    fetchPaidNftCollection,
    fetchPaidNftSearch,
    fetchPaidNewsBreaking,
    fetchPaidNewsLatest,
    fetchPaidNewsSearch,
    fetchPaidNewsTrending,
    fetchPaidOraclePrice,
    fetchPaidPerpGlobal,
    fetchPaidPerpMarkets,
    fetchPaidScoutAnalysis,
    fetchPaidScoutBridges,
    fetchPaidScoutDex,
    fetchPaidScoutGas,
    fetchPaidScoutGasEstimate,
    fetchPaidScoutHacks,
    fetchPaidScoutProtocol,
    fetchPaidTokenomics,
    fetchPaidYieldAsset,
    fetchPaidYieldTop,
} from "./x402-agent-payments.js";
import { searchWeb as groqSearch } from "./groq.js";
import { getAgentPriceUsd, getSellerAddresses, type X402AgentId } from "./x402-common.js";
import { evaluatePaidToolPolicy, releasePolicyReservation } from "./agent-policy.js";

let genAI: GoogleGenerativeAI | null = null;

// Track oracle usage for this session
let oracleQueryCount = 0;
// Track chain scout usage for this session
let scoutQueryCount = 0;
// Track news scout usage for this session
let newsScoutQueryCount = 0;
// Track yield optimizer usage for this session
let yieldOptimizerQueryCount = 0;

export function initGemini(apiKey: string) {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log(`[Provider] Gemini initialized with model: ${config.gemini.model}`);
}

export function getOracleQueryCount(): number {
    return oracleQueryCount;
}

export function getScoutQueryCount(): number {
    return scoutQueryCount;
}

export function getNewsScoutQueryCount(): number {
    return newsScoutQueryCount;
}

export function getYieldOptimizerQueryCount(): number {
    return yieldOptimizerQueryCount;
}

interface PaidToolContext {
    sessionId?: string;
    traceId?: string;
}

interface PaidToolResult {
    data: string;
    txHash?: string;
    receiptRef?: string;
    endpoint?: string;
    priceUsd?: number;
    payTo?: string;
    latencyMs?: number;
    agentId?: X402AgentId;
}

const SELLER_PAY_TO = getSellerAddresses();

function toPaidToolResult<T>(agentId: X402AgentId, endpoint: string, paid: PaidCallResult<T>): PaidToolResult {
    return {
        data: JSON.stringify(paid.data),
        txHash: paid.payment.txHash,
        receiptRef: paid.payment.receiptRef,
        endpoint,
        priceUsd: getAgentPriceUsd(agentId),
        payTo: SELLER_PAY_TO[agentId],
        latencyMs: paid.payment.latencyMs,
        agentId,
    };
}

// Function to handle wallet analysis
async function handleAnalyzeWallet(address: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 🔍 Paid wallet analysis: ${address}`);
    scoutQueryCount++;

    const endpoint = `/api/x402/scout/analyze?address=${encodeURIComponent(address)}`;
    const paid = await fetchPaidScoutAnalysis(address, context);
    const report = paid.data as any;

    if (!report) {
        return { data: JSON.stringify({ error: `Could not analyze wallet ${address}.` }) };
    }

    return {
        ...toPaidToolResult('scout', endpoint, paid),
        data: JSON.stringify({
            address: report.address,
            ensName: report.ensName || null,
            type: report.isContract ? "Smart Contract" : "Wallet (EOA)",
            portfolioValueUsd: report.portfolio?.totalValueUsd || 0,
            walletAgeDays: report.walletAgeDays || 0,
            txCount: report.txCount,
            labels: report.labels,
            topTokens: report.portfolio?.tokens
                ?.filter((t: any) => t.valueUsd >= 1.0)
                ?.sort((a: any, b: any) => b.valueUsd - a.valueUsd)
                ?.slice(0, 10)
                ?.map((t: any) => ({
                    symbol: t.symbol,
                    network: String(t.network || '').replace('-mainnet', ''),
                    balance: t.balance,
                    valueUsd: t.valueUsd
                })) || [],
            topNfts: report.nftsWithFloorPrice?.slice(0, 5).map((n: any) => ({
                collection: n.collection,
                tokenId: n.tokenId,
                floorPriceEth: n.floorPriceEth
            })) || [],
            recentTransactions: report.history?.slice(0, 10).map((tx: any) => ({
                type: tx.type,
                asset: tx.asset,
                amount: tx.amount,
                network: String(tx.network || '').replace('-mainnet', '')
            })) || [],
            etherscanUrl: `https://etherscan.io/address/${report.address}#asset-multichain`
        }),
    };
}

// Function to handle DEX volume queries
async function handleGetDexVolume(chain: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 📈 Paid DEX volume query: ${chain}`);
    scoutQueryCount++;

    const endpoint = `/api/x402/scout/dex?chain=${encodeURIComponent(chain)}`;
    const paid = await fetchPaidScoutDex(chain, context);
    const report = paid.data as any;

    if (!report) {
        return { data: JSON.stringify({ error: `Could not get DEX volume for ${chain}.` }) };
    }

    return {
        ...toPaidToolResult('scout', endpoint, paid),
        data: JSON.stringify({
            chain: report.chain,
            totalVolume24h: report.totalVolume24h,
            topDexes: report.topDexes?.slice(0, 5).map((d: any) => ({
                name: d.name,
                volume24h: d.volume24h,
                change24h: d.change24h
            })) || [],
        }),
    };
}

// Function to handle gas price queries
async function handleGetGasPrice(context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] ⛽ Paid gas price query`);
    scoutQueryCount++;

    const endpoint = '/api/x402/scout/gas';
    const [paid, ethPriceData] = await Promise.all([
        fetchPaidScoutGas(context),
        fetchPrice("ethereum"),
    ]);

    const gasPrices = paid.data as any;
    const ethPrice = ethPriceData ? ethPriceData.price : 0;

    return {
        ...toPaidToolResult('scout', endpoint, paid),
        data: JSON.stringify({
            low: gasPrices?.low,
            average: gasPrices?.average,
            fast: gasPrices?.fast,
            baseFee: gasPrices?.baseFee,
            ethPriceUsd: ethPrice,
        }),
    };
}

// Function to handle gas estimate queries
async function handleGetGasEstimate(operation: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 🧮 Paid gas estimate query: ${operation}`);
    scoutQueryCount++;

    const endpoint = `/api/x402/scout/gas-estimate?operation=${encodeURIComponent(operation)}`;
    const paid = await fetchPaidScoutGasEstimate(operation, context);
    const estimate = paid.data as any;

    if (!estimate) {
        return { data: JSON.stringify({ error: `Could not estimate cost for ${operation}.` }) };
    }

    return {
        ...toPaidToolResult('scout', endpoint, paid),
        data: JSON.stringify({
            operation: estimate.operation,
            gasLimit: estimate.gasLimit,
            gasPriceGwei: estimate.gasPriceGwei,
            ethCost: estimate.ethCost,
            usdCost: estimate.usdCost,
            formattedReport: `Estimated Cost for **${operation.replace(/_/g, " ").toUpperCase()}**:\n${estimate.formattedCost}\n_(Based on ${Number(estimate.gasPriceGwei || 0).toFixed(2)} Gwei)_`
        }),
    };
}

// Function to handle protocol stats queries
async function handleGetProtocolStats(protocol: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 📊 Paid protocol stats query: ${protocol}`);
    scoutQueryCount++;

    const endpoint = `/api/x402/scout/protocol?protocol=${encodeURIComponent(protocol)}`;
    const paid = await fetchPaidScoutProtocol(protocol, context);
    const stats = paid.data as any;

    if (!stats) {
        return { data: JSON.stringify({ error: `Could not find protocol: ${protocol}.` }) };
    }

    return {
        ...toPaidToolResult('scout', endpoint, paid),
        data: JSON.stringify({
            name: stats.name,
            category: stats.category,
            symbol: stats.symbol,
            tvl: stats.tvl,
            tvlChange24h: stats.tvlChange24h,
            mcap: stats.mcap,
            fees24h: stats.fees24h,
            fees7d: stats.fees7d,
            fees30d: stats.fees30d,
            revenue24h: stats.revenue24h,
            revenue7d: stats.revenue7d,
            chains: stats.chains?.slice(0, 8) || [],
            url: stats.url,
        }),
    };
}

// Function to handle bridges queries
async function handleGetBridges(context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 🌉 Paid bridges query`);
    scoutQueryCount++;

    const endpoint = '/api/x402/scout/bridges';
    const paid = await fetchPaidScoutBridges(context);
    const bridges = paid.data as any[];

    if (!bridges) {
        return { data: JSON.stringify({ error: "Could not fetch bridge data." }) };
    }

    return {
        ...toPaidToolResult('scout', endpoint, paid),
        data: JSON.stringify({
            count: bridges.length,
            topBridges: bridges.slice(0, 5).map((b: any) => ({
                name: b.displayName,
                volume24h: b.volume24h,
                volumeWeekly: b.volumeWeekly,
            })),
        }),
    };
}

const SYSTEM_PROMPT = `You are Arcana Agent, a cryptocurrency and blockchain-focused AI assistant.

**IMPORTANT CONTEXT:**
- You operate exclusively in the crypto/blockchain/DeFi space
- When users mention names like "AAVE", "UNI", "CAKE", etc., they are ALWAYS referring to cryptocurrency tokens/protocols, never anything else
- Do NOT mention alternative meanings
- Assume all questions are crypto-related unless explicitly stated otherwise

**Your Capabilities:**
- You have access to a PRICE ORACLE tool for real-time cryptocurrency prices
- You have access to web search for news and current events
- You have access to ON-CHAIN ANALYTICS for wallet analysis and DEX volume data
- You can check current ETHEREUM GAS PRICES
- You can get PROTOCOL STATS (TVL, fees, revenue) for DeFi protocols
- You can list TOP BRIDGES by volume
- You can lookup RECENT DEFI HACKS and exploits
- You can analyze images and provide insights
- When asked about prices, USE the getPriceData function
- When asked about a wallet address (0x...), USE the analyzeWallet function
- When asked about DEX volume or trading activity, USE the getDexVolume function
- When asked about gas prices or transaction costs, USE the getGasPrice function
- When asked about protocol TVL or fees (Aave, Uniswap, etc.), USE the getProtocolStats function
- When asked about bridges or cross-chain volume, USE the getBridges function
- When asked about DeFi hacks or exploits, USE the getHacks function
- When asked about transaction costs (gas fees) for specific actions like swapping, bridging, or sending tokens, USE the getGasEstimate function
- When asked about crypto news, headlines, or what's happening in crypto, USE the getNews function
- When asked about trending topics or market sentiment, USE the getTrending function
- When asked about DeFi yields, APY, staking rates, or where to earn yield, USE the getYields function


**When Users Ask About Crypto Prices:**
- YOU MUST ALWAYS call getPriceData for ANY question about prices, costs, or values of cryptocurrencies
- NEVER answer price questions from your knowledge or memory - ALWAYS use the tool
- This includes questions like "price of X", "how much is X", "what's X worth", "X price", etc.
- Include the price, 24h change, and market cap in your response

**When Users Provide a Wallet Address:**
- Use analyzeWallet to get comprehensive wallet data
- Present the results naturally and conversationally
- Start with a header showing wallet address and ENS name (if any)
- Show portfolio value prominently (e.g., "💰 Total Value: $80.5K")
- List top token holdings with network, balance, and USD value
- Show top NFTs with floor prices
- Show recent transactions (last 10) with type, asset, amount, network
- Use bullet points for token and NFT lists
- Format large numbers nicely ($73K, $2.4K, etc.)
- **NEVER** add backticks around wallet addresses (e.g. use 0x123... not "0x123...")
- **ALWAYS** end the response with a link: "[see more](etherscanUrl)" using the 'etherscanUrl' provided in the tool output.

**When Presenting Protocol Stats, DEX Volume, Bridges, or Hacks:**
- Present the data in a natural, conversational way
- Use emojis to make it visually appealing (📊 for stats, 📈 for increases, 📉 for decreases)
- Format large numbers nicely (e.g., $4.2B, $810K)
- Highlight the most important metrics first
- Example: "Uniswap is a DEX with $4.2B TVL. In the last 24h, it generated $810K in fees."

**When Presenting News or Trending Topics:**
- Present news headlines in a clean, scannable format
- For latest/general crypto news requests, show up to 10 headlines by default (unless user asks for fewer)
- If fewer than 10 are available from the tool, show all available and state the count briefly
- **Format each item exactly like this:**
  * 📰 **Headline**
    > Detailed summary/description (approx. 2 sentences)
    [Source Name](url) • Time
- Example: 
  "📰 **Bitcoin ETF inflows hit record high**
   > Institutional interest surges as daily volume tops $1B. The trend signals growing confidence in crypto assets.
   [CoinDesk](https://coindesk.com/...) • 2h ago"

**When Presenting Yield Opportunities:**
- Be conversational and helpful, not just a data dump
- Start with a brief summary: "Here are the top yield opportunities I found across 6 protocols..."
- Group by risk level when relevant (LOW/MEDIUM/HIGH)
- Include clickable links: [Protocol Name](url)
- Format APY nicely (2970% not 2970.01%)
- Mention TVL when available to show liquidity depth
- Add context about risks for HIGH risk opportunities
- **Format Risk with colors:** 🟢 LOW, 🟡 MEDIUM, 🔴 HIGH
- **Format each yield like this:**
  * 🏛️ **[Yearn](https://yearn.fi)** - Morpho USDC Compounder
    APY: **2970%** | Chain: Ethereum | Risk: 🔴 HIGH
    TVL: $15M | Type: Vault
- For user questions about "where to put money", provide personalized advice based on:
  * Their risk tolerance (mentioned or implied)
  * Time horizon (if mentioned)
  * Asset type (USDC, ETH, stablecoins)
  * Realistic expectations (explain if a goal like "double in 6 months" requires extreme risk)


**When Presenting Perp Stats:**
- **Global Stats:** Always use a bulleted list for readability.
  Example:
  * 🌍 **Global Perpetual Market Stats**
    • **Total Open Interest:** $8.7B
    • **24h Volume:** $204M
    • **Active Exchanges:** Hyperliquid, dYdX, Lighter, Pacifica
    • **Total Markets:** 651
- **Market Lists:** Use a clean list format with emojis.
  Example:
  * 📈 **BTC-USD** (dYdX)
    Price: $65,000 | Funding: 0.0012% | OI: $50M

- **Comparisons (Same Asset, Multiple Exchanges):**
  **ALWAYS** use a Markdown Table for comparing data across exchanges.
  Example:
  | Exchange | Price | Funding (1h) | Open Interest |
  | :--- | :--- | :--- | :--- |
  | **Hyperliquid** | $65,100 | 0.001% | $50M |
  | **dYdX** | $65,050 | 0.002% | $45M |
  | **Pacifica** | $65,120 | 0.001% | $12M |

**Your Personality:**
- Be concise but thorough — users are paying $0.02 per query
- Be friendly, helpful, and direct. Avoid fluff.
- Format responses with markdown when it improves readability
- Use bullet points for lists of items (DEXs, bridges, etc.)

**About Payments:**
- Paid tool calls settle via x402 on Base Sepolia (network eip155:84532)
- When you use paid tools, micro-payments are sent to the corresponding agent wallet
- Use tool outputs directly and do not invent receipt or pricing details

Always provide accurate, up-to-date information. Cite sources when relevant.`;

// Function declaration for price oracle
const getPriceDataFunction = {
    name: "getPriceData",
    description: "Get real-time cryptocurrency price data. Use this when users ask about crypto prices, market caps, or 24h changes. Supports: bitcoin, ethereum, solana, usdc, usdt, bnb, xrp, ada, doge, xpl, arb, op, sui, and 100+ more tokens.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            symbol: {
                type: SchemaType.STRING,
                description: "The cryptocurrency symbol or name, e.g., 'bitcoin', 'ethereum', 'btc', 'eth', 'sol', 'xpl'",
            },
        },
        required: ["symbol"],
    },
};

// Function declaration for web search
const searchWebFunction = {
    name: "searchWeb",
    description: "Search the web for real-time information. Use this for news, current events, company information, general knowledge questions, or anything that requires up-to-date web information.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            query: {
                type: SchemaType.STRING,
                description: "The search query to look up on the web",
            },
        },
        required: ["query"],
    },
};

// Function declaration for wallet analysis
const analyzeWalletFunction = {
    name: "analyzeWallet",
    description: "Analyze an Ethereum wallet address to get balance, transaction history, token transfers, and identify if it's a whale or DeFi user. Use when users ask about a specific wallet address.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            address: {
                type: SchemaType.STRING,
                description: "The Ethereum wallet address to analyze (0x...)",
            },
        },
        required: ["address"],
    },
};

// Function declaration for DEX volume
const getDexVolumeFunction = {
    name: "getDexVolume",
    description: "Get DEX (decentralized exchange) trading volume data for a specific blockchain. Shows top DEXs and their 24h volume. Supported chains: ethereum, arbitrum, optimism, polygon, base, avalanche, bsc, etc.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            chain: {
                type: SchemaType.STRING,
                description: "The blockchain to get DEX volume for (default: ethereum)",
            },
        },
        required: ["chain"],
    },
};

// Function declaration for gas prices
const getGasPriceFunction = {
    name: "getGasPrice",
    description: "Get current Ethereum gas prices. Returns low, average, and fast gas prices in Gwei. Use when users ask about gas costs, transaction timing, or network congestion.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for gas cost estimation
const getGasEstimateFunction = {
    name: "getGasEstimate",
    description: "Calculate estimated ETH and USD cost for specific transaction types (transfer, swap, bridge) based on current gas prices. Use when users ask 'How much to send ETH?' or 'Cost to swap tokens?'.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            operation: {
                type: SchemaType.STRING,
                enum: ["eth_transfer", "erc20_transfer", "nft_transfer", "swap_dex", "bridge"],
                description: "The type of transaction to estimate cost for.",
            }
        },
        required: ["operation"],
    },
};

// Function declaration for protocol stats
const getProtocolStatsFunction = {
    name: "getProtocolStats",
    description: "Get detailed stats for a DeFi protocol including TVL, fees, revenue. Use when users ask about protocol metrics like 'What's Aave's TVL?' or 'Uniswap fees?'. Supports: aave, uniswap, lido, makerdao, compound, curve, etc.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            protocol: {
                type: SchemaType.STRING,
                description: "The protocol name (e.g., 'aave', 'uniswap', 'lido', 'compound')",
            },
        },
        required: ["protocol"],
    },
};

// Function declaration for bridges
const getBridgesFunction = {
    name: "getBridges",
    description: "Get top cross-chain bridges by volume. Shows 24h and weekly bridge volumes. Use when users ask about bridge activity or cross-chain transfers.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for hacks
const getHacksFunction = {
    name: "getHacks",
    description: "Get recent DeFi hacks and exploits database. Shows protocol name, amount lost, and attack type. Use when users ask about security incidents or recent exploits.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for crypto news
const getNewsFunction = {
    name: "getNews",
    description: "Get latest crypto news headlines from trusted sources (CoinDesk, The Block, Decrypt, CoinTelegraph, etc.). Use when users ask about 'crypto news', 'what's happening', 'latest news', 'headlines', or news about specific topics. Return up to 10 headlines unless the user requests a different count.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            query: {
                type: SchemaType.STRING,
                description: "Optional search query to filter news by topic (e.g., 'solana', 'ethereum', 'regulatory')"
            },
            category: {
                type: SchemaType.STRING,
                enum: ["all", "bitcoin", "defi", "breaking"],
                description: "News category to filter by. Use 'breaking' for urgent news, 'bitcoin' for BTC-focused, 'defi' for DeFi news."
            }
        },
        required: [],
    },
};

// Function declaration for trending topics
const getTrendingFunction = {
    name: "getTrending",
    description: "Get trending topics in crypto with sentiment analysis. Shows what's being talked about most, with bullish/bearish/neutral sentiment. Use when users ask about 'what's trending', 'hot topics', or 'market sentiment'.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for yield optimizer
const getYieldsFunction = {
    name: "getYields",
    description: "Get DeFi yield opportunities from Lido, Yearn, Beefy, Curve, Aave, Pendle, and Turtle. Use when users ask about 'best yields', 'APY', 'where to earn', 'staking rates', 'vault yields', 'show more yields', 'lending rates', or mention any of these protocols by name (including 'Turtle'). Supports filtering by chain, asset, type, APY range (min/max), and pagination. IMPORTANT: Always explicitly state the total number of opportunities found (from the 'totalCount' field) in your response before listing them.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            chain: {
                type: SchemaType.STRING,
                description: "Filter by blockchain (ethereum, arbitrum, polygon, optimism, base)",
            },
            asset: {
                type: SchemaType.STRING,
                description: "Filter by asset (ETH, USDC, USDT, DAI, stETH, etc.)",
            },
            protocol: {
                type: SchemaType.STRING,
                enum: ["lido", "aave", "yearn", "beefy", "curve", "pendle", "turtle"],
                description: "Filter by specific protocol (Lido, Aave, Yearn, Beefy, Curve, Pendle, Turtle). Use when user asks about a specific protocol.",
            },
            type: {
                type: SchemaType.STRING,
                enum: ["staking", "lending", "vault", "lp", "fixed"],
                description: "Filter by yield type: staking (Lido), lending (Aave/Turtle), vault (Yearn/Beefy/Turtle), lp (Curve), fixed (Pendle)",
            },
            minApy: {
                type: SchemaType.NUMBER,
                description: "Minimum APY percentage to filter (e.g., 10 for 10%+)",
            },
            maxApy: {
                type: SchemaType.NUMBER,
                description: "Maximum APY percentage to filter (e.g., 20 for up to 20%). Use with minApy for range queries like '10-20% APY'.",
            },
            page: {
                type: SchemaType.NUMBER,
                description: "Page number for pagination (1-based). Use when user says 'show more' or 'next page'. Default is 1.",
            },
        },
        required: [],
    },
};

// Function declaration for tokenomics analyzer
const getTokenomicsFunction = {
    name: "getTokenomics",
    description: "Get tokenomics analysis for a cryptocurrency including supply data, vesting schedule, token unlocks, allocation breakdown, and inflation rate. Use when users ask about 'tokenomics', 'vesting', 'unlock schedule', 'token distribution', 'supply', or 'inflation' for a specific token. Supports ARB, OP, SUI, APT, ETH, SOL, and many more tokens.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            symbol: {
                type: SchemaType.STRING,
                description: "Token symbol (e.g., ARB, OP, SUI, APT, ETH, SOL)",
            },
        },
        required: ["symbol"],
    },
};

// Function declaration for NFT Collection Stats
const getNftCollectionStatsFunction = {
    name: "getNftCollectionStats",
    description: "Get comprehensive statistics and market analysis for an NFT collection. Includes floor price, volume, market cap, num owners, and sales sales trends. Use when users ask about 'floor price', 'volume', 'market cap', or 'stats' for a specific NFT collection.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            slug: {
                type: SchemaType.STRING,
                description: "The collection slug (e.g., 'pudgy-penguins', 'bored-ape-yacht-club'). If the user provides a name, use searchNftCollections first to find the slug if unsure.",
            },
        },
        required: ["slug"],
    },
};

// Function declaration for NFT Collection Search
const searchNftCollectionsFunction = {
    name: "searchNftCollections",
    description: "Search for NFT collections by name to find their slug and image. Use this when the user mentions a collection name (e.g. 'Pudgy', 'Azuki') to get the correct slug for getNftCollectionStats.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            query: {
                type: SchemaType.STRING,
                description: "Search query for collection name",
            },
        },
        required: ["query"],
    },
};

// Function declaration for Perp Global Stats
const getGlobalPerpStatsFunction = {
    name: "getGlobalPerpStats",
    description: "Get aggregated global perpetual market statistics including Total Open Interest and Total 24h Volume across all exchanges. Use when users ask about 'market open interest', 'total crypto perp volume', or general market activity levels.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {},
        required: [],
    },
};

// Function declaration for Perp Markets
const getPerpMarketsFunction = {
    name: "getPerpMarkets",
    description: "Get funding rates, open interest, and volume for specific perpetual markets. Use when users ask about 'funding rates for BTC', 'best funding yields', 'open interest on ETH', 'who has highest funding', 'negative funding rates'.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            symbol: {
                type: SchemaType.STRING,
                description: "Optional: Filter by token symbol (e.g. BTC, ETH, SOL). If omitted, returns top markets.",
            },
        },
        required: [],
    },
};

export interface ImageData {
    base64: string;
    mimeType: string;
}

export interface ConversationMessage {
    role: "user" | "model";
    content: string;
}

// Function to handle price oracle calls with payment tracking
async function handleGetPriceData(symbol: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 🔮 Paid oracle query: ${symbol}`);
    oracleQueryCount++;

    const endpoint = `/api/x402/oracle/price?symbol=${encodeURIComponent(symbol)}`;
    const paid = await fetchPaidOraclePrice(symbol, context);
    const priceData = paid.data as PriceData;

    if (!priceData) {
        return { data: JSON.stringify({ error: `Could not find price data for ${symbol}` }) };
    }

    return {
        ...toPaidToolResult('oracle', endpoint, paid),
        data: JSON.stringify({
            symbol: priceData.symbol,
            name: priceData.name,
            price: priceData.price,
            currency: priceData.currency,
            change24h: priceData.change24h,
            marketCap: priceData.marketCap,
            volume24h: priceData.volume24h,
            lastUpdated: priceData.lastUpdated,
        }),
    };
}

// Function to handle web search calls
async function handleSearchWeb(query: string): Promise<string> {
    console.log(`[Gemini] 🌐 Searching web for: "${query}"...`);

    const searchResult = await groqSearch(query);

    if (!searchResult) {
        return JSON.stringify({
            system_note: "Web search failed (Rate Limit or Error). Please answer the user's question using your internal knowledge, but mention that you couldn't verify with live search."
        });
    }

    return JSON.stringify({
        query: searchResult.query,
        answer: searchResult.answer, // Groq's synthesized summary
        sources: searchResult.results.map(r => ({
            title: r.title,
            url: r.url,
            content: r.content,
        })),
    });
}



// Function to handle hacks queries
async function handleGetHacks(context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] ⚠️ Paid hacks query`);
    scoutQueryCount++;

    const endpoint = '/api/x402/scout/hacks';
    const paid = await fetchPaidScoutHacks(context);
    const hacks = paid.data as any[];

    if (!hacks) {
        return { data: JSON.stringify({ error: "Could not fetch hacks data. Try again later." }) };
    }

    return {
        ...toPaidToolResult('scout', endpoint, paid),
        data: JSON.stringify({
            count: hacks.length,
            recentHacks: hacks.slice(0, 7).map((h: any) => ({
                name: h.name,
                amount: h.amount,
                date: new Date(h.date).toLocaleDateString(),
                classification: h.classification,
                technique: h.technique,
                targetType: h.targetType,
                source: h.source,
                returnedFunds: h.returnedFunds,
                isBridgeHack: h.bridgeHack
            })),
        }),
    };
}

// Function to handle crypto news queries
async function handleGetNews(query?: string, category?: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 📰 Paid news query="${query || 'none'}" category="${category || 'all'}"`);
    newsScoutQueryCount++;

    const newsFetchLimit = 10;
    const displayLimit = 10;

    let endpoint = '/api/x402/news/latest';
    let paid: PaidCallResult<any>;

    if (category === "breaking") {
        endpoint = '/api/x402/news/breaking';
        paid = await fetchPaidNewsBreaking(context);
    } else if (query) {
        endpoint = `/api/x402/news/search?query=${encodeURIComponent(query)}&limit=${newsFetchLimit}`;
        paid = await fetchPaidNewsSearch(query, newsFetchLimit, context);
    } else if (category === "bitcoin" || category === "defi") {
        endpoint = `/api/x402/news/search?query=${encodeURIComponent(category)}&limit=${newsFetchLimit}`;
        paid = await fetchPaidNewsSearch(category, newsFetchLimit, context);
    } else {
        endpoint = `/api/x402/news/latest?limit=${newsFetchLimit}`;
        paid = await fetchPaidNewsLatest(newsFetchLimit, context);
    }

    const news = paid.data as any;
    const rawArticles = Array.isArray(news?.articles) ? news.articles : [];
    const dedupedArticles: any[] = [];
    const seenArticleKeys = new Set<string>();

    for (const article of rawArticles) {
        const title = String(article?.title || '').trim();
        const link = String(article?.link || '').trim();
        const key = (link || title).toLowerCase();
        if (!key || seenArticleKeys.has(key)) continue;
        seenArticleKeys.add(key);
        dedupedArticles.push(article);
    }

    const articles = dedupedArticles.slice(0, displayLimit);

    if (articles.length === 0) {
        return { data: JSON.stringify({ error: "Could not fetch news data. Try again later." }) };
    }

    return {
        ...toPaidToolResult('news', endpoint, paid),
        data: JSON.stringify({
            articles: articles.map((a: any) => ({
                title: a.title,
                description: a.description,
                link: a.link,
                source: a.source,
                timeAgo: a.timeAgo
            })),
            totalCount: news.totalCount || rawArticles.length || articles.length,
            displayedCount: articles.length,
            requestedCount: displayLimit,
            sources: news.sources || [],
            fetchedAt: news.fetchedAt || new Date().toISOString()
        }),
    };
}

// Function to handle trending topics
async function handleGetTrending(context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 📈 Paid trending query`);
    newsScoutQueryCount++;

    const endpoint = '/api/x402/news/trending';
    const paid = await fetchPaidNewsTrending(context);
    const trending = paid.data as any;

    if (!trending) {
        return { data: JSON.stringify({ error: "Could not fetch trending data. Try again later." }) };
    }

    return {
        ...toPaidToolResult('news', endpoint, paid),
        data: JSON.stringify({
            trending: (trending.trending || []).slice(0, 5).map((t: any) => ({
                topic: t.topic,
                count: t.count,
                sentiment: t.sentiment,
                headline: t.recentHeadlines?.[0] || null
            })),
            articlesAnalyzed: trending.articlesAnalyzed,
            timeWindow: trending.timeWindow
        }),
    };
}

// Function to handle yield queries
async function handleGetYields(
    options?: { chain?: string; type?: string; minApy?: number; maxApy?: number; asset?: string; protocol?: string; page?: number },
    context?: PaidToolContext
): Promise<PaidToolResult> {
    console.log(`[Gemini] 🌾 Paid yield query`, options);

    try {
        const page = options?.page || 1;
        const pageSize = 20;
        let endpoint = '/api/x402/yield/top';
        let paid: PaidCallResult<any>;
        let opportunities: any[] = [];
        let totalCount = 0;
        let fetchedAt = new Date().toISOString();

        yieldOptimizerQueryCount++;

        if (options?.asset) {
            endpoint = `/api/x402/yield/asset?token=${encodeURIComponent(options.asset)}`;
            paid = await fetchPaidYieldAsset(options.asset, context);
            opportunities = Array.isArray(paid.data) ? paid.data : [];
            totalCount = opportunities.length;
        } else {
            const params = {
                chain: options?.chain,
                type: options?.type,
                protocol: options?.protocol,
                minApy: options?.minApy,
                maxApy: options?.maxApy,
                limit: 100,
            };
            const query = new URLSearchParams();
            if (params.chain) query.set('chain', params.chain);
            if (params.type) query.set('type', params.type);
            if (params.protocol) query.set('protocol', params.protocol);
            if (typeof params.minApy === 'number') query.set('minApy', String(params.minApy));
            if (typeof params.maxApy === 'number') query.set('maxApy', String(params.maxApy));
            query.set('limit', String(params.limit));
            endpoint = `/api/x402/yield/top?${query.toString()}`;

            paid = await fetchPaidYieldTop(params, context);
            opportunities = paid.data?.opportunities || [];
            totalCount = paid.data?.totalCount || opportunities.length;
            fetchedAt = paid.data?.fetchedAt || fetchedAt;
        }

        if (!opportunities || opportunities.length === 0) {
            return { data: JSON.stringify({ error: "No yield opportunities found matching your criteria. Try different filters." }) };
        }

        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginated = opportunities.slice(startIndex, endIndex);
        const totalPages = Math.ceil(totalCount / pageSize);
        const hasMore = page < totalPages;

        return {
            ...toPaidToolResult('yield', endpoint, paid),
            data: JSON.stringify({
                opportunities: paginated.map((y: any) => ({
                    protocol: y.protocol,
                    name: y.name,
                    asset: y.asset,
                    apy: y.apy,
                    tvl: y.tvl,
                    chain: y.chain,
                    risk: y.risk,
                    type: y.type,
                    url: y.url
                })),
                showing: paginated.length,
                totalCount,
                page,
                totalPages,
                hasMore,
                nextPageHint: hasMore ? `Say "show more yields" or "page ${page + 1}" to see more` : null,
                fetchedAt,
            }),
        };
    } catch (error) {
        console.error("[Gemini] Yield fetch error:", error);
        return { data: JSON.stringify({ error: "Failed to fetch yield data. Try again later." }) };
    }
}

// Track tokenomics usage for this session
let tokenomicsQueryCount = 0;

export function getTokenomicsQueryCount(): number {
    return tokenomicsQueryCount;
}

// Track perp stats usage
let perpStatsQueryCount = 0;

export function getPerpStatsQueryCount(): number {
    return perpStatsQueryCount;
}

// Function to handle Global Perp Stats
async function handleGetGlobalPerpStats(context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 📊 Paid global perp stats query`);

    try {
        perpStatsQueryCount++;
        const endpoint = '/api/x402/perp/global';
        const paid = await fetchPaidPerpGlobal(context);
        return {
            ...toPaidToolResult('perp', endpoint, paid),
            data: JSON.stringify(paid.data),
        };
    } catch (error) {
        console.error("Perp Stats Error:", error);
        return { data: JSON.stringify({ error: "Failed to fetch global perp stats." }) };
    }
}

// Function to handle Perp Markets
async function handleGetPerpMarkets(symbol?: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 📈 Paid perp markets query${symbol ? ` for ${symbol}` : ''}`);

    try {
        perpStatsQueryCount++;
        const endpoint = '/api/x402/perp/markets';
        const paid = await fetchPaidPerpMarkets(context);
        let markets = Array.isArray(paid.data) ? [...paid.data] as any[] : [];

        if (symbol) {
            let s = symbol.toUpperCase();
            const MAPPINGS: Record<string, string> = {
                "BITCOIN": "BTC",
                "ETHEREUM": "ETH",
                "SOLANA": "SOL",
                "RIPPLE": "XRP",
                "CARDANO": "ADA",
                "DOGECOIN": "DOGE",
                "AVALANCHE": "AVAX",
                "MATIC": "POL",
                "POLYGON": "POL"
            };
            if (MAPPINGS[s]) s = MAPPINGS[s];

            markets = markets.filter((m: any) => {
                const mSym = String(m.symbol || '').toUpperCase();
                return mSym === s || mSym.includes(s) || mSym.replace(/[-_]/g, '') === s;
            });

            if (markets.length === 0) {
                return { data: JSON.stringify({ error: `No perp markets found matching "${symbol}".` }) };
            }
        } else {
            markets = markets.sort((a: any, b: any) => (b.openInterestUsd || 0) - (a.openInterestUsd || 0)).slice(0, 60);
        }

        return {
            ...toPaidToolResult('perp', endpoint, paid),
            data: JSON.stringify({ markets }),
        };
    } catch (error) {
        console.error("Perp Stats Error:", error);
        return { data: JSON.stringify({ error: "Failed to fetch perp markets." }) };
    }
}

// Function to handle NFT Stats
async function handleGetNftCollectionStats(slug: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 🎨 Paid NFT stats query: ${slug}`);

    try {
        const endpoint = `/api/x402/scout/nft/${encodeURIComponent(slug)}`;
        const paid = await fetchPaidNftCollection(slug, context);
        return {
            ...toPaidToolResult('nft', endpoint, paid),
            data: JSON.stringify(paid.data),
        };
    } catch (error) {
        console.error("NFT Scout Error:", error);
        return { data: JSON.stringify({ error: `Failed to fetch NFT stats for ${slug}. Please check the slug.` }) };
    }
}

// Function to handle NFT Search
async function handleSearchNftCollections(query: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 🔍 Paid NFT search query: ${query}`);

    try {
        const endpoint = `/api/x402/scout/search?q=${encodeURIComponent(query)}`;
        const paid = await fetchPaidNftSearch(query, context);
        return {
            ...toPaidToolResult('nft', endpoint, paid),
            data: JSON.stringify({ results: paid.data }),
        };
    } catch (error) {
        console.error("NFT Search Error:", error);
        return { data: JSON.stringify({ error: `Failed to search collections for ${query}.` }) };
    }
}

// Function to handle tokenomics analysis
async function handleGetTokenomics(symbol: string, context?: PaidToolContext): Promise<PaidToolResult> {
    console.log(`[Gemini] 📊 Paid tokenomics query: ${symbol}`);
    tokenomicsQueryCount++;

    const endpoint = `/api/x402/tokenomics/analyze?symbol=${encodeURIComponent(symbol)}`;
    const paid = await fetchPaidTokenomics(symbol, context);
    const analysis = paid.data as any;

    if (!analysis) {
        return { data: JSON.stringify({ error: `Could not find tokenomics data for ${symbol}.` }) };
    }

    const hasUnlocks = (analysis.upcomingUnlocks || []).length > 0;
    const isFullyCirculating = (analysis.supply?.percentUnlocked || 0) >= 99;

    return {
        ...toPaidToolResult('tokenomics', endpoint, paid),
        data: JSON.stringify({
            symbol: analysis.symbol,
            name: analysis.name,
            supply: {
                circulating: analysis.supply?.circulatingFormatted,
                total: analysis.supply?.totalFormatted,
                max: analysis.supply?.maxFormatted,
                percentUnlocked: `${analysis.supply?.percentUnlocked}%`,
            },
            nextUnlock: analysis.nextUnlock ? {
                date: analysis.nextUnlock.date,
                amount: analysis.nextUnlock.amountFormatted,
                percentOfCirculating: `${analysis.nextUnlock.percentOfCirculating}%`,
                recipient: analysis.nextUnlock.recipient,
                riskLevel: analysis.nextUnlock.riskLevel,
            } : null,
            noUnlocksNote: !hasUnlocks ? (
                isFullyCirculating
                    ? "This token is fully circulating with no locked supply remaining."
                    : "Detailed unlock schedule data is not available for this token. Check sources like Token Unlocks or project docs."
            ) : null,
            upcomingUnlocks: (analysis.upcomingUnlocks || []).slice(0, 3).map((u: any) =>
                `${u.date}: ${u.amountFormatted} (${u.percentOfCirculating}% of circ supply) - ${u.riskLevel}`
            ),
            allocations: (analysis.allocations || []).map((a: any) => `${a.category}: ${a.percentage}%`),
            inflation: analysis.inflation,
            fetchedAt: analysis.fetchedAt,
        }),
    };
}

export interface GenerateResponseResult {
    response: string;
    agentsUsed: string[];
    x402Transactions: Record<string, string>;
    totalSpendUsd: number;
    trace: X402TraceSummary;
}

export interface GenerateResponseOptions {
    sessionId?: string;
    traceId?: string;
    budgetUsd?: number;
    spentUsdStart?: number;
}

export interface X402TraceStep {
    stepIndex: number;
    toolName: string;
    endpoint: string;
    quotedPriceUsd: number;
    reason: string;
    budgetBeforeUsd: number;
    budgetAfterUsd: number;
    outcome: 'success' | 'skipped' | 'failed';
    receiptRef?: string;
    latencyMs?: number;
}

export interface X402TraceSummary {
    traceId: string;
    sessionId?: string;
    userPrompt?: string;
    createdAt: string;
    budget: {
        limitUsd: number;
        spentUsdStart: number;
        spentUsdEnd: number;
        remainingUsdEnd: number;
    };
    steps: X402TraceStep[];
}

function resolveToolPlan(callName: string, args: Record<string, unknown> | undefined): {
    agentId?: X402AgentId;
    endpoint: string;
    quotedPriceUsd: number;
    reason: string;
} {
    switch (callName) {
        case 'getPriceData':
            return {
                agentId: 'oracle',
                endpoint: `/api/x402/oracle/price?symbol=${encodeURIComponent(String(args?.symbol || 'BTC'))}`,
                quotedPriceUsd: getAgentPriceUsd('oracle'),
                reason: 'Need real-time token price quote',
            };
        case 'analyzeWallet':
            return {
                agentId: 'scout',
                endpoint: `/api/x402/scout/analyze?address=${encodeURIComponent(String(args?.address || ''))}`,
                quotedPriceUsd: getAgentPriceUsd('scout'),
                reason: 'Need wallet-level on-chain analytics',
            };
        case 'getDexVolume':
            return {
                agentId: 'scout',
                endpoint: `/api/x402/scout/dex?chain=${encodeURIComponent(String(args?.chain || 'ethereum'))}`,
                quotedPriceUsd: getAgentPriceUsd('scout'),
                reason: 'Need chain-specific DEX volume data',
            };
        case 'getGasPrice':
            return {
                agentId: 'scout',
                endpoint: '/api/x402/scout/gas',
                quotedPriceUsd: getAgentPriceUsd('scout'),
                reason: 'Need current gas market data',
            };
        case 'getGasEstimate':
            return {
                agentId: 'scout',
                endpoint: `/api/x402/scout/gas-estimate?operation=${encodeURIComponent(String(args?.operation || 'eth_transfer'))}`,
                quotedPriceUsd: getAgentPriceUsd('scout'),
                reason: 'Need operation-specific gas estimate',
            };
        case 'getProtocolStats':
            return {
                agentId: 'scout',
                endpoint: `/api/x402/scout/protocol?protocol=${encodeURIComponent(String(args?.protocol || 'aave'))}`,
                quotedPriceUsd: getAgentPriceUsd('scout'),
                reason: 'Need DeFi protocol TVL/fees metrics',
            };
        case 'getBridges':
            return {
                agentId: 'scout',
                endpoint: '/api/x402/scout/bridges',
                quotedPriceUsd: getAgentPriceUsd('scout'),
                reason: 'Need bridge volume comparison',
            };
        case 'getHacks':
            return {
                agentId: 'scout',
                endpoint: '/api/x402/scout/hacks',
                quotedPriceUsd: getAgentPriceUsd('scout'),
                reason: 'Need recent exploit/hack data',
            };
        case 'getNews': {
            const category = String(args?.category || '');
            const query = String(args?.query || '');
            if (category === 'breaking') {
                return {
                    agentId: 'news',
                    endpoint: '/api/x402/news/breaking',
                    quotedPriceUsd: getAgentPriceUsd('news'),
                    reason: 'Need breaking headlines',
                };
            }
            if (query) {
                return {
                    agentId: 'news',
                    endpoint: `/api/x402/news/search?query=${encodeURIComponent(query)}&limit=10`,
                    quotedPriceUsd: getAgentPriceUsd('news'),
                    reason: 'Need topic-filtered news search',
                };
            }
            if (category === 'bitcoin' || category === 'defi') {
                return {
                    agentId: 'news',
                    endpoint: `/api/x402/news/search?query=${encodeURIComponent(category)}&limit=10`,
                    quotedPriceUsd: getAgentPriceUsd('news'),
                    reason: 'Need category-filtered headlines',
                };
            }
            return {
                agentId: 'news',
                endpoint: '/api/x402/news/latest?limit=10',
                quotedPriceUsd: getAgentPriceUsd('news'),
                reason: 'Need latest market headlines',
            };
        }
        case 'getTrending':
            return {
                agentId: 'news',
                endpoint: '/api/x402/news/trending',
                quotedPriceUsd: getAgentPriceUsd('news'),
                reason: 'Need trending topic sentiment feed',
            };
        case 'getYields': {
            const asset = String(args?.asset || '');
            if (asset) {
                return {
                    agentId: 'yield',
                    endpoint: `/api/x402/yield/asset?token=${encodeURIComponent(asset)}`,
                    quotedPriceUsd: getAgentPriceUsd('yield'),
                    reason: 'Need asset-specific yield opportunities',
                };
            }

            return {
                agentId: 'yield',
                endpoint: '/api/x402/yield/top',
                quotedPriceUsd: getAgentPriceUsd('yield'),
                reason: 'Need top yield opportunities',
            };
        }
        case 'getTokenomics':
            return {
                agentId: 'tokenomics',
                endpoint: `/api/x402/tokenomics/analyze?symbol=${encodeURIComponent(String(args?.symbol || 'ARB'))}`,
                quotedPriceUsd: getAgentPriceUsd('tokenomics'),
                reason: 'Need vesting/unlock/supply analysis',
            };
        case 'getNftCollectionStats':
            return {
                agentId: 'nft',
                endpoint: `/api/x402/scout/nft/${encodeURIComponent(String(args?.slug || 'pudgypenguins'))}`,
                quotedPriceUsd: getAgentPriceUsd('nft'),
                reason: 'Need NFT collection market analytics',
            };
        case 'searchNftCollections':
            return {
                agentId: 'nft',
                endpoint: `/api/x402/scout/search?q=${encodeURIComponent(String(args?.query || ''))}`,
                quotedPriceUsd: getAgentPriceUsd('nft'),
                reason: 'Need NFT collection slug discovery',
            };
        case 'getGlobalPerpStats':
            return {
                agentId: 'perp',
                endpoint: '/api/x402/perp/global',
                quotedPriceUsd: getAgentPriceUsd('perp'),
                reason: 'Need global perp market aggregates',
            };
        case 'getPerpMarkets':
            return {
                agentId: 'perp',
                endpoint: '/api/x402/perp/markets',
                quotedPriceUsd: getAgentPriceUsd('perp'),
                reason: 'Need exchange-level perp market stats',
            };
        default:
            return {
                endpoint: callName,
                quotedPriceUsd: 0,
                reason: 'Non-paid utility call',
            };
    }
}

async function enforceToolPolicy(
    plan: ReturnType<typeof resolveToolPlan>,
    context: PaidToolContext,
    budgetBeforeUsd: number,
): Promise<{ allowed: boolean; reason: string; reservationId?: string }> {
    if (!plan.agentId || plan.quotedPriceUsd <= 0) {
        return { allowed: true, reason: 'No paid policy checks required' };
    }

    const payTo = SELLER_PAY_TO[plan.agentId];
    const decision = await evaluatePaidToolPolicy({
        agentId: plan.agentId,
        endpoint: plan.endpoint,
        quotedPriceUsd: plan.quotedPriceUsd,
        payTo,
        traceId: context.traceId,
        sessionId: context.sessionId,
        budgetBeforeUsd,
    });

    return {
        allowed: decision.allowed,
        reason: decision.reason,
        reservationId: decision.reservationId,
    };
}

const PRICE_SYMBOL_HINTS: Array<{ pattern: RegExp; symbol: string }> = [
    { pattern: /\bbitcoin\b|\bbtc\b/i, symbol: 'BTC' },
    { pattern: /\bethereum\b|\beth\b/i, symbol: 'ETH' },
    { pattern: /\bsolana\b|\bsol\b/i, symbol: 'SOL' },
    { pattern: /\bbase\b/i, symbol: 'BASE' },
    { pattern: /\barbitrum\b|\barb\b/i, symbol: 'ARB' },
    { pattern: /\boptimism\b|\bop\b/i, symbol: 'OP' },
    { pattern: /\bsui\b/i, symbol: 'SUI' },
    { pattern: /\baptos\b|\bapt\b/i, symbol: 'APT' },
    { pattern: /\bdogecoin\b|\bdoge\b/i, symbol: 'DOGE' },
    { pattern: /\bxrp\b|\bripple\b/i, symbol: 'XRP' },
    { pattern: /\bcardano\b|\bada\b/i, symbol: 'ADA' },
    { pattern: /\busdc\b/i, symbol: 'USDC' },
];

function inferNewsFallbackCallFromPrompt(prompt: string): { name: string; args: Record<string, unknown> } | null {
    const normalized = prompt.trim();
    if (!normalized) return null;

    const isNewsIntent = /\b(news|headline|headlines|breaking|happening|update|updates|latest news|market news|trending)\b/i.test(normalized);
    if (!isNewsIntent) return null;

    if (/\btrending\b/i.test(normalized)) {
        return { name: 'getTrending', args: {} };
    }

    if (/\bbreaking\b/i.test(normalized)) {
        return { name: 'getNews', args: { category: 'breaking' } };
    }

    if (/\bbitcoin\b|\bbtc\b/i.test(normalized)) {
        return { name: 'getNews', args: { category: 'bitcoin' } };
    }

    if (/\bdefi\b/i.test(normalized)) {
        return { name: 'getNews', args: { category: 'defi' } };
    }

    const scopedQuery = normalized.match(/(?:news|headlines?|updates?)\s+(?:about|on|for)\s+([a-z0-9\s-]{2,80})/i);
    if (scopedQuery?.[1]) {
        const query = scopedQuery[1].trim();
        if (query && !/\b(crypto|market|today|now|latest)\b/i.test(query)) {
            return { name: 'getNews', args: { query } };
        }
    }

    return { name: 'getNews', args: { category: 'all' } };
}

function inferPriceSymbolFromPrompt(prompt: string): string | null {
    const normalized = prompt.trim();
    if (!normalized) return null;

    const isNewsIntent = /\b(news|headline|headlines|breaking|happening|update|updates|trending)\b/i.test(normalized);
    if (isNewsIntent) return null;

    const asksPrice = /\b(price|quote|trading|worth|market\s*cap|mcap)\b/i.test(normalized)
        || /how much is/i.test(normalized);

    if (!asksPrice) return null;

    for (const hint of PRICE_SYMBOL_HINTS) {
        if (hint.pattern.test(normalized)) {
            return hint.symbol;
        }
    }

    // Fall back to an explicit ticker if present (e.g., "price of AVAX")
    const tickerMatch = normalized.match(/\b[A-Z]{2,10}\b/);
    if (tickerMatch) {
        return tickerMatch[0];
    }

    // Generic price question with no clear symbol: default to BTC.
    return 'BTC';
}

function formatPriceOracleFallbackResponse(raw: unknown): string {
    const payload = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
    const symbol = String(payload.symbol || 'TOKEN').toUpperCase();
    const name = String(payload.name || symbol);
    const price = typeof payload.price === 'number' ? payload.price : Number(payload.price || 0);
    const change24h = typeof payload.change24h === 'number' ? payload.change24h : Number(payload.change24h || 0);
    const marketCap = typeof payload.marketCap === 'number' ? payload.marketCap : Number(payload.marketCap || 0);
    const volume24h = typeof payload.volume24h === 'number' ? payload.volume24h : Number(payload.volume24h || 0);
    const lastUpdated = payload.lastUpdated ? new Date(String(payload.lastUpdated)) : null;
    const sign = change24h >= 0 ? '+' : '';

    return [
        `**${name} (${symbol})** is **$${price.toLocaleString(undefined, { maximumFractionDigits: 8 })}**`,
        `- 24h change: **${sign}${change24h.toFixed(2)}%**`,
        `- Market cap: **$${marketCap.toLocaleString(undefined, { maximumFractionDigits: 0 })}**`,
        `- 24h volume: **$${volume24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}**`,
        `- Updated: **${lastUpdated && !Number.isNaN(lastUpdated.getTime()) ? lastUpdated.toISOString() : 'unknown'}**`,
    ].join('\n');
}

export async function generateResponse(
    prompt: string,
    imageData?: ImageData,
    conversationHistory?: ConversationMessage[],
    options?: GenerateResponseOptions
): Promise<GenerateResponseResult> {
    if (!genAI) {
        throw new Error("Gemini not initialized. Call initGemini first.");
    }

    // Track which agents are called
    const agentsUsed = new Set<string>();
    // Track x402 transaction hashes per agent
    const x402Transactions: Record<string, string> = {};
    const traceId = options?.traceId || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const budgetLimitUsd = Number(options?.budgetUsd ?? process.env.X402_DEFAULT_BUDGET_USD ?? 1);
    const spentUsdStart = Number(options?.spentUsdStart ?? 0);
    let spentUsdRunning = spentUsdStart;
    const traceSteps: X402TraceStep[] = [];
    const buildTrace = (): X402TraceSummary => ({
        traceId,
        sessionId: options?.sessionId,
        userPrompt: prompt,
        createdAt: new Date().toISOString(),
        budget: {
            limitUsd: budgetLimitUsd,
            spentUsdStart,
            spentUsdEnd: spentUsdRunning,
            remainingUsdEnd: Number(Math.max(0, budgetLimitUsd - spentUsdRunning).toFixed(6)),
        },
        steps: traceSteps,
    });

    const model = genAI.getGenerativeModel({
        model: config.gemini.model,
        tools: [
            {
                functionDeclarations: [
                    getPriceDataFunction,
                    searchWebFunction,
                    analyzeWalletFunction,
                    getDexVolumeFunction,
                    getGasPriceFunction,
                    getGasEstimateFunction,
                    getProtocolStatsFunction,
                    getBridgesFunction,
                    getHacksFunction,
                    getNewsFunction,
                    getTrendingFunction,
                    getYieldsFunction,
                    getTokenomicsFunction,
                    getNftCollectionStatsFunction,
                    searchNftCollectionsFunction,
                    getGlobalPerpStatsFunction,
                    getPerpMarketsFunction
                ],
            },
        ],
        systemInstruction: SYSTEM_PROMPT,
    });

    // Build content parts for the current message
    const currentMessageParts: any[] = [];

    // Add image if provided
    if (imageData) {
        currentMessageParts.push({
            inlineData: {
                mimeType: imageData.mimeType,
                data: imageData.base64,
            },
        });
    }

    // Add text prompt
    if (prompt) {
        currentMessageParts.push({ text: prompt });
    } else if (imageData) {
        currentMessageParts.push({ text: "Analyze this image and describe what you see. Provide helpful insights." });
    }

    // Initialize chat session
    let chat;
    if (conversationHistory && conversationHistory.length > 0) {
        const history = conversationHistory.map(msg => ({
            role: msg.role,
            parts: [{ text: msg.content }],
        }));
        chat = model.startChat({ history });
    } else {
        chat = model.startChat({ history: [] });
    }

    // Send initial message
    let result = await chat.sendMessage(currentMessageParts);
    let response = result.response;
    let functionCalls = response.functionCalls();
    const initialText = response.text() || '';

    // Debug logging
    console.log(`[Gemini] Initial response - text: "${initialText.slice(0, 100) || 'empty'}", functionCalls: ${functionCalls?.length || 0}`);

    // Deterministic fallback: for clear news prompts, force paid News Scout path
    // when Gemini returns no tool calls.
    const heuristicNewsCall = inferNewsFallbackCallFromPrompt(prompt);
    if (heuristicNewsCall && (!functionCalls || functionCalls.length === 0)) {
        console.log(`[Gemini] Heuristic fallback: forcing paid ${heuristicNewsCall.name} call`);
        functionCalls = [heuristicNewsCall as any];
    }

    // Deterministic fallback: for clear price questions, force the paid Oracle path
    // when Gemini returns no tool calls.
    const heuristicPriceSymbol = inferPriceSymbolFromPrompt(prompt);
    if (heuristicPriceSymbol && (!functionCalls || functionCalls.length === 0)) {
        console.log(`[Gemini] Heuristic fallback: forcing paid oracle call for ${heuristicPriceSymbol}`);
        const plan = resolveToolPlan('getPriceData', { symbol: heuristicPriceSymbol });
        const stepIndex = traceSteps.length + 1;
        const budgetBefore = Number(Math.max(0, budgetLimitUsd - spentUsdRunning).toFixed(6));
        const toolContext: PaidToolContext = {
            sessionId: options?.sessionId,
            traceId,
        };

        if (plan.quotedPriceUsd > 0 && budgetBefore < plan.quotedPriceUsd) {
            const reason = `Skipped: remaining budget $${budgetBefore.toFixed(4)} is below quoted price $${plan.quotedPriceUsd.toFixed(4)}`;
            traceSteps.push({
                stepIndex,
                toolName: 'getPriceData',
                endpoint: plan.endpoint,
                quotedPriceUsd: plan.quotedPriceUsd,
                reason,
                budgetBeforeUsd: budgetBefore,
                budgetAfterUsd: budgetBefore,
                outcome: 'skipped',
            });

            return {
                response: `I couldn't fetch the live price because your remaining tool budget ($${budgetBefore.toFixed(4)}) is below the oracle cost ($${plan.quotedPriceUsd.toFixed(4)}).`,
                agentsUsed: Array.from(agentsUsed),
                x402Transactions,
                totalSpendUsd: Number((spentUsdRunning - spentUsdStart).toFixed(6)),
                trace: buildTrace(),
            };
        }

        const policyDecision = await enforceToolPolicy(plan, toolContext, budgetBefore);
        if (!policyDecision.allowed) {
            traceSteps.push({
                stepIndex,
                toolName: 'getPriceData',
                endpoint: plan.endpoint,
                quotedPriceUsd: plan.quotedPriceUsd,
                reason: policyDecision.reason,
                budgetBeforeUsd: budgetBefore,
                budgetAfterUsd: budgetBefore,
                outcome: 'skipped',
            });

            return {
                response: `I couldn't fetch the live price because policy blocked this paid tool call: ${policyDecision.reason}.`,
                agentsUsed: Array.from(agentsUsed),
                x402Transactions,
                totalSpendUsd: Number((spentUsdRunning - spentUsdStart).toFixed(6)),
                trace: buildTrace(),
            };
        }

        const reservationId = policyDecision.reservationId;
        try {
            const paidResult = await handleGetPriceData(heuristicPriceSymbol, toolContext);
            const isPaidSuccess = Boolean(paidResult.agentId && paidResult.endpoint);

            if (isPaidSuccess && paidResult.agentId) {
                agentsUsed.add(paidResult.agentId);
            }

            if (isPaidSuccess && paidResult.agentId && (paidResult.txHash || paidResult.receiptRef)) {
                x402Transactions[paidResult.agentId] = paidResult.txHash || paidResult.receiptRef!;
            }

            const spendDelta = isPaidSuccess ? plan.quotedPriceUsd : 0;
            const budgetAfter = Number(Math.max(0, budgetBefore - spendDelta).toFixed(6));
            spentUsdRunning = Number((spentUsdRunning + spendDelta).toFixed(6));

            traceSteps.push({
                stepIndex,
                toolName: 'getPriceData',
                endpoint: paidResult.endpoint || plan.endpoint,
                quotedPriceUsd: plan.quotedPriceUsd,
                reason: plan.reason,
                budgetBeforeUsd: budgetBefore,
                budgetAfterUsd: budgetAfter,
                outcome: isPaidSuccess ? 'success' : 'failed',
                receiptRef: paidResult.txHash || paidResult.receiptRef,
                latencyMs: paidResult.latencyMs,
            });

            let parsedData: unknown = {};
            try {
                parsedData = JSON.parse(paidResult.data);
            } catch {
                parsedData = { raw: paidResult.data };
            }

            const responseText =
                parsedData && typeof parsedData === 'object' && 'error' in (parsedData as Record<string, unknown>)
                    ? String((parsedData as Record<string, unknown>).error || 'Failed to fetch live price data.')
                    : formatPriceOracleFallbackResponse(parsedData);

            return {
                response: responseText,
                agentsUsed: Array.from(agentsUsed),
                x402Transactions,
                totalSpendUsd: Number((spentUsdRunning - spentUsdStart).toFixed(6)),
                trace: buildTrace(),
            };
        } catch (error) {
            console.error('[Gemini] Heuristic oracle fallback failed:', error);
            traceSteps.push({
                stepIndex,
                toolName: 'getPriceData',
                endpoint: plan.endpoint,
                quotedPriceUsd: plan.quotedPriceUsd,
                reason: plan.reason,
                budgetBeforeUsd: budgetBefore,
                budgetAfterUsd: budgetBefore,
                outcome: 'failed',
            });
        } finally {
            releasePolicyReservation(reservationId);
        }
    }

    // Loop to handle function calls (limit to 5 turns to prevent infinite loops)
    let turns = 0;
    while (functionCalls && functionCalls.length > 0 && turns < 5) {
        turns++;
        const functionResponses = [];

        // Execute all function calls in this turn
        for (const call of functionCalls) {
            let functionResult: string | null = null;
            const args = (call.args || {}) as Record<string, unknown>;
            const plan = resolveToolPlan(call.name, args);
            const stepIndex = traceSteps.length + 1;
            const budgetBefore = Number(Math.max(0, budgetLimitUsd - spentUsdRunning).toFixed(6));
            const toolContext: PaidToolContext = {
                sessionId: options?.sessionId,
                traceId,
            };

            if (plan.quotedPriceUsd > 0 && budgetBefore < plan.quotedPriceUsd) {
                const reason = `Skipped: remaining budget $${budgetBefore.toFixed(4)} is below quoted price $${plan.quotedPriceUsd.toFixed(4)}`;
                traceSteps.push({
                    stepIndex,
                    toolName: call.name,
                    endpoint: plan.endpoint,
                    quotedPriceUsd: plan.quotedPriceUsd,
                    reason,
                    budgetBeforeUsd: budgetBefore,
                    budgetAfterUsd: budgetBefore,
                    outcome: 'skipped',
                });

                functionResult = JSON.stringify({
                    error: reason,
                    skipped: true,
                });
            } else {
                let paidResult: PaidToolResult | null = null;
                let reservationId: string | undefined;
                if (plan.agentId && plan.quotedPriceUsd > 0) {
                    const policyDecision = await enforceToolPolicy(plan, toolContext, budgetBefore);
                    if (!policyDecision.allowed) {
                        traceSteps.push({
                            stepIndex,
                            toolName: call.name,
                            endpoint: plan.endpoint,
                            quotedPriceUsd: plan.quotedPriceUsd,
                            reason: policyDecision.reason,
                            budgetBeforeUsd: budgetBefore,
                            budgetAfterUsd: budgetBefore,
                            outcome: 'skipped',
                        });

                        functionResult = JSON.stringify({
                            error: policyDecision.reason,
                            skipped: true,
                            policyBlocked: true,
                        });
                    } else {
                        reservationId = policyDecision.reservationId;
                    }
                }

                try {
                    if (!functionResult) {
                        if (call.name === "getPriceData") {
                            paidResult = await handleGetPriceData(String(args.symbol || 'BTC'), toolContext);
                        } else if (call.name === "searchWeb") {
                            functionResult = await handleSearchWeb(String(args.query || ''));
                        } else if (call.name === "analyzeWallet") {
                            paidResult = await handleAnalyzeWallet(String(args.address || ''), toolContext);
                        } else if (call.name === "getDexVolume") {
                            paidResult = await handleGetDexVolume(String(args.chain || 'ethereum'), toolContext);
                        } else if (call.name === "getGasPrice") {
                            paidResult = await handleGetGasPrice(toolContext);
                        } else if (call.name === "getGasEstimate") {
                            paidResult = await handleGetGasEstimate(String(args.operation || 'eth_transfer'), toolContext);
                        } else if (call.name === "getProtocolStats") {
                            paidResult = await handleGetProtocolStats(String(args.protocol || 'aave'), toolContext);
                        } else if (call.name === "getBridges") {
                            paidResult = await handleGetBridges(toolContext);
                        } else if (call.name === "getHacks") {
                            paidResult = await handleGetHacks(toolContext);
                        } else if (call.name === "getNews") {
                            paidResult = await handleGetNews(args.query as string | undefined, args.category as string | undefined, toolContext);
                        } else if (call.name === "getTrending") {
                            paidResult = await handleGetTrending(toolContext);
                        } else if (call.name === "getYields") {
                            paidResult = await handleGetYields(args as {
                                chain?: string;
                                type?: string;
                                minApy?: number;
                                maxApy?: number;
                                asset?: string;
                                protocol?: string;
                                page?: number;
                            }, toolContext);
                        } else if (call.name === "getTokenomics") {
                            paidResult = await handleGetTokenomics(String(args.symbol || 'ARB'), toolContext);
                        } else if (call.name === "getNftCollectionStats") {
                            paidResult = await handleGetNftCollectionStats(String(args.slug || ''), toolContext);
                        } else if (call.name === "searchNftCollections") {
                            paidResult = await handleSearchNftCollections(String(args.query || ''), toolContext);
                        } else if (call.name === "getGlobalPerpStats") {
                            paidResult = await handleGetGlobalPerpStats(toolContext);
                        } else if (call.name === "getPerpMarkets") {
                            paidResult = await handleGetPerpMarkets(args.symbol as string | undefined, toolContext);
                        }
                    }

                    if (paidResult) {
                        functionResult = paidResult.data;
                        const isPaidSuccess = Boolean(paidResult.agentId && paidResult.endpoint);

                        if (isPaidSuccess && paidResult.agentId) {
                            agentsUsed.add(paidResult.agentId);
                        }

                        if (isPaidSuccess && paidResult.agentId && (paidResult.txHash || paidResult.receiptRef)) {
                            x402Transactions[paidResult.agentId] = paidResult.txHash || paidResult.receiptRef!;
                        }

                        const spendDelta = isPaidSuccess ? plan.quotedPriceUsd : 0;
                        const budgetAfter = Number(Math.max(0, budgetBefore - spendDelta).toFixed(6));
                        spentUsdRunning = Number((spentUsdRunning + spendDelta).toFixed(6));

                        traceSteps.push({
                            stepIndex,
                            toolName: call.name,
                            endpoint: paidResult.endpoint || plan.endpoint,
                            quotedPriceUsd: plan.quotedPriceUsd,
                            reason: plan.reason,
                            budgetBeforeUsd: budgetBefore,
                            budgetAfterUsd: budgetAfter,
                            outcome: isPaidSuccess ? 'success' : 'failed',
                            receiptRef: paidResult.txHash || paidResult.receiptRef,
                            latencyMs: paidResult.latencyMs,
                        });
                    } else if (!functionResult) {
                        traceSteps.push({
                            stepIndex,
                            toolName: call.name,
                            endpoint: plan.endpoint,
                            quotedPriceUsd: 0,
                            reason: plan.reason,
                            budgetBeforeUsd: budgetBefore,
                            budgetAfterUsd: budgetBefore,
                            outcome: 'success',
                        });
                    }
                } catch (error) {
                    console.error(`[Gemini] Tool execution failed for ${call.name}:`, error);
                    functionResult = JSON.stringify({ error: `Tool execution failed: ${(error as Error).message}` });
                    traceSteps.push({
                        stepIndex,
                        toolName: call.name,
                        endpoint: plan.endpoint,
                        quotedPriceUsd: plan.quotedPriceUsd,
                        reason: plan.reason,
                        budgetBeforeUsd: budgetBefore,
                        budgetAfterUsd: budgetBefore,
                        outcome: 'failed',
                    });
                } finally {
                    releasePolicyReservation(reservationId);
                }
            }

            if (functionResult) {
                let parsedResult: unknown = { raw: functionResult };
                try {
                    parsedResult = JSON.parse(functionResult);
                } catch {
                    // keep raw fallback
                }

                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: parsedResult as any,
                    }
                });
            }
        }

        // Send function responses back to model
        if (functionResponses.length > 0) {
            result = await chat.sendMessage(functionResponses);
            response = result.response;
            functionCalls = response.functionCalls();
        } else {
            // Should not happen if calls were present but no results (handled by error catch above)
            break;
        }
    }

    const responseText = response.text();

    return {
        response: responseText || "I processed your request but couldn't generate a text response. Please try clarifying your question.",
        agentsUsed: Array.from(agentsUsed),
        x402Transactions,
        totalSpendUsd: Number((spentUsdRunning - spentUsdStart).toFixed(6)),
        trace: buildTrace(),
    };
}

export async function estimateTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
}

export async function calculateCost(
    inputTokens: number,
    outputTokens: number
): Promise<number> {
    const inputCost = (inputTokens / 1_000_000) * 0.5;
    const outputCost = (outputTokens / 1_000_000) * 3.0;
    return inputCost + outputCost;
}
