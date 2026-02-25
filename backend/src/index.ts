import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { ResellerAgent } from "./agents/reseller.js";
import { ProviderAgent } from "./agents/provider.js";
import { publicClient, contracts } from "./blockchain.js";
import { formatEther, formatUnits, parseAbi } from "viem";
import { generateResponse, initGemini } from "./services/gemini.js";
import { fetchPrice, fetchPrices } from "./services/price-oracle.js";
import {
    initX402Payments,
    getSessionSpendSummary,
    getRecentReceipts,
    getSellerAddressMap,
    getX402BuyerSource
} from "./services/x402-agent-payments.js";
import {
    askPinionChat,
    broadcastWithPinion,
    clearPinionApiKey,
    clearRuntimeSpendLimit,
    generatePinionWallet,
    getPinionApiKeyStatus,
    getPinionBalance,
    getPinionNetwork,
    getRuntimeSpendStatus,
    getPinionPrice,
    getPinionRuntimeStatus,
    getPinionFunding,
    getPinionTx,
    purchasePinionUnlimited,
    sendWithPinion,
    setPinionApiKey,
    setRuntimeSpendLimit,
    tradeWithPinion,
    verifyPinionUnlimitedKey,
} from "./services/pinion-runtime.js";
import {
    ensureProcurementStateReady,
    executeProcurementIntent,
    getProcurementState,
    rankProcurementCandidates,
    type ProcurementCandidate,
    type ProcurementPolicy,
} from "./services/x402-procurement.js";
import { buildX402AgentRoutes } from "./routes/x402-agent-routes.js";
import {
    initSupabase,
    getSupabase,
    getLastSupabaseError,
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
    getRecentQueries,
    getRecentX402Payments,
    saveX402Trace,
    getSessionSpendFromDb
} from "./services/supabase.js";
import {
    ensureAgentPoliciesReady,
    getAgentPolicy,
    getAllAgentPolicies,
    isAgentFrozen,
    setAgentFrozen,
    updateAgentPolicy,
} from "./services/agent-policy.js";
import { type X402AgentId, X402_AGENT_IDS } from "./services/x402-common.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
    path: path.resolve(__dirname, "../.env"),
    override: process.env.NODE_ENV !== "production",
});

const app = express();
const x402TraceBySession = new Map<string, any>();
const x402TraceById = new Map<string, any>();
const ERC20_BALANCE_ABI = parseAbi([
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)",
]);

// Required for hosted environments (Render, Railway, etc.) so
// express-rate-limit can safely use X-Forwarded-For from the edge proxy.
app.set('trust proxy', 1);

function inferAgentIdFromEndpoint(endpoint?: string): string | null {
    if (!endpoint) return null;
    const match = endpoint.match(/\/api\/x402\/([^/?#]+)/i);
    return match?.[1]?.toLowerCase() || null;
}

function inferAgentIdFromTraceStep(step: { endpoint?: string; toolName?: string }): string | null {
    const fromEndpoint = inferAgentIdFromEndpoint(step.endpoint);
    if (fromEndpoint) return fromEndpoint;

    const tool = (step.toolName || "").toLowerCase();
    if (!tool) return null;
    if (tool.includes("oracle") || tool.includes("price")) return "oracle";
    if (tool.includes("yield")) return "yield";
    if (tool.includes("tokenomics")) return "tokenomics";
    if (tool.includes("nft")) return "nft";
    if (tool.includes("perp")) return "perp";
    if (tool.includes("news")) return "news";
    if (tool.includes("scout")) return "scout";
    return null;
}

function parseAgentId(input?: string): X402AgentId | null {
    if (!input) return null;
    const normalized = input.toLowerCase();
    return X402_AGENT_IDS.includes(normalized as X402AgentId) ? (normalized as X402AgentId) : null;
}

function isAdminRequestAuthorized(req: express.Request): boolean {
    const requiredKey = process.env.ADMIN_API_KEY;
    if (!requiredKey) return true;
    const provided = req.header('x-admin-key');
    return provided === requiredKey;
}

function parseCsvList(value?: string): string[] {
    if (!value) return [];
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function parsePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

function parseAtomicCap(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed || !/^\\d+$/.test(trimmed)) return undefined;
    return trimmed;
}

function intersectAllowlists(primary: string[], secondary: string[]): string[] {
    if (primary.length === 0) return secondary;
    if (secondary.length === 0) return primary;
    const secondarySet = new Set(secondary.map((value) => value.toLowerCase()));
    return primary.filter((value) => secondarySet.has(value.toLowerCase()));
}

function minAtomic(a?: string, b?: string): string | undefined {
    if (!a) return b;
    if (!b) return a;
    const aBig = BigInt(a);
    const bBig = BigInt(b);
    return (aBig < bBig ? aBig : bBig).toString();
}

function getServerProcurementPolicy(): ProcurementPolicy {
    const allowedDomains = parseCsvList(process.env.X402_PROCUREMENT_ALLOWED_DOMAINS);
    const blockedDomains = parseCsvList(process.env.X402_PROCUREMENT_BLOCKED_DOMAINS);
    const networkAllowlist = parseCsvList(process.env.X402_PROCUREMENT_NETWORK_ALLOWLIST);
    const payToAllowlist = parseCsvList(process.env.X402_PROCUREMENT_PAYTO_ALLOWLIST);
    const maxAmountAtomic = parseAtomicCap(process.env.X402_PROCUREMENT_MAX_AMOUNT_ATOMIC);
    const requireHttps = process.env.X402_PROCUREMENT_REQUIRE_HTTPS !== 'false';
    const requireX402 = process.env.X402_PROCUREMENT_REQUIRE_X402 !== 'false';
    const maxAttempts = parsePositiveInteger(process.env.X402_PROCUREMENT_MAX_ATTEMPTS, 3);

    return {
        allowedDomains,
        blockedDomains,
        networkAllowlist,
        payToAllowlist,
        maxAmountAtomic,
        requireHttps,
        requireX402,
        maxAttempts,
    };
}

function mergeProcurementPolicies(requestPolicy: unknown): ProcurementPolicy {
    const serverPolicy = getServerProcurementPolicy();
    const request = (requestPolicy && typeof requestPolicy === 'object')
        ? requestPolicy as Record<string, unknown>
        : {};

    const requestAllowedDomains = Array.isArray(request.allowedDomains)
        ? request.allowedDomains.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    const requestBlockedDomains = Array.isArray(request.blockedDomains)
        ? request.blockedDomains.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    const requestNetworks = Array.isArray(request.networkAllowlist)
        ? request.networkAllowlist.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];
    const requestPayTo = Array.isArray(request.payToAllowlist)
        ? request.payToAllowlist.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        : [];

    const requestMaxAttempts = parsePositiveInteger(request.maxAttempts, serverPolicy.maxAttempts || 3);

    return {
        allowedDomains: intersectAllowlists(serverPolicy.allowedDomains || [], requestAllowedDomains),
        blockedDomains: Array.from(new Set([...(serverPolicy.blockedDomains || []), ...requestBlockedDomains])),
        networkAllowlist: intersectAllowlists(serverPolicy.networkAllowlist || [], requestNetworks),
        payToAllowlist: intersectAllowlists(serverPolicy.payToAllowlist || [], requestPayTo),
        maxAmountAtomic: minAtomic(serverPolicy.maxAmountAtomic, parseAtomicCap(request.maxAmountAtomic)),
        requireHttps: serverPolicy.requireHttps && request.requireHttps !== false,
        requireX402: serverPolicy.requireX402 && request.requireX402 !== false,
        maxAttempts: Math.max(1, Math.min(10, requestMaxAttempts)),
    };
}

function sanitizeProcurementCandidates(raw: unknown): ProcurementCandidate[] {
    if (!Array.isArray(raw)) return [];

    const maxCandidates = parsePositiveInteger(process.env.X402_PROCUREMENT_MAX_CANDIDATES, 8);
    const candidates: ProcurementCandidate[] = [];

    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        const id = String(item.id || '').trim();
        const url = String(item.url || '').trim();

        if (!id || !url) continue;

        const methodRaw = String(item.method || 'GET').toUpperCase();
        const method = (methodRaw === 'POST' || methodRaw === 'PUT' || methodRaw === 'PATCH' || methodRaw === 'DELETE')
            ? methodRaw
            : 'GET';

        const headers = (item.headers && typeof item.headers === 'object' && !Array.isArray(item.headers))
            ? Object.fromEntries(
                Object.entries(item.headers as Record<string, unknown>)
                    .filter(([, value]) => typeof value === 'string')
                    .map(([key, value]) => [key, value as string]),
            )
            : undefined;

        const expectedFields = Array.isArray(item.expectedFields)
            ? item.expectedFields.filter((field): field is string => typeof field === 'string' && field.trim().length > 0)
            : undefined;

        candidates.push({
            id,
            url,
            method,
            body: item.body,
            headers,
            maxAmountAtomic: parseAtomicCap(item.maxAmountAtomic),
            expectedFields,
        });

        if (candidates.length >= maxCandidates) break;
    }

    return candidates;
}

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
    skip: (req) => {
        const path = req.path || '';

        // Browser preflight and read-heavy dashboard polling should not consume global quota.
        if (req.method === 'OPTIONS') return true;
        if (req.method === 'GET' && (
            path === '/health' ||
            path === '/providers' ||
            path.startsWith('/dashboard/')
        )) {
            return true;
        }

        // Admin policy routes use a dedicated limiter below.
        if (path.startsWith('/admin/policy')) return true;

        return false;
    },
});

const queryLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 queries per minute
    message: { error: 'Query rate limit exceeded. Please wait before sending more queries.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const adminPolicyLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 admin policy requests per minute per IP
    message: { error: 'Too many admin policy requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(generalLimiter);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/admin/policy', adminPolicyLimiter);

// Environment validation
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!PRIVATE_KEY) {
    console.error("❌ PRIVATE_KEY is missing in .env. Startup failed.");
    process.exit(1);
}

const resellerAgent = new ResellerAgent(PRIVATE_KEY);
const providerAgent = new ProviderAgent(PRIVATE_KEY);

if (GEMINI_API_KEY) {
    providerAgent.initializeGemini(GEMINI_API_KEY);
}

// Initialize Supabase
const supabaseEnabled = initSupabase();
if (supabaseEnabled) {
    console.log("✅ Supabase initialized");
}

void ensureAgentPoliciesReady().catch((error) => {
    console.warn('[Policy] Failed to preload agent policies:', (error as Error).message);
});

void ensureProcurementStateReady().catch((error) => {
    console.warn('[Procurement] Failed to preload procurement state:', (error as Error).message);
});

let x402SellerAddresses = getSellerAddressMap();
let x402InitStatus: 'pending' | 'ready' | 'failed' = 'pending';
let x402InitError: string | null = null;

async function initializeX402PaymentsBackground() {
    const timeoutMs = Number(process.env.X402_INIT_TIMEOUT_MS || 15000);
    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`x402 init timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
        const x402Init = await Promise.race([
            initX402Payments(PRIVATE_KEY),
            timeoutPromise,
        ]);
        x402SellerAddresses = x402Init.sellerAddresses;
        x402InitStatus = 'ready';
        x402InitError = null;
        console.log(`✅ x402 Buyer: Ready (${getX402BuyerSource()})`);
    } catch (err) {
        x402InitStatus = 'failed';
        x402InitError = (err as Error).message;
        console.error("❌ Failed to initialize x402 payments:", x402InitError);
        console.warn("⚠️ x402 routes started with existing configured seller addresses.");
    }
}

// --- API Routes ---

// Health check
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        chain: config.chain.name,
        contracts: config.contracts,
        geminiEnabled: !!GEMINI_API_KEY,
        supabaseEnabled: !!getSupabase(),
        x402: {
            buyerSigner: getX402BuyerSource(),
            network: getPinionNetwork() === "base-sepolia" ? "eip155:84532" : "eip155:8453",
            initStatus: x402InitStatus,
            initError: x402InitError,
            runtimeSpendLimit: getRuntimeSpendStatus(),
        },
    });
});

// x402 Agent Routes (Seller Endpoints)
const x402AgentRoutes = buildX402AgentRoutes({ sellerAddresses: x402SellerAddresses });
app.use("/api/x402", x402AgentRoutes);
console.log("✅ x402 Seller Endpoints: Mounted at /api/x402");

// Pinion-backed runtime spend limit (additional guardrail)
app.get("/x402/runtime-spend-limit", (_req, res) => {
    res.json({
        success: true,
        status: getRuntimeSpendStatus(),
    });
});

app.post("/x402/runtime-spend-limit", (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const action = String(req.body?.action || "status").toLowerCase();
        if (action === "set") {
            const maxUsdc = String(req.body?.maxUsdc ?? req.body?.max_usdc ?? "");
            const status = setRuntimeSpendLimit(maxUsdc);
            return res.json({ success: true, status });
        }
        if (action === "clear") {
            const status = clearRuntimeSpendLimit();
            return res.json({ success: true, status });
        }
        return res.json({ success: true, status: getRuntimeSpendStatus() });
    } catch (error) {
        return res.status(400).json({ success: false, error: (error as Error).message });
    }
});

// Trust + procurement layer: rank and execute candidate x402 services
app.post("/x402/procurement/rank", async (req, res) => {
    try {
        const intent = String(req.body?.intent || "unlabeled-intent");
        const candidates = sanitizeProcurementCandidates(req.body?.candidates);
        const policy = mergeProcurementPolicies(req.body?.policy);
        if (candidates.length === 0) {
            return res.status(400).json({ success: false, error: "candidates[] is required" });
        }

        const ranking = rankProcurementCandidates({ intent, candidates, policy });
        return res.json({ success: true, ...ranking });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/x402/procurement/execute", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const intent = String(req.body?.intent || "unlabeled-intent");
        const candidates = sanitizeProcurementCandidates(req.body?.candidates);
        const policy = mergeProcurementPolicies(req.body?.policy);
        if (candidates.length === 0) {
            return res.status(400).json({ success: false, error: "candidates[] is required" });
        }

        const result = await executeProcurementIntent({ intent, candidates, policy });
        return res.json({ success: true, ...result });
    } catch (error) {
        return res.status(502).json({ success: false, error: (error as Error).message });
    }
});

app.get("/x402/procurement/state", async (_req, res) => {
    await ensureProcurementStateReady();
    res.json({ success: true, ...getProcurementState() });
});

// Agent Treasury OS (Pinion-powered send/trade/fund)
app.get("/treasury/runtime", (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    return res.json({
        success: true,
        status: getPinionRuntimeStatus(),
    });
});

app.post("/treasury/api-key", (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const action = String(req.body?.action || "").toLowerCase();
        if (action === "set") {
            const apiKey = String(req.body?.apiKey || "").trim();
            if (!apiKey) {
                return res.status(400).json({ success: false, error: "apiKey is required for action=set" });
            }
            const result = setPinionApiKey(apiKey);
            return res.json({ success: true, ...result, status: getPinionApiKeyStatus() });
        }

        if (action === "clear") {
            clearPinionApiKey();
            return res.json({ success: true, status: getPinionApiKeyStatus() });
        }

        return res.json({ success: true, status: getPinionApiKeyStatus() });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/treasury/unlimited/purchase", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const result = await purchasePinionUnlimited();
        return res.json({ success: true, data: result.data, paidAmount: result.paidAmount, status: getPinionApiKeyStatus() });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/treasury/unlimited/verify", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const apiKey = String(req.body?.apiKey || "").trim();
        if (!apiKey) {
            return res.status(400).json({ success: false, error: "apiKey is required" });
        }

        const result = await verifyPinionUnlimitedKey(apiKey);
        return res.json({ success: true, result });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.get("/treasury/balance/:address", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const result = await getPinionBalance(req.params.address);
        return res.json({ success: true, data: result.data, paidAmount: result.paidAmount });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.get("/treasury/tx/:hash", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const result = await getPinionTx(req.params.hash);
        return res.json({ success: true, data: result.data, paidAmount: result.paidAmount });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.get("/treasury/price/:token", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const result = await getPinionPrice(req.params.token);
        return res.json({ success: true, data: result.data, paidAmount: result.paidAmount });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/treasury/wallet/generate", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const result = await generatePinionWallet();
        return res.json({ success: true, data: result.data, paidAmount: result.paidAmount });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/treasury/chat", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const message = String(req.body?.message || "").trim();
        const history = Array.isArray(req.body?.history) ? req.body.history : [];
        if (!message) {
            return res.status(400).json({ success: false, error: "message is required" });
        }

        const result = await askPinionChat(message, history);
        return res.json({ success: true, data: result.data, paidAmount: result.paidAmount });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/treasury/broadcast", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const tx = req.body?.tx as { to?: string; data?: string; value?: string; gasLimit?: string } | undefined;
        if (!tx || typeof tx !== "object" || typeof tx.to !== "string" || !tx.to) {
            return res.status(400).json({ success: false, error: "tx object is required" });
        }

        const result = await broadcastWithPinion({
            to: tx.to,
            data: tx.data || "0x",
            value: tx.value || "0",
            chainId: Number(config.chain.id),
        });
        return res.json({ success: true, data: result.data, paidAmount: result.paidAmount });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.get("/treasury/fund/:address", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const result = await getPinionFunding(req.params.address);
        return res.json({ success: true, data: result.data, paidAmount: result.paidAmount });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/treasury/send", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const to = String(req.body?.to || "");
        const amount = String(req.body?.amount || "");
        const token = String(req.body?.token || "USDC").toUpperCase();
        const execute = Boolean(req.body?.execute);

        if (!to || !amount || !["ETH", "USDC"].includes(token)) {
            return res.status(400).json({
                success: false,
                error: "Invalid payload. Required: { to, amount, token: 'ETH'|'USDC', execute? }",
            });
        }

        const result = await sendWithPinion({
            to,
            amount,
            token: token as "ETH" | "USDC",
            execute,
        });
        return res.json({ success: true, ...result });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/treasury/trade", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const src = String(req.body?.src || "");
        const dst = String(req.body?.dst || "");
        const amount = String(req.body?.amount || "");
        const slippage = req.body?.slippage === undefined ? undefined : Number(req.body?.slippage);
        const execute = Boolean(req.body?.execute);

        if (!src || !dst || !amount) {
            return res.status(400).json({
                success: false,
                error: "Invalid payload. Required: { src, dst, amount, slippage?, execute? }",
            });
        }

        const result = await tradeWithPinion({
            src,
            dst,
            amount,
            slippage: Number.isFinite(slippage) ? slippage : undefined,
            execute,
        });
        return res.json({ success: true, ...result });
    } catch (error) {
        return res.status(500).json({ success: false, error: (error as Error).message });
    }
});

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
        const { query, txHash, userAddress, imageData, conversationHistory, sessionId, budgetUsd } = req.body;
        const budgetLimitUsd = Number(
            budgetUsd ??
            req.query.budgetUsd ??
            req.query.budget ??
            process.env.X402_DEFAULT_BUDGET_USD ??
            1
        );

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
                let trace: any = null;
                let x402SpendUsd = 0;

                try {
                    const traceId = `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    const result = await generateResponse(
                        query || '',
                        imageData,
                        conversationHistory,
                        {
                            sessionId,
                            budgetUsd: budgetLimitUsd,
                            traceId,
                        }
                    );
                    aiResponse = result.response;
                    agentsUsed = result.agentsUsed;
                    trace = result.trace;
                    x402SpendUsd = result.totalSpendUsd;

                    if (trace) {
                        x402TraceById.set(trace.traceId, trace);
                        if (trace.sessionId) {
                            x402TraceBySession.set(trace.sessionId, trace);
                        }

                        await saveX402Trace({
                            traceId: trace.traceId,
                            sessionId: trace.sessionId,
                            userPrompt: trace.userPrompt,
                            limitUsd: trace.budget.limitUsd,
                            spentUsdStart: trace.budget.spentUsdStart,
                            spentUsdEnd: trace.budget.spentUsdEnd,
                            remainingUsdEnd: trace.budget.remainingUsdEnd,
                            createdAt: trace.createdAt,
                            steps: trace.steps,
                        });
                    }

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
                    traceId: trace?.traceId,
                    totalSpendUsd: x402SpendUsd,
                    trace: trace ? {
                        traceId: trace.traceId,
                        totalSpendUsd: x402SpendUsd,
                        budget: trace.budget,
                        steps: trace.steps,
                    } : null,
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

        const sellerMap = getSellerAddressMap();

        providers.push({
            agentId: "oracle",
            name: "Price Oracle Agent",
            wallet: sellerMap.oracle,
            price: "0.01",
            active: true,
            serviceType: "oracle",
            category: "DeFi",
            description: "Real-time cryptocurrency prices from CoinGecko. Supports BTC, ETH, SOL, and 100+ tokens.",
            pricingModel: "per-call-fixed",
            paidTools: true,
        });

        providers.push({
            agentId: "scout",
            name: "Chain Scout",
            wallet: sellerMap.scout,
            price: "0.01",
            active: true,
            serviceType: "analytics",
            category: "Analytics",
            description: "Wallet analytics, protocol TVL, DEX volume, bridges, and exploit tracking.",
            pricingModel: "per-call-fixed",
            paidTools: true,
        });

        providers.push({
            agentId: "news",
            name: "News Scout",
            wallet: sellerMap.news,
            price: "0.01",
            active: true,
            serviceType: "news",
            category: "Analytics",
            description: "Real-time crypto news aggregator, sentiment analysis, and trending topics.",
            pricingModel: "per-call-fixed",
            paidTools: true,
        });

        providers.push({
            agentId: "yield",
            name: "Yield Optimizer",
            wallet: sellerMap.yield,
            price: "0.01",
            active: true,
            serviceType: "defi",
            category: "DeFi",
            description: "DeFi yield aggregator from Lido, Yearn, Beefy, Curve, Aave, and Pendle. Compares APYs across protocols.",
            pricingModel: "per-call-fixed",
            paidTools: true,
        });

        providers.push({
            agentId: "tokenomics",
            name: "Tokenomics Analyzer",
            wallet: sellerMap.tokenomics,
            price: "0.02",
            active: true,
            serviceType: "research",
            category: "Research",
            description: "Token supply analysis, vesting schedules, unlock events, and inflation rates for ARB, OP, SUI, APT, and more.",
            pricingModel: "per-call-fixed",
            paidTools: true,
        });

        providers.push({
            agentId: "nft",
            name: "NFT Scout",
            wallet: sellerMap.nft,
            price: "0.02",
            active: true,
            serviceType: "nft",
            category: "NFT",
            description: "NFT collection analytics, floor prices, volume trends, and sales history for OpenSea collections.",
            pricingModel: "per-call-fixed",
            paidTools: true,
        });

        providers.push({
            agentId: "perp",
            name: "Universal Perp Stats",
            wallet: sellerMap.perp,
            price: "0.02",
            active: true,
            serviceType: "perp",
            category: "Trading",
            description: "Real-time aggregated funding rates, open interest, and volume from Hyperliquid, dYdX, and 5+ other DEXs.",
            pricingModel: "per-call-fixed",
            paidTools: true,
        });

        const providersWithPolicy = await Promise.all(
            providers.map(async (provider) => {
                const parsedAgentId = parseAgentId(String(provider.agentId));
                if (!parsedAgentId) {
                    return {
                        ...provider,
                        isFrozen: false,
                    };
                }

                const frozen = await isAgentFrozen(parsedAgentId);
                return {
                    ...provider,
                    active: provider.active && !frozen,
                    isFrozen: frozen,
                };
            }),
        );

        // Get per-agent stats from database
        const agentStats = await getAllAgentStats();
        const statsMap = new Map(agentStats.map(s => [s.agentId, s]));

        // Filter by service type if specified
        const filtered = serviceType
            ? providersWithPolicy.filter(p => p.serviceType === serviceType || serviceType === "")
            : providersWithPolicy;

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
    const agentIdParam = req.query.agentId as string | undefined;

    try {
        // If agentId is provided, return stats for that specific agent
        if (agentIdParam) {
            const agentId = parseAgentId(agentIdParam);
            if (!agentId) {
                return res.status(400).json({ error: `Unsupported agentId: ${agentIdParam}` });
            }
            // Use optimized single-agent lookup instead of fetching all agents
            const stats = await getAgentStatsById(agentId);
            const sellerMap = getSellerAddressMap();

            // Get agent x402 payment wallet address for balance lookup (these have the actual funds)
            let walletAddress: string | null = null;
            let agentName: string = agentId;

            switch (agentId) {
                case 'oracle':
                    walletAddress = sellerMap.oracle;
                    agentName = 'Price Oracle Agent';
                    break;
                case 'scout':
                    walletAddress = sellerMap.scout;
                    agentName = 'Chain Scout';
                    break;
                case 'news':
                    walletAddress = sellerMap.news;
                    agentName = 'News Scout';
                    break;
                case 'yield':
                    walletAddress = sellerMap.yield;
                    agentName = 'Yield Optimizer';
                    break;
                case 'tokenomics':
                    walletAddress = sellerMap.tokenomics;
                    agentName = 'Tokenomics Analyzer';
                    break;
                case 'nft':
                    walletAddress = sellerMap.nft;
                    agentName = 'NFT Scout';
                    break;
                case 'perp':
                    walletAddress = sellerMap.perp;
                    agentName = 'Universal Perp Stats';
                    break;
            }

            const frozen = await isAgentFrozen(agentId);

            // Fetch real wallet balance
            let balanceUsd = "0.00";
            if (walletAddress) {
                try {
                    const usdcAddress = config.tokens.usdc;
                    const [usdcRaw, usdcDecimals] = await Promise.all([
                        publicClient.readContract({
                            address: usdcAddress,
                            abi: ERC20_BALANCE_ABI,
                            functionName: "balanceOf",
                            args: [walletAddress as `0x${string}`],
                        }) as Promise<bigint>,
                        publicClient.readContract({
                            address: usdcAddress,
                            abi: ERC20_BALANCE_ABI,
                            functionName: "decimals",
                        }) as Promise<number>,
                    ]);

                    balanceUsd = parseFloat(formatUnits(usdcRaw, Number(usdcDecimals))).toFixed(2);
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
                isFrozen: frozen,
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
    const sessionId = req.query.sessionId as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;

    if (!agentId) {
        return res.status(400).json({ error: "agentId required" });
    }

    try {
        res.set("Cache-Control", "no-store");
        const paidActivity = await getRecentX402Payments(agentId, limit, sessionId);
        const activities = paidActivity.length > 0
            ? paidActivity.map((p) => ({
                id: p.id,
                type: "Query Processed",
                timestamp: p.settledAt,
                action: "received" as const,
                responseTimeMs: p.latencyMs,
                amount: Number(p.amountUsd || 0),
                txHash: p.txHash,
                receiptRef: p.receiptRef,
                endpoint: p.endpoint,
            }))
            : (await getRecentQueries(agentId, limit)).map((q) => ({
                id: q.id,
                type: "Query Processed",
                timestamp: q.createdAt,
                action: "received" as const,
                responseTimeMs: q.responseTimeMs,
                amount: 0.01,
                txHash: q.txHash,
            }));

        res.json({ activities });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// Spend summary + receipts + decision log for demo sessions
app.get("/dashboard/spend", async (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    const agentIdRaw = req.query.agentId as string | undefined;
    const agentId = agentIdRaw ? agentIdRaw.toLowerCase() : undefined;
    const limit = Number(req.query.limit || 50);

    if (!sessionId) {
        return res.status(400).json({ error: "sessionId required" });
    }

    try {
        res.set("Cache-Control", "no-store");
        const localSummary = getSessionSpendSummary(sessionId);
        const dbSummary = await getSessionSpendFromDb(sessionId);
        const trace = x402TraceBySession.get(sessionId);

        const receiptsPoolLimit = agentId ? 100 : limit;
        const receiptsFromMemory = getRecentReceipts(sessionId, receiptsPoolLimit);
        const normalizeReceipts = (input: Array<any>) => input.map((r) => ({
            agentId: r.agentId,
            endpoint: r.endpoint,
            amount: r.amount,
            amountUsd: r.amountUsd,
            payTo: r.payTo,
            txHash: r.txHash || null,
            receiptRef: r.receiptRef || null,
            settlePayer: r.settlePayer || null,
            settleNetwork: r.settleNetwork || null,
            settleTxHash: r.settleTxHash || null,
            facilitatorSettlementId: r.facilitatorSettlementId || null,
            facilitatorPaymentId: r.facilitatorPaymentId || null,
            paymentResponseHeader: r.paymentResponseHeader || null,
            paymentResponseHash: r.paymentResponseHeaderHash || null,
            settleResponse: r.settleResponse || null,
            settleResponseHash: r.settleResponseHash || null,
            settleExtensions: r.settleExtensions || null,
            paymentPayload: r.paymentPayload || null,
            paymentPayloadHash: r.paymentPayloadHash || null,
            settledAt: r.settledAt,
            success: r.success,
            latencyMs: r.latencyMs,
        }));

        const filterByAgent = (rows: Array<any>) => {
            if (!agentId) return rows;
            return rows.filter((r) => String(r.agentId || "").toLowerCase() === agentId);
        };

        const localReceipts = filterByAgent(normalizeReceipts(receiptsFromMemory));
        const dbReceipts = filterByAgent(dbSummary?.receipts || []);
        const receipts = (localReceipts.length > 0 ? localReceipts : dbReceipts).slice(0, limit);

        const traceSteps = Array.isArray(trace?.steps) ? trace.steps : [];
        const decisionLog = agentId
            ? traceSteps.filter((step: any) => inferAgentIdFromTraceStep(step) === agentId)
            : traceSteps;

        const totalSpendFromReceipts = receipts
            .filter((r: any) => r.success)
            .reduce((sum: number, r: any) => sum + Number(r.amountUsd || 0), 0);
        const paidCallsFromReceipts = receipts.filter((r: any) => r.success).length;

        const totalSpendUsd = agentId
            ? Number(totalSpendFromReceipts.toFixed(6))
            : (localSummary.totalSpendUsd > 0 ? localSummary.totalSpendUsd : (dbSummary?.totalSpendUsd || 0));

        const paidCalls = agentId
            ? paidCallsFromReceipts
            : (localSummary.paidCalls > 0 ? localSummary.paidCalls : (dbSummary?.paidCalls || 0));

        return res.json({
            sessionId,
            agentId: agentId || null,
            totalSpendUsd,
            paidCalls,
            budget: trace?.budget || {
                limitUsd: Number(process.env.X402_DEFAULT_BUDGET_USD || 1),
                spentUsdStart: 0,
                spentUsdEnd: totalSpendUsd,
                remainingUsdEnd: Math.max(0, Number(process.env.X402_DEFAULT_BUDGET_USD || 1) - totalSpendUsd),
            },
            receipts,
            decisionLog,
            traceId: trace?.traceId || null,
            updatedAt: localSummary.updatedAt,
        });
    } catch (error) {
        return res.status(500).json({ error: (error as Error).message });
    }
});

// Admin policy endpoints
app.get("/admin/policy", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    try {
        const policies = await getAllAgentPolicies();
        res.json({ success: true, policies });
    } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.get("/admin/policy/:agentId", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const agentId = parseAgentId(req.params.agentId);
    if (!agentId) {
        return res.status(400).json({ success: false, error: `Unsupported agentId: ${req.params.agentId}` });
    }

    try {
        const policy = await getAgentPolicy(agentId);
        res.json({ success: true, policy });
    } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.post("/admin/policy/:agentId/freeze", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const agentId = parseAgentId(req.params.agentId);
    if (!agentId) {
        return res.status(400).json({ success: false, error: `Unsupported agentId: ${req.params.agentId}` });
    }

    if (typeof req.body?.frozen !== 'boolean') {
        return res.status(400).json({ success: false, error: "Body must include boolean 'frozen'" });
    }

    const frozen = req.body.frozen as boolean;
    const updatedBy = (req.body?.updatedBy as string | undefined) || (req.header('x-admin-user') || null);

    try {
        const policy = await setAgentFrozen(agentId, frozen, updatedBy);
        res.json({ success: true, policy });
    } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

app.patch("/admin/policy/:agentId", async (req, res) => {
    if (!isAdminRequestAuthorized(req)) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const agentId = parseAgentId(req.params.agentId);
    if (!agentId) {
        return res.status(400).json({ success: false, error: `Unsupported agentId: ${req.params.agentId}` });
    }

    const patch = req.body || {};
    const updatedBy = (patch.updatedBy as string | undefined) || (req.header('x-admin-user') || null);

    try {
        const policy = await updateAgentPolicy(agentId, {
            frozen: typeof patch.frozen === 'boolean' ? patch.frozen : undefined,
            dailyLimitUsd: typeof patch.dailyLimitUsd === 'number' ? patch.dailyLimitUsd : undefined,
            perCallLimitUsd: typeof patch.perCallLimitUsd === 'number' ? patch.perCallLimitUsd : undefined,
            allowedEndpoints: Array.isArray(patch.allowedEndpoints) ? patch.allowedEndpoints : undefined,
            allowedPayTo: Array.isArray(patch.allowedPayTo) ? patch.allowedPayTo : undefined,
        }, updatedBy);

        res.json({ success: true, policy });
    } catch (error) {
        res.status(500).json({ success: false, error: (error as Error).message });
    }
});

// ============ Chat History Endpoints ============

// Get all chat sessions for a wallet
app.get("/chat/sessions", async (req, res) => {
    if (!getSupabase()) {
        return res.status(503).json({ success: false, error: "Supabase unavailable. Check SUPABASE_URL/SUPABASE_ANON_KEY and restart backend." });
    }

    const walletAddress = req.query.wallet as string;
    if (!walletAddress) {
        return res.status(400).json({ success: false, error: "Wallet address required" });
    }

    const sessions = await getChatSessions(walletAddress);
    res.json({ success: true, sessions });
});

// Create a new chat session
app.post("/chat/sessions", async (req, res) => {
    if (!getSupabase()) {
        return res.status(503).json({ success: false, error: "Supabase unavailable. Check SUPABASE_URL/SUPABASE_ANON_KEY and restart backend." });
    }

    const { walletAddress, title } = req.body;
    if (!walletAddress) {
        return res.status(400).json({ success: false, error: "Wallet address required" });
    }

    const session = await createChatSession(walletAddress, title);
    if (!session) {
        const detail = getLastSupabaseError();
        return res.status(500).json({ success: false, error: detail || "Failed to create session" });
    }

    res.json({ success: true, session });
});

// Delete a chat session
app.delete("/chat/sessions/:sessionId", async (req, res) => {
    if (!getSupabase()) {
        return res.status(503).json({ success: false, error: "Supabase unavailable. Check SUPABASE_URL/SUPABASE_ANON_KEY and restart backend." });
    }

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
    if (!getSupabase()) {
        return res.status(503).json({ success: false, error: "Supabase unavailable. Check SUPABASE_URL/SUPABASE_ANON_KEY and restart backend." });
    }

    const { sessionId } = req.params;
    const messages = await getMessages(sessionId);
    res.json({ success: true, messages });
});

// Save a message to a session
app.post("/chat/sessions/:sessionId/messages", async (req, res) => {
    if (!getSupabase()) {
        return res.status(503).json({ success: false, error: "Supabase unavailable. Check SUPABASE_URL/SUPABASE_ANON_KEY and restart backend." });
    }

    const { sessionId } = req.params;
    const { id, content, is_user, escrow_id, tx_hash, image_preview } = req.body;

    const message = await saveMessage(sessionId, { id, content, is_user, escrow_id, tx_hash, image_preview });
    if (!message) {
        const detail = getLastSupabaseError();
        return res.status(500).json({ success: false, error: detail || "Failed to save message" });
    }

    res.json({ success: true, message });
});

// Clear all messages in a session
app.delete("/chat/sessions/:sessionId/messages", async (req, res) => {
    if (!getSupabase()) {
        return res.status(503).json({ success: false, error: "Supabase unavailable. Check SUPABASE_URL/SUPABASE_ANON_KEY and restart backend." });
    }

    const { sessionId } = req.params;
    const success = await clearMessages(sessionId);
    res.json({ success });
});

// --- Start Server ---

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
    const geminiLabel = GEMINI_API_KEY ? "✅ Gemini" : "❌ Gemini";

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

    // Start x402/CDP initialization after server is already reachable.
    void initializeX402PaymentsBackground();
});

server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Stop the existing process or change PORT.`);
        return;
    }
    console.error('❌ Backend server failed to start:', error.message);
});
