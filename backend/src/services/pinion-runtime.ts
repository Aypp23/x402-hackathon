import { PinionClient, payX402Service } from "pinion-os";
import type {
    PayServiceResult,
    SkillResponse,
    UnsignedTx,
} from "pinion-os";

type Hex = `0x${string}`;

interface RuntimeSpendStatus {
    maxBudget: string;
    spent: string;
    remaining: string;
    callCount: number;
    isLimited: boolean;
}

interface RuntimeSpendState {
    maxAtomic: bigint;
    spentAtomic: bigint;
    calls: number;
    limited: boolean;
}

const runtimeSpend: RuntimeSpendState = {
    maxAtomic: BigInt(0),
    spentAtomic: BigInt(0),
    calls: 0,
    limited: false,
};

let pinionClient: PinionClient | null = null;
let pinionNetwork: "base" | "base-sepolia" = "base-sepolia";
let activeApiKey: string | null = null;

function ensurePinionClient(): PinionClient {
    if (!pinionClient) {
        throw new Error("Pinion runtime not initialized. Call initPinionRuntime first.");
    }
    return pinionClient;
}

function parseAmountToAtomic(usdc: string): bigint {
    const numeric = Number(usdc);
    if (!Number.isFinite(numeric) || numeric < 0) {
        throw new Error("USDC amount must be a non-negative number.");
    }
    return BigInt(Math.floor(numeric * 1e6));
}

export function usdcToAtomicString(usdc: number): string {
    if (!Number.isFinite(usdc) || usdc < 0) {
        return "0";
    }
    return BigInt(Math.ceil(usdc * 1e6)).toString();
}

function atomicToUsdcString(amount: bigint): string {
    return (Number(amount) / 1e6).toFixed(6);
}

export function initPinionRuntime(fallbackPrivateKey?: Hex): {
    address: string;
    network: string;
} {
    if (pinionClient) {
        return {
            address: pinionClient.signer.address,
            network: process.env.PINION_NETWORK || "base-sepolia",
        };
    }

    const privateKey = (
        process.env.PINION_PRIVATE_KEY ||
        fallbackPrivateKey ||
        process.env.PRIVATE_KEY
    ) as Hex | undefined;

    if (!privateKey) {
        throw new Error("Missing PINION_PRIVATE_KEY (or PRIVATE_KEY fallback) for Pinion runtime.");
    }

    pinionNetwork = (process.env.PINION_NETWORK as "base" | "base-sepolia" | undefined) || "base-sepolia";
    pinionClient = new PinionClient({
        privateKey,
        apiUrl: process.env.PINION_API_URL,
        network: pinionNetwork,
        apiKey: process.env.PINION_API_KEY,
    });

    if (process.env.PINION_API_KEY) {
        activeApiKey = process.env.PINION_API_KEY;
        pinionClient.setApiKey(process.env.PINION_API_KEY);
    }

    return {
        address: pinionClient.signer.address,
        network: process.env.PINION_NETWORK || "base-sepolia",
    };
}

export function getPinionAddress(): string | null {
    return pinionClient?.signer.address || null;
}

export function getPinionNetwork(): string {
    return pinionNetwork;
}

export function getPinionRuntimeStatus(): {
    address: string | null;
    network: string;
    spend: RuntimeSpendStatus;
    apiKey: {
        hasApiKey: boolean;
        source: "runtime" | "none";
        maskedKey: string | null;
    };
} {
    return {
        address: getPinionAddress(),
        network: getPinionNetwork(),
        spend: getRuntimeSpendStatus(),
        apiKey: getPinionApiKeyStatus(),
    };
}

export function getPinionApiKeyStatus(): {
    hasApiKey: boolean;
    source: "runtime" | "none";
    maskedKey: string | null;
} {
    const key = activeApiKey;
    return {
        hasApiKey: Boolean(key),
        source: key ? "runtime" : "none",
        maskedKey: key ? `${key.slice(0, 6)}...${key.slice(-4)}` : null,
    };
}

export function setPinionApiKey(apiKey: string): {
    hasApiKey: boolean;
    maskedKey: string | null;
} {
    const client = ensurePinionClient();
    const trimmed = apiKey.trim();
    if (!trimmed) {
        throw new Error("API key cannot be empty.");
    }
    client.setApiKey(trimmed);
    activeApiKey = trimmed;
    return {
        hasApiKey: true,
        maskedKey: `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`,
    };
}

export function clearPinionApiKey(): {
    hasApiKey: boolean;
} {
    const client = ensurePinionClient();
    client.setApiKey("");
    activeApiKey = null;
    return {
        hasApiKey: false,
    };
}

export function setRuntimeSpendLimit(maxUsdc: string): RuntimeSpendStatus {
    runtimeSpend.maxAtomic = parseAmountToAtomic(maxUsdc);
    runtimeSpend.limited = true;
    return getRuntimeSpendStatus();
}

export function clearRuntimeSpendLimit(): RuntimeSpendStatus {
    runtimeSpend.maxAtomic = BigInt(0);
    runtimeSpend.limited = false;
    return getRuntimeSpendStatus();
}

export function resetRuntimeSpendTracking(): RuntimeSpendStatus {
    runtimeSpend.spentAtomic = BigInt(0);
    runtimeSpend.calls = 0;
    return getRuntimeSpendStatus();
}

export function canRuntimeSpend(amountAtomic: string): boolean {
    if (!runtimeSpend.limited) return true;
    const cost = BigInt(amountAtomic || "0");
    return runtimeSpend.spentAtomic + cost <= runtimeSpend.maxAtomic;
}

export function recordRuntimeSpend(amountAtomic: string): RuntimeSpendStatus {
    runtimeSpend.spentAtomic += BigInt(amountAtomic || "0");
    runtimeSpend.calls += 1;
    return getRuntimeSpendStatus();
}

export function getRuntimeSpendStatus(): RuntimeSpendStatus {
    const remaining = runtimeSpend.limited
        ? runtimeSpend.maxAtomic - runtimeSpend.spentAtomic
        : BigInt(0);

    return {
        maxBudget: runtimeSpend.limited ? atomicToUsdcString(runtimeSpend.maxAtomic) : "unlimited",
        spent: atomicToUsdcString(runtimeSpend.spentAtomic),
        remaining: runtimeSpend.limited
            ? atomicToUsdcString(remaining > BigInt(0) ? remaining : BigInt(0))
            : "unlimited",
        callCount: runtimeSpend.calls,
        isLimited: runtimeSpend.limited,
    };
}

export async function payX402ThroughPinion(
    url: string,
    options: {
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
        maxAmountAtomic?: string;
    } = {},
): Promise<PayServiceResult> {
    const client = ensurePinionClient();
    return payX402Service(client.signer, url, {
        method: options.method,
        body: options.body,
        headers: options.headers,
        maxAmount: options.maxAmountAtomic,
    });
}

export async function getPinionFunding(address: string) {
    const client = ensurePinionClient();
    return client.skills.fund(address);
}

export async function getPinionBalance(address: string) {
    const client = ensurePinionClient();
    return client.skills.balance(address);
}

export async function getPinionTx(hash: string) {
    const client = ensurePinionClient();
    return client.skills.tx(hash);
}

export async function getPinionPrice(token: string) {
    const client = ensurePinionClient();
    return client.skills.price(token);
}

export async function generatePinionWallet() {
    const client = ensurePinionClient();
    return client.skills.wallet();
}

export async function askPinionChat(message: string, history: Array<{ role: string; content: string }> = []) {
    const client = ensurePinionClient();
    return client.skills.chat(message, history);
}

export async function purchasePinionUnlimited(): Promise<SkillResponse<{ apiKey?: string }>> {
    const client = ensurePinionClient();
    const purchased = await client.skills.unlimited() as unknown as SkillResponse<{ apiKey?: string }>;
    const apiKey = purchased.data?.apiKey;
    if (typeof apiKey === "string" && apiKey.trim()) {
        setPinionApiKey(apiKey);
    }
    return purchased;
}

export async function verifyPinionUnlimitedKey(apiKey: string): Promise<{ valid: boolean; [key: string]: unknown }> {
    const client = ensurePinionClient();
    return client.skills.unlimitedVerify(apiKey) as unknown as { valid: boolean; [key: string]: unknown };
}

export async function broadcastWithPinion(tx: UnsignedTx): Promise<SkillResponse<Record<string, unknown>>> {
    const client = ensurePinionClient();
    return client.skills.broadcast(tx) as unknown as SkillResponse<Record<string, unknown>>;
}

export async function sendWithPinion(
    params: {
        to: string;
        amount: string;
        token: "ETH" | "USDC";
        execute?: boolean;
    },
): Promise<Record<string, unknown>> {
    const client = ensurePinionClient();
    const draft = await client.skills.send(params.to, params.amount, params.token);

    if (!params.execute || !draft?.data?.tx) {
        return {
            mode: "draft",
            draft,
        };
    }

    const broadcast = await client.skills.broadcast(draft.data.tx as UnsignedTx);
    return {
        mode: "executed",
        draft,
        broadcast,
    };
}

export async function tradeWithPinion(
    params: {
        src: string;
        dst: string;
        amount: string;
        slippage?: number;
        execute?: boolean;
    },
): Promise<Record<string, unknown>> {
    const client = ensurePinionClient();
    const draft = await client.skills.trade(params.src, params.dst, params.amount, params.slippage);

    if (!params.execute || !draft?.data) {
        return {
            mode: "draft",
            draft,
        };
    }

    const broadcasts: Array<{ type: "approve" | "swap"; result: unknown }> = [];

    if (draft.data.approve) {
        const approveResult = await client.skills.broadcast(draft.data.approve as UnsignedTx);
        broadcasts.push({ type: "approve", result: approveResult });
    }

    if (draft.data.swap) {
        const swapResult = await client.skills.broadcast(draft.data.swap as UnsignedTx);
        broadcasts.push({ type: "swap", result: swapResult });
    }

    return {
        mode: "executed",
        draft,
        broadcasts,
    };
}
