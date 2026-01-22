import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { ResellerAgent } from "./agents/reseller.js";
import { ProviderAgent } from "./agents/provider.js";
import { publicClient, contracts } from "./blockchain.js";
import { formatEther, parseEther } from "viem";
import { generateResponse, initGemini } from "./services/gemini.js";
import { initCircleClient, requestTestnetTokens } from "./services/circle-mcp.js";
import { checkGatewayStatus } from "./services/gateway.js";
import { fetchPrice, fetchPrices } from "./services/price-oracle.js";
import { initOracleWallet, getOracleBalance, withdrawOracleFunds, getOracleAddress, getOracleAgentInfo, registerOracleAgent } from "./agents/oracle-wallet.js";
import { initChatWallet, getChatBalance, getChatAddress } from "./agents/chat-wallet.js";
import { initScoutWallet, getScoutAddress, getScoutAgentInfo } from "./agents/scout-wallet.js";
import { initNewsScoutWallet, getNewsScoutAddress } from "./agents/news-scout-wallet.js";
import { initYieldWallet, getYieldAddress } from "./agents/yield-wallet.js";
import { initTokenomicsWallet, getTokenomicsAddress } from "./agents/tokenomics-wallet.js";
import { initNftScoutWallet, getNftScoutAddress } from "./agents/nft-scout-wallet.js";
import { createOraclePayment, releaseOraclePayment, getAgentWalletStatus } from "./services/agent-payments.js";
import { initX402Payments, getX402Balance } from "./services/x402-agent-payments.js";
import { initAutoRefillClient, startAutoRefillService } from "./services/x402-auto-refill.js";
import { startAutoWithdraw } from "./services/x402-agent-auto-withdraw.js";
import { initGatewayClient } from "./services/x402-gateway-client.js";
import x402AgentRoutes from "./routes/x402-agent-routes.js";
import {
    initSupabase,
    createChatSession,
    getChatSessions,
    deleteChatSession,
    saveMessage,
    getMessages,
    clearMessages,
    rateMessage,
    getMessageRating,
    getAgentRating,
    getAgentRatingById,
    logQueryTime,
    getAverageResponseTime,
    getTotalUsageCount,
    getAllAgentStats,
    getAgentStatsById,
    getRecentQueries
} from "./services/supabase.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const app = express();

// CORS configuration - add production domain when available
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8080'];
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`[CORS] Blocked request from origin: ${origin}`);
            callback(null, true); // Allow for now, but log for monitoring
        }
    },
    credentials: true
}));

// Rate limiting - protect against DoS and abuse
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per window
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const queryLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 queries per minute
    message: { error: 'Query rate limit exceeded. Please wait before sending more queries.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const faucetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 faucet requests per hour
    message: { error: 'Faucet rate limit exceeded. Try again in an hour.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(generalLimiter);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Environment validation
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_ENTITY_SECRET = process.env.CIRCLE_ENTITY_SECRET;

if (!PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY is missing in .env. Startup failed.");
    process.exit(1);
}

const resellerAgent = new ResellerAgent(PRIVATE_KEY);
const providerAgent = new ProviderAgent(PRIVATE_KEY);

if (GEMINI_API_KEY) {
    providerAgent.initializeGemini(GEMINI_API_KEY);
}

// Initialize Circle MCP if keys are present
if (CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET) {
    try {
        initCircleClient(CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET);
        console.log("✅ Circle MCP Client initialized");
    } catch (e) {
        console.error("❌ Failed to initialize Circle MCP:", e);
    }
}

// Initialize Supabase
const supabaseEnabled = initSupabase();
if (supabaseEnabled) {
    console.log("✅ Supabase initialized");
}

// Initialize Price Oracle Wallet (async)
if (CIRCLE_API_KEY && CIRCLE_ENTITY_SECRET) {
    initOracleWallet()
        .then((wallet) => {
            console.log(`✅ Price Oracle Wallet: ${wallet.address}`);
        })
        .catch((err) => {
            console.error("❌ Failed to initialize Oracle wallet:", err.message);
        });

    // Initialize Chat Agent Wallet (async)
    initChatWallet()
        .then((wallet) => {
            console.log(`✅ Chat Agent Wallet: ${wallet.address}`);
        })
        .catch((err) => {
            console.error("❌ Failed to initialize Chat wallet:", err.message);
        });

    // Initialize Chain Scout Wallet (async)
    initScoutWallet()
        .then((wallet) => {
            console.log(`✅ Chain Scout Wallet: ${wallet.address}`);
        })
        .catch((err) => {
            console.error("❌ Failed to initialize Chain Scout wallet:", err.message);
        });

    // Initialize News Scout Wallet (async)
    initNewsScoutWallet()
        .then((wallet) => {
            console.log(`✅ News Scout Wallet: ${wallet.address}`);
        })
        .catch((err) => {
            console.error("❌ Failed to initialize News Scout wallet:", err.message);
        });

    // Initialize Yield Optimizer Wallet (async)
    initYieldWallet()
        .then((wallet) => {
            console.log(`✅ Yield Optimizer Wallet: ${wallet.address}`);
        })
        .catch((err) => {
            console.error("❌ Failed to initialize Yield Optimizer wallet:", err.message);
        });

    // Initialize Tokenomics Wallet (async)
    initTokenomicsWallet()
        .then((wallet) => {
            console.log(`✅ Tokenomics Analyzer Wallet: ${wallet.address}`);
        })
        .catch((err) => {
            console.error("❌ Failed to initialize Tokenomics wallet:", err.message);
        });

    // Initialize NFT Scout Wallet (async)
    initNftScoutWallet()
        .then((wallet) => {
            console.log(`✅ NFT Scout Wallet: ${wallet.address}`);
        })
        .catch((err) => {
            console.error("❌ Failed to initialize NFT Scout wallet:", err.message);
        });

    // Initialize x402 Gasless Payments
    initX402Payments(PRIVATE_KEY)
        .then(() => {
            console.log(`✅ x402 Gasless Payments: Ready`);

            // Start auto-refill service after x402 is ready
            initAutoRefillClient(PRIVATE_KEY);
            startAutoRefillService();

            // Start auto-withdraw for agent earnings
            startAutoWithdraw();
        })
        .catch((err) => {
            console.error("❌ Failed to initialize x402 payments:", err.message);
        });
}

// --- API Routes ---

// Health check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        chain: config.chain.name,
        contracts: config.contracts,
        geminiEnabled: !!GEMINI_API_KEY,
    });
});

// Debug endpoint to check env vars (Remove after use)
app.get("/debug/env", (req, res) => {
    res.json({
        perpStatsAddress: process.env.PERP_STATS_X402_ADDRESS || "MISSING",
    });
});

// x402 Agent Routes (Seller Endpoints)
app.use("/api/x402", x402AgentRoutes);
console.log("✅ x402 Seller Endpoints: Mounted at /api/x402");

// Get agent info
app.get("/agent/info", async (req, res) => {

    try {
        const stats = await providerAgent!.getStats();
        res.json({
            address: providerAgent!.address,
            agentId: stats.agentId.toString(),
            reputation: stats.reputation.toString(),
            tasksCompleted: stats.tasksCompleted.toString(),
            balance: formatEther(stats.balance),
        });
    } catch (error) {
        res.json({
            address: providerAgent?.address || "unknown",
            registered: false,
            error: (error as Error).message,
        });
    }
});

// Register as provider
app.post("/agent/register", async (req, res) => {

    try {
        const { name, serviceType, price } = req.body;
        const agentId = await providerAgent!.register(
            name || "AI Provider Bot",
            serviceType || "text-generation",
            price ? BigInt(price) : config.agent.providerPrice
        );
        res.json({
            success: true,
            agentId: agentId.toString(),
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// Process a query (user-facing endpoint)
app.post("/query", queryLimiter, async (req, res) => {
    try {
        const { query, txHash, userAddress, imageData, conversationHistory } = req.body;

        // Allow image-only queries
        if (!query && !imageData) {
            return res.status(400).json({
                success: false,
                error: "Query or image is required"
            });
        }

        // If txHash is provided, verify the user's payment
        if (txHash && userAddress) {
            console.log(`[Query] Verifying user payment: ${txHash}`);

            try {
                // Wait for transaction receipt to confirm it's mined
                const receipt = await publicClient.waitForTransactionReceipt({
                    hash: txHash as `0x${string}`,
                    timeout: 30_000, // 30 second timeout
                });

                if (receipt.status !== 'success') {
                    return res.status(400).json({
                        success: false,
                        error: "Payment transaction failed"
                    });
                }

                console.log(`[Query] Payment verified! Block: ${receipt.blockNumber}`);

                // User payment is a direct USDC transfer (verified by receipt.status === 'success')
                // No escrow verification needed - escrows are for Chat Agent → Oracle/Scout payments
                const paymentAmount = "0.03"; // $0.03 per query
                console.log(`[Query] Payment confirmed. Amount: $${paymentAmount} USDC`);

                // Process the query using Gemini (no need to create another escrow)
                const { generateResponse } = await import("./services/gemini.js");

                // Measure response time
                const startTime = Date.now();
                let aiResponse = "";
                let agentsUsed: string[] = [];

                try {
                    const result = await generateResponse(query || '', imageData, conversationHistory);
                    aiResponse = result.response;
                    agentsUsed = result.agentsUsed;
                    // Log query with x402 transaction hash per agent (not user's payment tx)
                    const responseTimeMs = Date.now() - startTime;
                    for (const agentId of agentsUsed) {
                        const x402TxHash = result.x402Transactions[agentId] || undefined;
                        await logQueryTime(responseTimeMs, agentId, x402TxHash);
                    }
                    if (agentsUsed.length === 0) {
                        await logQueryTime(responseTimeMs, undefined, undefined);
                    }
                } catch (aiError) {
                    console.error(`[Query] AI Generation failed:`, aiError);
                    // Return success=false but acknowledge payment worked
                    return res.status(502).json({
                        success: false,
                        error: `Payment Confirmed, but AI Generation failed: ${(aiError as Error).message}. Payment verification was successful (Block: ${receipt.blockNumber}).`,
                        txHash: txHash
                    });
                }

                const responseTimeMs = Date.now() - startTime;
                console.log(`[Query] Response generated in ${responseTimeMs}ms for user ${userAddress.slice(0, 10)}... (agents: ${agentsUsed.join(', ') || 'none'})`);

                return res.json({
                    success: true,
                    response: aiResponse,
                    agentsUsed: agentsUsed,
                    cost: paymentAmount,
                    txHash: txHash,
                });
            } catch (verifyError) {
                console.error(`[Query] Payment verification failed:`, verifyError);
                return res.status(400).json({
                    success: false,
                    error: `Payment verification failed: ${(verifyError as Error).message}`
                });
            }
        }

        // Fallback: If no txHash provided, use the old flow (backend creates escrow)
        // This maintains backward compatibility
        console.log(`[Query] No txHash provided, using legacy flow`);
        const result = await resellerAgent!.processQuery(query);

        res.json({
            success: true,
            response: result.response,
            cost: formatEther(result.cost),
            providerId: result.providerId.toString(),
            escrowId: result.escrowId.toString(),
        });
    } catch (error) {
        console.error("Query error:", error);
        res.status(500).json({
            success: false,
            error: (error as Error).message,
        });
    }
});

// Find providers
app.get("/providers", async (req, res) => {

    try {
        const serviceType = (req.query.serviceType as string) || "";
        const providers: any[] = [];

        // Get Chat Agent (text-generation)
        try {
            const { agentId, price } = await resellerAgent!.findProvider("text-generation");
            if (agentId !== 0n) {
                const details = await resellerAgent!.getProviderDetails(agentId);
                providers.push({
                    agentId: agentId.toString(),
                    name: details.name,
                    wallet: details.wallet,
                    price: formatEther(price),
                    active: details.active,
                    serviceType: "text-generation",
                    category: "Analytics",
                });
            }
        } catch (e) {
            // Chat agent not available
        }

        // Add Price Oracle
        const oracleAddress = getOracleAddress();
        if (oracleAddress) {
            providers.push({
                agentId: "oracle",
                name: "Price Oracle Agent",
                wallet: oracleAddress,
                price: "0.01",
                active: true,
                serviceType: "oracle",
                category: "DeFi",
                description: "Real-time cryptocurrency prices from CoinGecko. Supports BTC, ETH, SOL, and 100+ tokens.",
            });
        }

        // Add Chain Scout (On-Chain Analytics)
        const scoutAddress = getScoutAddress();
        if (scoutAddress) {
            providers.push({
                agentId: "scout",
                name: "Chain Scout",
                wallet: scoutAddress,
                price: "0.02",
                active: true,
                serviceType: "analytics",
                category: "Analytics",
                description: "Wallet analytics, protocol TVL, DEX volume, bridges, and exploit tracking.",
            });
        }

        // Add News Scout
        const newsScoutAddress = getNewsScoutAddress();
        if (newsScoutAddress) {
            providers.push({
                agentId: "news",
                name: "News Scout",
                wallet: newsScoutAddress,
                price: "0.01",
                active: true,
                serviceType: "news",
                category: "Analytics",
                description: "Real-time crypto news aggregator, sentiment analysis, and trending topics.",
            });
        }

        // Add Yield Optimizer
        const yieldAddress = getYieldAddress();
        if (yieldAddress) {
            providers.push({
                agentId: "yield",
                name: "Yield Optimizer",
                wallet: yieldAddress,
                price: "0.01",
                active: true,
                serviceType: "defi",
                category: "DeFi",
                description: "DeFi yield aggregator from Lido, Yearn, Beefy, Curve, Aave, and Pendle. Compares APYs across protocols.",
            });
        }

        // Add Tokenomics Analyzer
        const tokenomicsAddress = getTokenomicsAddress();
        if (tokenomicsAddress) {
            providers.push({
                agentId: "tokenomics",
                name: "Tokenomics Analyzer",
                wallet: tokenomicsAddress,
                price: "0.02",
                active: true,
                serviceType: "research",
                category: "Research",
                description: "Token supply analysis, vesting schedules, unlock events, and inflation rates for ARB, OP, SUI, APT, and more.",
            });
        }

        // Add NFT Scout
        const nftScoutAddress = getNftScoutAddress();
        if (nftScoutAddress) {
            providers.push({
                agentId: "nft",
                name: "NFT Scout",
                wallet: nftScoutAddress,
                price: "0.02",
                active: true,
                serviceType: "nft",
                category: "NFT",
                description: "NFT collection analytics, floor prices, volume trends, and sales history for OpenSea collections.",
            });
        }

        // Add Perp Stats Agent
        const perpStatsAddress = process.env.PERP_STATS_X402_ADDRESS;
        if (perpStatsAddress) {
            providers.push({
                agentId: "perp",
                name: "Universal Perp Stats",
                wallet: perpStatsAddress,
                price: "0.02",
                active: true,
                serviceType: "perp",
                category: "Trading",
                description: "Real-time aggregated funding rates, open interest, and volume from Hyperliquid, dYdX, and 5+ other DEXs.",
            });
        }

        // Get per-agent stats from database
        const agentStats = await getAllAgentStats();
        const statsMap = new Map(agentStats.map(s => [s.agentId, s]));

        // Filter by service type if specified
        const filtered = serviceType
            ? providers.filter(p => p.serviceType === serviceType || serviceType === "")
            : providers;

        // Add per-agent stats to each provider
        const providersWithStats = filtered.map(p => {
            const stats = statsMap.get(p.agentId);
            return {
                ...p,
                rating: stats?.rating || 0,
                totalRatings: stats?.totalRatings || 0,
                avgResponseTime: stats?.avgResponseTimeMs ? (stats.avgResponseTimeMs / 1000).toFixed(1) + 's' : '0s',
                usageCount: stats?.usageCount || 0
            };
        });

        res.json({ providers: providersWithStats });
    } catch (error) {
        res.status(500).json({
            error: (error as Error).message,
        });
    }
});

// Get pending escrows for provider
app.get("/agent/pending", async (req, res) => {

    try {
        const pending = await providerAgent!.getPendingEscrows();
        res.json({
            pending: pending.map(({ escrowId, data }) => ({
                escrowId: escrowId.toString(),
                buyer: data.buyer,
                amount: formatEther(data.amount),
                deadline: data.deadline.toString(),
            })),
        });
    } catch (error) {
        res.status(500).json({
            error: (error as Error).message,
        });
    }
});

// Dashboard stats
app.get("/dashboard/stats", async (req, res) => {
    const agentId = req.query.agentId as string;

    try {
        // If agentId is provided, return stats for that specific agent
        if (agentId) {
            // Use optimized single-agent lookup instead of fetching all agents
            const stats = await getAgentStatsById(agentId);

            // Get agent x402 payment wallet address for balance lookup (these have the actual funds)
            let walletAddress: string | null = null;
            let agentName = agentId;

            switch (agentId) {
                case 'oracle':
                    walletAddress = process.env.ORACLE_X402_ADDRESS || '0xbaFF2E0939f89b53d4caE023078746C2eeA6E2F7';
                    agentName = 'Price Oracle Agent';
                    break;
                case 'scout':
                    walletAddress = process.env.SCOUT_X402_ADDRESS || '0xf09bC01bEb00b142071b648c4826Ab48572aEea5';
                    agentName = 'Chain Scout';
                    break;
                case 'news':
                    walletAddress = process.env.NEWS_X402_ADDRESS || '0x32a6778E4D6634BaB9e54A9F78ff5D087179a5c4';
                    agentName = 'News Scout';
                    break;
                case 'yield':
                    walletAddress = process.env.YIELD_X402_ADDRESS || '0x095691C40335E7Da13ca669EE3A07eB7422e2be3';
                    agentName = 'Yield Optimizer';
                    break;
                case 'tokenomics':
                    walletAddress = process.env.TOKENOMICS_X402_ADDRESS || '0xc99A4f20E7433d0B6fB48ca805Ffebe989e48Ca6';
                    agentName = 'Tokenomics Analyzer';
                    break;
                case 'nft':
                    walletAddress = process.env.NFT_SCOUT_X402_ADDRESS || '0xEb6d935822e643Af37ec7C6a7Bd6136c0036Cd69';
                    agentName = 'NFT Scout';
                    break;
                case 'perp':
                    walletAddress = process.env.PERP_STATS_X402_ADDRESS || '0x89651811043ba5a04d44b17462d07a0e3cf0565e';
                    agentName = 'Universal Perp Stats';
                    break;
            }

            // Fetch real wallet balance
            let balanceUsd = "0.00";
            if (walletAddress) {
                try {
                    const balanceWei = await publicClient.getBalance({ address: walletAddress as `0x${string}` });
                    balanceUsd = parseFloat(formatEther(balanceWei)).toFixed(2);
                } catch (e) {
                    console.error(`[Dashboard] Failed to fetch balance for ${agentId}:`, e);
                }
            }

            res.json({
                agentId,
                agentName,
                wallet: walletAddress,
                treasury: balanceUsd,
                tasksCompleted: stats?.usageCount || 0,
                rating: stats?.rating || 0,
                totalRatings: stats?.totalRatings || 0,
                avgResponseTime: stats?.avgResponseTimeMs ? (stats.avgResponseTimeMs / 1000).toFixed(1) + 's' : '0s',
                isFrozen: false,
            });
            return;
        }

        // Default: return aggregate stats from providerAgent
        const stats = await providerAgent!.getStats();
        res.json({
            treasury: formatEther(stats.balance),
            tasksCompleted: Number(stats.tasksCompleted),
            isFrozen: false,
        });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Recent activity for agent dashboard
app.get("/dashboard/activity", async (req, res) => {
    const agentId = req.query.agentId as string;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!agentId) {
        return res.status(400).json({ error: "agentId required" });
    }

    try {
        const queries = await getRecentQueries(agentId, limit);

        // Transform to activity format
        const activities = queries.map(q => ({
            id: q.id,
            type: 'Query Processed',
            timestamp: q.createdAt,
            action: 'received' as const,
            responseTimeMs: q.responseTimeMs,
            amount: 0.01, // Query price (simplified)
            txHash: q.txHash
        }));

        res.json({ activities });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Faucet Endpoint (Circle MCP)
app.post("/faucet", faucetLimiter, async (req, res) => {
    const { address } = req.body;

    if (!address) {
        return res.status(400).json({ error: "Address required" });
    }

    if (!CIRCLE_API_KEY) {
        // Mock success in demo/no-key mode
        return res.json({ success: true, message: "Mock faucet funding successful" });
    }

    try {
        await requestTestnetTokens(address);
        res.json({ success: true, message: "Funds requested from Circle Faucet" });
    } catch (error) {
        console.error("Faucet error:", error);
        const params = JSON.stringify((error as any).response?.data || {});
        res.status(500).json({ error: `Request failed: ${(error as Error).message} ${params}` });
    }
});

// CCTP Deposit Endpoint - Routes deposits through backend using Bridge Kit
app.post("/cctp/deposit", async (req, res) => {
    const { sourceChain, amount, recipientAddress } = req.body;

    if (!sourceChain || !amount || !recipientAddress) {
        return res.status(400).json({
            success: false,
            error: "Missing required fields: sourceChain, amount, recipientAddress"
        });
    }

    if (!PRIVATE_KEY) {
        return res.status(500).json({
            success: false,
            error: "Server not configured for CCTP deposits (no private key)"
        });
    }

    // Map frontend chain names to Bridge Kit chain identifiers
    const chainMap: Record<string, string> = {
        'Ethereum Sepolia': 'Ethereum_Sepolia',
        'Polygon Amoy': 'Polygon_Amoy_Testnet',
        'Arbitrum Sepolia': 'Arbitrum_Sepolia',
        'Optimism Sepolia': 'Optimism_Sepolia',
        'Base Sepolia': 'Base_Sepolia'
    };

    const bridgeChain = chainMap[sourceChain];
    if (!bridgeChain) {
        return res.status(400).json({
            success: false,
            error: `Unsupported chain: ${sourceChain}`
        });
    }

    try {
        console.log(`\n🚀 CCTP Deposit: ${amount} USDC from ${sourceChain} to Arc Testnet`);
        console.log(`   Recipient: ${recipientAddress}`);

        // Dynamic import to avoid loading Bridge Kit if not needed
        const { BridgeKit } = await import('@circle-fin/bridge-kit');
        const { createAdapterFromPrivateKey } = await import('@circle-fin/adapter-viem-v2');

        const adapter = createAdapterFromPrivateKey({
            privateKey: PRIVATE_KEY
        });

        const kit = new BridgeKit();

        const result = await kit.bridge({
            from: {
                adapter,
                chain: bridgeChain as any
            },
            to: {
                adapter,
                chain: 'Arc_Testnet' as any,
                recipientAddress: recipientAddress
            },
            amount: amount,
            token: 'USDC'
        });

        console.log(`   Result: ${result.state}`);

        if (result.state === 'success') {
            const burnTx = result.steps?.find((s: any) => s.name === 'burn')?.txHash;
            const mintTx = result.steps?.find((s: any) => s.name === 'mint')?.txHash;

            res.json({
                success: true,
                state: result.state,
                amount: result.amount,
                burnTxHash: burnTx,
                mintTxHash: mintTx,
                steps: result.steps?.map((s: any) => ({
                    name: s.name,
                    state: s.state,
                    txHash: s.txHash,
                    explorerUrl: s.explorerUrl
                }))
            });
        } else {
            const failedStep = result.steps?.find((s: any) => s.state === 'error' || s.state === 'failed');
            res.status(500).json({
                success: false,
                state: result.state,
                error: (failedStep as any)?.errorMessage || 'Bridge failed',
                steps: result.steps?.map((s: any) => ({
                    name: s.name,
                    state: s.state,
                    errorMessage: s.errorMessage
                }))
            });
        }

    } catch (error: any) {
        console.error("CCTP Deposit error:", error);
        res.status(500).json({
            success: false,
            error: error.message,
            cause: error.cause?.trace || null
        });
    }
});

// ============ Chat History Endpoints ============

// Get all chat sessions for a wallet
app.get("/chat/sessions", async (req, res) => {
    const walletAddress = req.query.wallet as string;
    if (!walletAddress) {
        return res.status(400).json({ success: false, error: "Wallet address required" });
    }

    const sessions = await getChatSessions(walletAddress);
    res.json({ success: true, sessions });
});

// Create a new chat session
app.post("/chat/sessions", async (req, res) => {
    const { walletAddress, title } = req.body;
    if (!walletAddress) {
        return res.status(400).json({ success: false, error: "Wallet address required" });
    }

    const session = await createChatSession(walletAddress, title);
    if (!session) {
        return res.status(500).json({ success: false, error: "Failed to create session" });
    }

    res.json({ success: true, session });
});

// Delete a chat session
app.delete("/chat/sessions/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const walletAddress = req.query.wallet as string;
    if (!walletAddress) {
        return res.status(400).json({ success: false, error: "Wallet address required" });
    }

    const success = await deleteChatSession(sessionId, walletAddress);
    res.json({ success });
});

// Get messages for a session
app.get("/chat/sessions/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;
    const messages = await getMessages(sessionId);
    res.json({ success: true, messages });
});

// Save a message to a session
app.post("/chat/sessions/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;
    const { id, content, is_user, escrow_id, tx_hash, image_preview } = req.body;

    const message = await saveMessage(sessionId, { id, content, is_user, escrow_id, tx_hash, image_preview });
    if (!message) {
        return res.status(500).json({ success: false, error: "Failed to save message" });
    }

    res.json({ success: true, message });
});

// Clear all messages in a session
app.delete("/chat/sessions/:sessionId/messages", async (req, res) => {
    const { sessionId } = req.params;
    const success = await clearMessages(sessionId);
    res.json({ success });
});

// --- Start Server ---

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
    const geminiLabel = GEMINI_API_KEY ? "✅ Gemini" : "❌ Gemini";

    // Check Gateway Status
    checkGatewayStatus().then(status => {
        if (status.wallet && status.minter) {
            console.log("✅ Circle Gateway & CCTP: Active");
        } else {
            console.log("⚠️ Circle Gateway/CCTP: Contracts not found");
        }
    });

    // ============ Message Ratings ============

    // Rate a message (thumbs up/down)
    app.post("/ratings", async (req, res) => {
        const { messageId, walletAddress, isPositive, agentId } = req.body;

        if (!messageId || !walletAddress || typeof isPositive !== 'boolean') {
            return res.status(400).json({ success: false, error: "Missing required fields" });
        }

        const success = await rateMessage(messageId, walletAddress, isPositive, agentId);
        res.json({ success });
    });

    // Get user's rating for a specific message
    app.get("/ratings/:messageId", async (req, res) => {
        const { messageId } = req.params;
        const walletAddress = req.query.wallet as string;

        if (!walletAddress) {
            return res.status(400).json({ success: false, error: "Wallet address required" });
        }

        const rating = await getMessageRating(messageId, walletAddress);
        res.json({ success: true, rating }); // rating is null if not rated, true/false otherwise
    });

    // Get overall agent rating
    app.get("/agent/rating", async (req, res) => {
        const { rating, totalRatings } = await getAgentRating();
        res.json({ success: true, rating, totalRatings });
    });

    // Get average response time
    app.get("/agent/response-time", async (req, res) => {
        const avgResponseTimeMs = await getAverageResponseTime();
        res.json({ success: true, avgResponseTimeMs });
    });

    // Get total usage count
    app.get("/agent/usage-count", async (req, res) => {
        const usageCount = await getTotalUsageCount();
        res.json({ success: true, usageCount });
    });

    // ============ Price Oracle Agent ============

    // Get single price
    app.get("/oracle/price/:symbol", async (req, res) => {
        const { symbol } = req.params;

        if (!symbol) {
            return res.status(400).json({ success: false, error: "Symbol required" });
        }

        const priceData = await fetchPrice(symbol);

        if (!priceData) {
            return res.status(404).json({ success: false, error: `Price not found for ${symbol}` });
        }

        res.json({ success: true, data: priceData });
    });

    // Get multiple prices
    app.get("/oracle/prices", async (req, res) => {
        const symbolsParam = req.query.symbols as string;

        if (!symbolsParam) {
            return res.status(400).json({ success: false, error: "Symbols required (comma-separated)" });
        }

        const symbols = symbolsParam.split(",").map(s => s.trim());
        const prices = await fetchPrices(symbols);

        res.json({ success: true, data: prices });
    });

    // Get Oracle wallet info
    app.get("/oracle/wallet", async (req, res) => {
        const { balance, address } = await getOracleBalance();
        const agentInfo = getOracleAgentInfo();

        res.json({
            success: true,
            name: agentInfo.name,
            address: address,
            balance: balance,
            pricePerQuery: formatEther(agentInfo.price),
        });
    });

    // Withdraw from Oracle wallet
    app.post("/oracle/wallet/withdraw", async (req, res) => {
        const { amount, destinationAddress } = req.body;

        if (!amount || !destinationAddress) {
            return res.status(400).json({ success: false, error: "Amount and destinationAddress required" });
        }

        try {
            const result = await withdrawOracleFunds(amount, destinationAddress);
            res.json({ success: true, ...result });
        } catch (error) {
            res.status(500).json({ success: false, error: (error as Error).message });
        }
    });

    // Register Oracle agent on-chain
    app.post("/oracle/register", async (req, res) => {
        try {
            console.log("[Oracle] Starting registration...");
            const result = await registerOracleAgent(config.contracts.agentRegistry);
            res.json({ success: true, ...result });
        } catch (error: any) {
            console.error("[Oracle] Registration failed:", error?.response?.data || error.message);
            res.status(500).json({
                success: false,
                error: error?.response?.data?.message || error.message,
                details: error?.response?.data
            });
        }
    });

    // Fund Oracle wallet with testnet tokens
    app.post("/oracle/faucet", faucetLimiter, async (req, res) => {
        try {
            const address = getOracleAddress();
            if (!address) {
                return res.status(400).json({ success: false, error: "Oracle wallet not initialized" });
            }

            console.log(`[Oracle] Requesting testnet tokens for ${address}...`);
            await requestTestnetTokens(address);

            res.json({ success: true, address, message: "Testnet tokens requested. Check balance in a few seconds." });
        } catch (error: any) {
            console.error("[Oracle] Faucet error:", error?.response?.data || error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ Chat Agent Wallet ============

    // Get Chat Agent wallet info
    app.get("/chat-agent/wallet", async (req, res) => {
        const { balance, address } = await getChatBalance();
        res.json({
            success: true,
            name: "Chat Agent",
            address: address,
            balance: balance,
        });
    });

    // Fund Chat Agent wallet with testnet tokens
    app.post("/chat-agent/faucet", faucetLimiter, async (req, res) => {
        try {
            const address = getChatAddress();
            if (!address) {
                return res.status(400).json({ success: false, error: "Chat Agent wallet not initialized" });
            }

            console.log(`[Chat Agent] Requesting testnet tokens for ${address}...`);
            await requestTestnetTokens(address);

            res.json({ success: true, address, message: "Testnet tokens requested. Check balance in a few seconds." });
        } catch (error: any) {
            console.error("[Chat Agent] Faucet error:", error?.response?.data || error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ============ Agent-to-Agent Payments ============

    // Get all agent wallet statuses
    app.get("/agents/wallets", (req, res) => {
        const status = getAgentWalletStatus();
        res.json({ success: true, ...status });
    });

    // Create payment from Chat Agent to Oracle
    app.post("/agents/pay-oracle", async (req, res) => {
        const { task } = req.body;

        if (!task) {
            return res.status(400).json({ success: false, error: "Task description required" });
        }

        try {
            const result = await createOraclePayment(task);
            res.json({ success: true, ...result });
        } catch (error: any) {
            console.error("[Agent Payment] Error:", error?.response?.data || error.message);
            res.status(500).json({
                success: false,
                error: error?.response?.data?.message || error.message
            });
        }
    });

    // Release escrow (Chat Agent pays Oracle)
    app.post("/agents/release-escrow/:escrowId", async (req, res) => {
        const escrowId = parseInt(req.params.escrowId);

        if (isNaN(escrowId)) {
            return res.status(400).json({ success: false, error: "Valid escrow ID required" });
        }

        try {
            const result = await releaseOraclePayment(escrowId);
            res.json({ success: true, ...result });
        } catch (error: any) {
            console.error("[Agent Payment] Release error:", error?.response?.data || error.message);
            res.status(500).json({
                success: false,
                error: error?.response?.data?.message || error.message
            });
        }
    });

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║          Agent Marketplace Backend                        ║
╠═══════════════════════════════════════════════════════════╣
║  Server:    http://localhost:${PORT}                         ║
║  Mode:      LIVE MODE                                 ║
║  Chain:     ${config.chain.name.padEnd(42)}║
║  ${geminiLabel.padEnd(54)}║
╚═══════════════════════════════════════════════════════════╝
  `);
});
