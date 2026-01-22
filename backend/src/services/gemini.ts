/**
 * Gemini Service with Price Oracle + Tavily Web Search
 */

import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { config } from "../config.js";
import { fetchPrice, PriceData } from "./price-oracle.js";
import { createOraclePayment, createScoutPayment, createNewsScoutPayment, createYieldOptimizerPayment, createTokenomicsPayment, createNftScoutPayment, createPerpStatsPayment } from "./x402-agent-payments.js";
import { searchWeb as groqSearch } from "./groq.js";
import * as onchainAnalytics from "./onchain-analytics.js";
import * as defillama from "./defillama.js";
import * as newsScout from "./news-scout.js";
import * as yieldOptimizer from "./yield-optimizer.js";
import * as tokenomicsService from "./tokenomics-service.js";
import { nftScoutService } from "./nft-scout-service.js";
import { perpStatsService } from "./perp-stats/PerpStatsService.js";

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

// Function to handle wallet analysis
async function handleAnalyzeWallet(address: string): Promise<string> {
    console.log(`[Gemini] 🔍 Analyzing wallet: ${address}...`);

    const report = await onchainAnalytics.analyzeWallet(address);

    if (!report) {
        return JSON.stringify({ error: `Could not analyze wallet ${address}. Please check the address is valid.` });
    }

    // Pay Chain Scout for on-chain analytics (await this one)
    scoutQueryCount++;
    try {
        const payRes = await createScoutPayment(`wallet:${address}`);
        console.log(`[Gemini] 🕵️ Paid Chain Scout: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ Scout payment failed: ${(e as Error).message}`);
    }

    // Pay Price Oracle in background (fire-and-forget for faster response)
    oracleQueryCount++;
    createOraclePayment(`wallet-prices:${address}`)
        .then(payRes => console.log(`[Gemini] 💰 Paid Price Oracle: ${payRes.transactionId}`))
        .catch(e => console.error(`[Gemini] ⚠️ Oracle payment failed: ${(e as Error).message}`));

    // Return structured data for Gemini to present naturally
    return JSON.stringify({
        address: report.address,
        ensName: report.ensName || null,
        type: report.isContract ? "Smart Contract" : "Wallet (EOA)",
        portfolioValueUsd: report.portfolio?.totalValueUsd || 0,
        walletAgeDays: report.walletAgeDays || 0,
        txCount: report.txCount,
        labels: report.labels,
        topTokens: report.portfolio?.tokens
            .filter(t => t.valueUsd >= 1.0)
            .sort((a, b) => b.valueUsd - a.valueUsd)
            .slice(0, 10)
            .map(t => ({
                symbol: t.symbol,
                network: t.network.replace('-mainnet', ''),
                balance: t.balance,
                valueUsd: t.valueUsd
            })) || [],
        topNfts: report.nftsWithFloorPrice?.slice(0, 5).map(n => ({
            collection: n.collection,
            tokenId: n.tokenId,
            floorPriceEth: n.floorPriceEth
        })) || [],
        recentTransactions: report.history?.slice(0, 10).map(tx => ({
            type: tx.type,
            asset: tx.asset,
            amount: tx.amount,
            network: tx.network.replace('-mainnet', '')
        })) || [],
        etherscanUrl: `https://etherscan.io/address/${report.address}#asset-multichain`
    });
}

// Function to handle DEX volume queries
async function handleGetDexVolume(chain: string): Promise<string> {
    console.log(`[Gemini] 📈 Getting DEX volume for: ${chain}...`);

    const report = await onchainAnalytics.getDexReport(chain);

    if (!report) {
        return JSON.stringify({ error: `Could not get DEX volume for ${chain}. Try: ethereum, arbitrum, polygon, base, optimism, avalanche, bsc` });
    }

    // Pay Chain Scout
    scoutQueryCount++;
    try {
        const payRes = await createScoutPayment(`volume:${chain}`);
        console.log(`[Gemini] 🕵️ Paid Chain Scout: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ Payment failed: ${(e as Error).message}`);
    }

    return JSON.stringify({
        chain: report.chain,
        totalVolume24h: report.totalVolume24h,
        topDexes: report.topDexes.slice(0, 5).map(d => ({ name: d.name, volume24h: d.volume24h, change24h: d.change24h }))
    });
}
// Function to handle gas price queries
async function handleGetGasPrice(): Promise<string> {
    console.log(`[Gemini] ⛽ Getting gas prices...`);

    const [gasPrices, ethPriceData] = await Promise.all([
        onchainAnalytics.getGasPrices(),
        fetchPrice("ethereum")
    ]);

    if (!gasPrices) {
        return JSON.stringify({ error: "Could not fetch gas prices. Try again later." });
    }

    // Pay Chain Scout
    scoutQueryCount++;
    try {
        const payRes = await createScoutPayment(`gas_price`);
        console.log(`[Gemini] 🕵️ Paid Chain Scout: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ Payment failed: ${(e as Error).message}`);
    }

    const ethPrice = ethPriceData ? ethPriceData.price : 0;

    return JSON.stringify({
        low: gasPrices.low,
        average: gasPrices.average,
        fast: gasPrices.fast,
        baseFee: gasPrices.baseFee,
        ethPriceUsd: ethPrice
    });
}

// Function to handle gas estimate queries
async function handleGetGasEstimate(operation: string): Promise<string> {
    console.log(`[Gemini] 🧮 Estimating gas cost for: ${operation}...`);

    const estimate = await onchainAnalytics.estimateTransactionCost(operation);

    if (!estimate) {
        return JSON.stringify({ error: `Could not estimate cost for ${operation}. Try: eth_transfer, erc20_transfer, nft_transfer, swap_dex, bridge` });
    }

    // Pay Chain Scout
    scoutQueryCount++;
    try {
        const payRes = await createScoutPayment(`gas_estimate:${operation}`);
        console.log(`[Gemini] 🕵️ Paid Chain Scout: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ Payment failed: ${(e as Error).message}`);
    }

    return JSON.stringify({
        operation: estimate.operation,
        gasLimit: estimate.gasLimit,
        gasPriceGwei: estimate.gasPriceGwei,
        ethCost: estimate.ethCost,
        usdCost: estimate.usdCost,
        formattedReport: `Estimated Cost for **${operation.replace(/_/g, " ").toUpperCase()}**:\n${estimate.formattedCost}\n_(Based on ${estimate.gasPriceGwei.toFixed(2)} Gwei)_`
    });
}

// ... (skipping handleGetGasPrice)

// Function to handle protocol stats queries
async function handleGetProtocolStats(protocol: string): Promise<string> {
    console.log(`[Gemini] 📊 Getting protocol stats for: ${protocol}...`);

    const stats = await defillama.getProtocolStats(protocol);

    if (!stats) {
        return JSON.stringify({ error: `Could not find protocol: ${protocol}. Try: aave, uniswap, lido, compound, curve, makerdao` });
    }

    // Pay Chain Scout
    scoutQueryCount++;
    try {
        const payRes = await createScoutPayment(`protocol:${protocol}`);
        console.log(`[Gemini] 🕵️ Paid Chain Scout: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ Payment failed: ${(e as Error).message}`);
    }

    return JSON.stringify({
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
        chains: stats.chains.slice(0, 8),
        url: stats.url
    });
}

// Function to handle bridges queries
async function handleGetBridges(): Promise<string> {
    console.log(`[Gemini] 🌉 Getting bridge volumes...`);

    const bridges = await defillama.getBridges();

    if (!bridges) {
        return JSON.stringify({ error: "Could not fetch bridge data. Try again later." });
    }

    // Pay Chain Scout
    scoutQueryCount++;
    try {
        const payRes = await createScoutPayment(`bridges`);
        console.log(`[Gemini] 🕵️ Paid Chain Scout: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ Payment failed: ${(e as Error).message}`);
    }

    return JSON.stringify({
        count: bridges.length,
        topBridges: bridges.slice(0, 5).map(b => ({ name: b.displayName, volume24h: b.volume24h, volumeWeekly: b.volumeWeekly }))
    });
}

const SYSTEM_PROMPT = `You are Arc Agent, a cryptocurrency and blockchain-focused AI assistant powered by the Arc Network.

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

**About Arc Network:**
- Arc is a blockchain where USDC is the native gas token
- It features instant finality and is designed for agent-to-agent payments
- When you use the Price Oracle, a micro-payment ($0.001) is made to the Oracle agent
- When you use the News Scout, a micro-payment ($0.001) is made to the News Scout agent

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
    description: "Get latest crypto news headlines from trusted sources (CoinDesk, The Block, Decrypt, CoinTelegraph, etc.). Use when users ask about 'crypto news', 'what's happening', 'latest news', 'headlines', or news about specific topics.",
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
async function handleGetPriceData(symbol: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🔮 Calling Price Oracle for ${symbol}...`);

    const priceData = await fetchPrice(symbol);

    if (!priceData) {
        return { data: JSON.stringify({ error: `Could not find price data for ${symbol}` }) };
    }

    // Pay Oracle
    oracleQueryCount++;
    let txHash: string | undefined;
    try {
        const payRes = await createOraclePayment(`price:${symbol}`);
        txHash = payRes.transactionId;
        console.log(`[Gemini] 💰 Paid Oracle: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ Payment failed: ${(e as Error).message}`);
    }

    return {
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
        txHash
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
async function handleGetHacks(): Promise<string> {
    console.log(`[Gemini] ⚠️ Getting recent DeFi hacks...`);

    const hacks = await defillama.getHacks();

    if (!hacks) {
        return JSON.stringify({ error: "Could not fetch hacks data. Try again later." });
    }

    return JSON.stringify({
        count: hacks.length,
        recentHacks: hacks.slice(0, 7).map(h => ({
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
    });
}

// Function to handle crypto news queries
async function handleGetNews(query?: string, category?: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📰 Getting crypto news... query="${query || 'none'}", category="${category || 'all'}"`);

    let news;

    if (category === "breaking") {
        news = await newsScout.getBreakingNews();
    } else if (category === "bitcoin") {
        news = await newsScout.getBitcoinNews();
    } else if (category === "defi") {
        news = await newsScout.getDefiNews();
    } else if (query) {
        news = await newsScout.searchNews(query);
    } else {
        news = await newsScout.getLatestNews();
    }

    if (!news || news.articles.length === 0) {
        return { data: JSON.stringify({ error: "Could not fetch news data. Try again later." }) };
    }

    // Pay News Scout agent
    newsScoutQueryCount++;
    let txHash: string | undefined;
    try {
        const payRes = await createNewsScoutPayment(`news:${query || category || 'latest'}`);
        txHash = payRes.transactionId;
        console.log(`[Gemini] 📰 Paid News Scout: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ News Scout payment failed: ${(e as Error).message}`);
    }

    return {
        data: JSON.stringify({
            articles: news.articles.slice(0, 8).map(a => ({
                title: a.title,
                description: a.description,
                link: a.link,
                source: a.source,
                timeAgo: a.timeAgo
            })),
            totalCount: news.totalCount,
            sources: news.sources,
            fetchedAt: news.fetchedAt
        }),
        txHash
    };
}

// Function to handle trending topics
async function handleGetTrending(): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📈 Getting trending crypto topics...`);

    const trending = await newsScout.getTrendingTopics();

    if (!trending) {
        return { data: JSON.stringify({ error: "Could not fetch trending data. Try again later." }) };
    }

    // Pay News Scout agent
    newsScoutQueryCount++;
    let txHash: string | undefined;
    try {
        const payRes = await createNewsScoutPayment(`trending:topics`);
        txHash = payRes.transactionId;
        console.log(`[Gemini] 📰 Paid News Scout: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ News Scout payment failed: ${(e as Error).message}`);
    }

    return {
        data: JSON.stringify({
            trending: trending.trending.slice(0, 5).map(t => ({
                topic: t.topic,
                count: t.count,
                sentiment: t.sentiment,
                headline: t.recentHeadlines[0] || null
            })),
            articlesAnalyzed: trending.articlesAnalyzed,
            timeWindow: trending.timeWindow
        }),
        txHash
    };
}

// Function to handle yield queries
async function handleGetYields(options?: { chain?: string; type?: string; minApy?: number; maxApy?: number; asset?: string; protocol?: string; page?: number }): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🌾 Getting DeFi yields...`, options);

    try {
        const page = options?.page || 1;
        const pageSize = 20; // Show 20 results per page

        let result;

        if (options?.asset) {
            result = await yieldOptimizer.getYieldsForAsset(options.asset);
            result = { opportunities: result, totalCount: result.length, fetchedAt: new Date().toISOString() };
        } else {
            result = await yieldOptimizer.getTopYields({
                chain: options?.chain,
                type: options?.type,
                protocol: options?.protocol,
                minApy: options?.minApy,
                maxApy: options?.maxApy,
                limit: 100 // Fetch up to 100 to support pagination
            });
        }

        if (!result || result.opportunities.length === 0) {
            return { data: JSON.stringify({ error: "No yield opportunities found matching your criteria. Try different filters." }) };
        }

        // Pay Yield Optimizer agent (only on first page)
        let txHash: string | undefined;
        if (page === 1) {
            yieldOptimizerQueryCount++;
            try {
                const payRes = await createYieldOptimizerPayment(`yields:${options?.chain || options?.asset || 'top'}`);
                txHash = payRes.transactionId;
                console.log(`[Gemini] 🌾 Paid Yield Optimizer: ${payRes.transactionId}`);
            } catch (e) {
                console.error(`[Gemini] ⚠️ Yield Optimizer payment failed: ${(e as Error).message}`);
            }
        }

        // Calculate pagination
        const startIndex = (page - 1) * pageSize;
        const endIndex = startIndex + pageSize;
        const paginatedOpportunities = result.opportunities.slice(startIndex, endIndex);
        const totalPages = Math.ceil(result.totalCount / pageSize);
        const hasMore = page < totalPages;

        return {
            data: JSON.stringify({
                opportunities: paginatedOpportunities.map(y => ({
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
                showing: paginatedOpportunities.length,
                totalCount: result.totalCount,
                page: page,
                totalPages: totalPages,
                hasMore: hasMore,
                nextPageHint: hasMore ? `Say "show more yields" or "page ${page + 1}" to see more` : null,
                fetchedAt: result.fetchedAt
            }),
            txHash
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
async function handleGetGlobalPerpStats(): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📊 Getting global perp stats...`);

    try {
        // Pay Perp Stats Agent
        perpStatsQueryCount++;
        let txHash: string | undefined;
        try {
            const payRes = await createPerpStatsPayment('global');
            txHash = payRes.transactionId;
            console.log(`[Gemini] 📈 Paid Perp Stats (Global): ${payRes.transactionId}`);
        } catch (e) {
            console.error(`[Gemini] ⚠️ Perp Stats payment failed: ${(e as Error).message}`);
        }

        const stats = await perpStatsService.getGlobalStats();
        return { data: JSON.stringify(stats), txHash };
    } catch (error) {
        console.error("Perp Stats Error:", error);
        return { data: JSON.stringify({ error: "Failed to fetch global perp stats." }) };
    }
}

// Function to handle Perp Markets
async function handleGetPerpMarkets(symbol?: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📈 Getting perp markets${symbol ? ` for ${symbol}` : ''}...`);

    try {
        // Pay Perp Stats Agent
        perpStatsQueryCount++;
        let txHash: string | undefined;
        try {
            const payRes = await createPerpStatsPayment(`markets:${symbol || 'all'}`);
            txHash = payRes.transactionId;
            console.log(`[Gemini] 📈 Paid Perp Stats (Markets): ${payRes.transactionId}`);
        } catch (e) {
            console.error(`[Gemini] ⚠️ Perp Stats payment failed: ${(e as Error).message}`);
        }

        let markets = await perpStatsService.getMarkets();

        if (symbol) {
            let s = symbol.toUpperCase();

            // Normalize common names to tickers
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

            // Loose match: Allow "BTC" to match "BTC-USD", "BTCUSD", "BTC-PERP"
            markets = markets.filter(m => {
                const mSym = m.symbol.toUpperCase();
                return mSym === s || mSym.includes(s) || mSym.replace(/[-_]/g, '') === s;
            });

            if (markets.length === 0) {
                return { data: JSON.stringify({ error: `No perp markets found matching "${symbol}".` }), txHash };
            }
        } else {
            // If no symbol, return top 60 by OI to ensure diversity across exchanges (Hyperliquid dominates top 20)
            markets = markets.sort((a, b) => b.openInterestUsd - a.openInterestUsd).slice(0, 60);
        }

        return { data: JSON.stringify({ markets }), txHash };
    } catch (error) {
        console.error("Perp Stats Error:", error);
        return { data: JSON.stringify({ error: "Failed to fetch perp markets." }) };
    }
}

// Function to handle NFT Stats
async function handleGetNftCollectionStats(slug: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🎨 Getting NFT stats for: ${slug}...`);

    try {
        const analysis = await nftScoutService.analyzeCollection(slug);

        // Pay NFT Scout
        let txHash: string | undefined;
        try {
            const payRes = await createNftScoutPayment(`nft:${slug}`);
            txHash = payRes.transactionId;
            console.log(`[Gemini] 🎨 Paid NFT Scout: ${payRes.transactionId}`);
        } catch (e) {
            console.error(`[Gemini] ⚠️ NFT Scout payment failed: ${(e as Error).message}`);
        }

        return { data: JSON.stringify(analysis), txHash };
    } catch (error) {
        console.error("NFT Scout Error:", error);
        return { data: JSON.stringify({ error: `Failed to fetch NFT stats for ${slug}. Please check the slug.` }) };
    }
}

// Function to handle NFT Search
async function handleSearchNftCollections(query: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 🔍 Searching NFT collections: ${query}...`);

    try {
        const results = await nftScoutService.searchCollections(query);

        // Pay Chain Scout for NFT search
        scoutQueryCount++;
        let txHash: string | undefined;
        try {
            const payRes = await createScoutPayment(`nft_search:${query}`);
            txHash = payRes.transactionId;
            console.log(`[Gemini] 🔍 Paid NFT Scout: ${payRes.transactionId}`);
        } catch (e) {
            console.error(`[Gemini] ⚠️ NFT Scout payment failed: ${(e as Error).message}`);
        }

        return { data: JSON.stringify({ results }), txHash };
    } catch (error) {
        console.error("NFT Search Error:", error);
        return { data: JSON.stringify({ error: `Failed to search collections for ${query}.` }) };
    }
}

// Function to handle tokenomics analysis
async function handleGetTokenomics(symbol: string): Promise<{ data: string; txHash?: string }> {
    console.log(`[Gemini] 📊 Analyzing tokenomics for ${symbol}...`);

    const analysis = await tokenomicsService.analyzeTokenomics(symbol);

    if (!analysis) {
        return { data: JSON.stringify({ error: `Could not find tokenomics data for ${symbol}. Try a different token (ARB, OP, SUI, APT, ETH, SOL).` }) };
    }

    // Pay Tokenomics agent
    tokenomicsQueryCount++;
    let txHash: string | undefined;
    try {
        const payRes = await createTokenomicsPayment(`tokenomics:${symbol}`);
        txHash = payRes.transactionId;
        console.log(`[Gemini] 📊 Paid Tokenomics: ${payRes.transactionId}`);
    } catch (e) {
        console.error(`[Gemini] ⚠️ Tokenomics payment failed: ${(e as Error).message}`);
    }

    // Format response for Gemini
    const hasUnlocks = analysis.upcomingUnlocks.length > 0;
    const isFullyCirculating = analysis.supply.percentUnlocked >= 99;

    return {
        data: JSON.stringify({
            symbol: analysis.symbol,
            name: analysis.name,
            supply: {
                circulating: analysis.supply.circulatingFormatted,
                total: analysis.supply.totalFormatted,
                max: analysis.supply.maxFormatted,
                percentUnlocked: analysis.supply.percentUnlocked + '%',
            },
            nextUnlock: analysis.nextUnlock ? {
                date: analysis.nextUnlock.date,
                amount: analysis.nextUnlock.amountFormatted,
                percentOfCirculating: analysis.nextUnlock.percentOfCirculating + '%',
                recipient: analysis.nextUnlock.recipient,
                riskLevel: analysis.nextUnlock.riskLevel,
            } : null,
            noUnlocksNote: !hasUnlocks ? (
                isFullyCirculating
                    ? "This token is fully circulating with no locked supply remaining."
                    : "Detailed unlock schedule data is not available for this token. Check sources like Token Unlocks or the project's official documentation for more info."
            ) : null,
            upcomingUnlocks: analysis.upcomingUnlocks.slice(0, 3).map(u =>
                `${u.date}: ${u.amountFormatted} (${u.percentOfCirculating}% of circ supply) - ${u.riskLevel}`
            ),
            allocations: analysis.allocations.map(a => `${a.category}: ${a.percentage}%`),
            inflation: analysis.inflation,
            fetchedAt: analysis.fetchedAt,
        }),
        txHash
    };
}

export interface GenerateResponseResult {
    response: string;
    agentsUsed: string[];
    x402Transactions: Record<string, string>; // agentId -> txHash for x402 payments
}

export async function generateResponse(
    prompt: string,
    imageData?: ImageData,
    conversationHistory?: ConversationMessage[]
): Promise<GenerateResponseResult> {
    if (!genAI) {
        throw new Error("Gemini not initialized. Call initGemini first.");
    }

    // Track which agents are called
    const agentsUsed = new Set<string>();
    // Track x402 transaction hashes per agent
    const x402Transactions: Record<string, string> = {};

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

    // Debug logging
    console.log(`[Gemini] Initial response - text: "${response.text()?.slice(0, 100) || 'empty'}", functionCalls: ${functionCalls?.length || 0}`);

    // Loop to handle function calls (limit to 5 turns to prevent infinite loops)
    let turns = 0;
    while (functionCalls && functionCalls.length > 0 && turns < 5) {
        turns++;
        const functionResponses = [];

        // Execute all function calls in this turn
        for (const call of functionCalls) {
            let functionResult: string | null = null;

            try {
                if (call.name === "getPriceData") {
                    agentsUsed.add('oracle');
                    const args = call.args as { symbol: string };
                    const result = await handleGetPriceData(args.symbol);
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['oracle'] = result.txHash;
                    }
                } else if (call.name === "searchWeb") {
                    const args = call.args as { query: string };
                    functionResult = await handleSearchWeb(args.query);
                } else if (call.name === "analyzeWallet") {
                    agentsUsed.add('scout');
                    const args = call.args as { address: string };
                    functionResult = await handleAnalyzeWallet(args.address);
                } else if (call.name === "getDexVolume") {
                    agentsUsed.add('scout');
                    const args = call.args as { chain: string };
                    functionResult = await handleGetDexVolume(args.chain);
                } else if (call.name === "getGasPrice") {
                    agentsUsed.add('scout');
                    functionResult = await handleGetGasPrice();
                } else if (call.name === "getGasEstimate") {
                    agentsUsed.add('scout');
                    const args = call.args as { operation: string };
                    functionResult = await handleGetGasEstimate(args.operation);
                } else if (call.name === "getProtocolStats") {
                    agentsUsed.add('scout');
                    const args = call.args as { protocol: string };
                    functionResult = await handleGetProtocolStats(args.protocol);
                } else if (call.name === "getBridges") {
                    agentsUsed.add('scout');
                    functionResult = await handleGetBridges();
                } else if (call.name === "getHacks") {
                    agentsUsed.add('scout');
                    functionResult = await handleGetHacks();
                } else if (call.name === "getNews") {
                    agentsUsed.add('news');
                    const args = call.args as { query?: string; category?: string };
                    const result = await handleGetNews(args.query, args.category);
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['news'] = result.txHash;
                    }
                } else if (call.name === "getTrending") {
                    agentsUsed.add('news');
                    const result = await handleGetTrending();
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['news'] = result.txHash;
                    }
                } else if (call.name === "getYields") {
                    agentsUsed.add('yield');
                    const args = call.args as { chain?: string; type?: string; minApy?: number; maxApy?: number; asset?: string; protocol?: string; page?: number };
                    const result = await handleGetYields(args);
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['yield'] = result.txHash;
                    }
                } else if (call.name === "getTokenomics") {
                    agentsUsed.add('tokenomics');
                    const args = call.args as { symbol: string };
                    const result = await handleGetTokenomics(args.symbol);
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['tokenomics'] = result.txHash;
                    }
                } else if (call.name === "getNftCollectionStats") { // Added NFT Stats handler
                    agentsUsed.add('nft');
                    const args = call.args as { slug: string };
                    const result = await handleGetNftCollectionStats(args.slug);
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['nft'] = result.txHash;
                    }
                } else if (call.name === "searchNftCollections") { // Added NFT Search handler
                    agentsUsed.add('nft');
                    const args = call.args as { query: string };
                    const result = await handleSearchNftCollections(args.query);
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['nft'] = result.txHash;
                    }
                } else if (call.name === "getGlobalPerpStats") {
                    agentsUsed.add('perp');
                    const result = await handleGetGlobalPerpStats();
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['perp'] = result.txHash;
                    }
                } else if (call.name === "getPerpMarkets") {
                    agentsUsed.add('perp');
                    const args = call.args as { symbol?: string };
                    const result = await handleGetPerpMarkets(args.symbol);
                    functionResult = result.data;
                    if (result.txHash) {
                        x402Transactions['perp'] = result.txHash;
                    }
                }
            } catch (error) {
                console.error(`[Gemini] Tool execution failed for ${call.name}:`, error);
                functionResult = JSON.stringify({ error: `Tool execution failed: ${(error as Error).message}` });
            }

            if (functionResult) {
                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: JSON.parse(functionResult),
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
        x402Transactions
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
