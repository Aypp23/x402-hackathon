import { randomUUID } from 'node:crypto';
import { getSupabase } from './supabase.js';
import {
    type X402AgentId,
    X402_AGENT_DEFINITIONS,
    X402_AGENT_IDS,
    getSellerAddresses,
} from './x402-common.js';

export interface AgentPolicy {
    agentId: X402AgentId;
    frozen: boolean;
    dailyLimitUsd: number;
    perCallLimitUsd: number;
    allowedEndpoints: string[];
    allowedPayTo: string[];
    updatedAt: string;
    updatedBy?: string | null;
}

export interface PaidToolPolicyDecision {
    allowed: boolean;
    reason: string;
    reservationId?: string;
    policy: AgentPolicy;
    spentTodayUsd: number;
    reservedUsd: number;
    remainingDailyUsd: number;
}

interface PolicyReservation {
    id: string;
    agentId: X402AgentId;
    amountUsd: number;
    createdAt: string;
}

interface PolicyDecisionLog {
    traceId?: string;
    sessionId?: string;
    agentId: X402AgentId;
    endpoint: string;
    quotedPriceUsd: number;
    decision: 'allow' | 'deny';
    reason: string;
    spentTodayUsd: number;
    reservedUsd: number;
    remainingDailyUsd: number;
    budgetBeforeUsd?: number;
}

const DEFAULT_DAILY_LIMIT_USD = Number(
    process.env.X402_POLICY_DAILY_LIMIT_USD ?? process.env.X402_DEFAULT_BUDGET_USD ?? 1,
);
const DEFAULT_PER_CALL_LIMIT_USD = Number(process.env.X402_POLICY_PER_CALL_LIMIT_USD ?? 0.05);

const ROUTE_PREFIX_ALLOWLIST: Record<X402AgentId, string[]> = {
    oracle: ['/api/x402/oracle/'],
    scout: [
        '/api/x402/scout/analyze',
        '/api/x402/scout/gas',
        '/api/x402/scout/gas-estimate',
        '/api/x402/scout/dex',
        '/api/x402/scout/protocol',
        '/api/x402/scout/bridges',
        '/api/x402/scout/hacks',
    ],
    news: ['/api/x402/news/'],
    yield: ['/api/x402/yield/'],
    tokenomics: ['/api/x402/tokenomics/'],
    nft: ['/api/x402/scout/nft/', '/api/x402/scout/search'],
    perp: ['/api/x402/perp/'],
};

const policyState = new Map<X402AgentId, AgentPolicy>();
const reservations = new Map<string, PolicyReservation>();
const reservedByAgent = new Map<X402AgentId, number>();
let loadedFromDb = false;
let loadAttempted = false;
let warnedPolicyTable = false;
let warnedPolicyLogTable = false;

function getDefaultAllowedPayTo(agentId: X402AgentId): string[] {
    const sellerMap = getSellerAddresses();
    return [sellerMap[agentId].toLowerCase()];
}

function createDefaultPolicy(agentId: X402AgentId): AgentPolicy {
    const minPrice = X402_AGENT_DEFINITIONS[agentId].priceUsd;
    return {
        agentId,
        frozen: false,
        dailyLimitUsd: Number(DEFAULT_DAILY_LIMIT_USD.toFixed(6)),
        perCallLimitUsd: Number(Math.max(minPrice, DEFAULT_PER_CALL_LIMIT_USD).toFixed(6)),
        allowedEndpoints: ROUTE_PREFIX_ALLOWLIST[agentId],
        allowedPayTo: getDefaultAllowedPayTo(agentId),
        updatedAt: new Date().toISOString(),
        updatedBy: 'system-default',
    };
}

function normalizeEndpoint(endpoint: string): string {
    const trimmed = endpoint.trim();
    if (!trimmed) return '';

    if (trimmed.startsWith('/')) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed);
        return `${parsed.pathname}${parsed.search}`;
    } catch {
        return trimmed;
    }
}

function endpointAllowed(policy: AgentPolicy, endpoint: string): boolean {
    const normalized = normalizeEndpoint(endpoint).toLowerCase();
    const pathOnly = normalized.split('?')[0];
    return policy.allowedEndpoints.some((prefix) => {
        const normalizedPrefix = prefix.toLowerCase();
        return pathOnly.startsWith(normalizedPrefix);
    });
}

function getReserved(agentId: X402AgentId): number {
    return reservedByAgent.get(agentId) || 0;
}

function reserveBudget(agentId: X402AgentId, amountUsd: number): string | undefined {
    if (!(amountUsd > 0)) return undefined;

    const id = randomUUID();
    reservations.set(id, {
        id,
        agentId,
        amountUsd,
        createdAt: new Date().toISOString(),
    });
    reservedByAgent.set(agentId, Number((getReserved(agentId) + amountUsd).toFixed(6)));
    return id;
}

async function loadPoliciesFromDb(): Promise<void> {
    if (loadedFromDb || loadAttempted) return;
    loadAttempted = true;

    const supabase = getSupabase();
    if (!supabase) return;

    const { data, error } = await supabase
        .from('agent_policies')
        .select('agent_id, frozen, daily_limit_usd, per_call_limit_usd, allowed_endpoints, allowed_pay_to, updated_at, updated_by');

    if (error) {
        if (!warnedPolicyTable) {
            warnedPolicyTable = true;
            console.warn('[Policy] agent_policies table unavailable, using in-memory defaults:', error.message);
        }
        return;
    }

    for (const row of data || []) {
        const agentId = row.agent_id as X402AgentId;
        if (!X402_AGENT_IDS.includes(agentId)) continue;

        const current = policyState.get(agentId) || createDefaultPolicy(agentId);
        policyState.set(agentId, {
            ...current,
            frozen: Boolean(row.frozen),
            dailyLimitUsd: Number(row.daily_limit_usd ?? current.dailyLimitUsd),
            perCallLimitUsd: Number(row.per_call_limit_usd ?? current.perCallLimitUsd),
            allowedEndpoints: Array.isArray(row.allowed_endpoints) && row.allowed_endpoints.length > 0
                ? row.allowed_endpoints
                : current.allowedEndpoints,
            allowedPayTo: Array.isArray(row.allowed_pay_to) && row.allowed_pay_to.length > 0
                ? row.allowed_pay_to.map((x: string) => x.toLowerCase())
                : current.allowedPayTo,
            updatedAt: row.updated_at || current.updatedAt,
            updatedBy: row.updated_by || current.updatedBy || null,
        });
    }

    loadedFromDb = true;
}

async function savePolicyToDb(policy: AgentPolicy): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    const { error } = await supabase
        .from('agent_policies')
        .upsert({
            agent_id: policy.agentId,
            frozen: policy.frozen,
            daily_limit_usd: policy.dailyLimitUsd,
            per_call_limit_usd: policy.perCallLimitUsd,
            allowed_endpoints: policy.allowedEndpoints,
            allowed_pay_to: policy.allowedPayTo,
            updated_at: policy.updatedAt,
            updated_by: policy.updatedBy || null,
        }, { onConflict: 'agent_id' });

    if (error && !warnedPolicyTable) {
        warnedPolicyTable = true;
        console.warn('[Policy] Failed to persist policy update:', error.message);
    }
}

async function logPolicyDecision(entry: PolicyDecisionLog): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) return;

    const { error } = await supabase
        .from('policy_decision_logs')
        .insert({
            id: randomUUID(),
            trace_id: entry.traceId || null,
            session_id: entry.sessionId || null,
            agent_id: entry.agentId,
            endpoint: entry.endpoint,
            quoted_price_usd: entry.quotedPriceUsd,
            decision: entry.decision,
            reason: entry.reason,
            spent_today_usd: entry.spentTodayUsd,
            reserved_usd: entry.reservedUsd,
            remaining_daily_usd: entry.remainingDailyUsd,
            budget_before_usd: entry.budgetBeforeUsd ?? null,
            created_at: new Date().toISOString(),
        });

    if (error && !warnedPolicyLogTable) {
        warnedPolicyLogTable = true;
        console.warn('[Policy] policy_decision_logs table unavailable:', error.message);
    }
}

async function getSpentTodayUsd(agentId: X402AgentId): Promise<number> {
    const supabase = getSupabase();
    if (!supabase) return 0;

    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const { data, error } = await supabase
        .from('x402_payment_logs')
        .select('amount_usd')
        .eq('agent_id', agentId)
        .eq('success', true)
        .gte('settled_at', dayStart.toISOString())
        .limit(5000);

    if (error || !data) {
        return 0;
    }

    return Number(
        data.reduce((sum: number, row: any) => sum + Number(row.amount_usd || 0), 0).toFixed(6),
    );
}

export async function ensureAgentPoliciesReady(): Promise<void> {
    for (const agentId of X402_AGENT_IDS) {
        if (!policyState.has(agentId)) {
            policyState.set(agentId, createDefaultPolicy(agentId));
        }
    }

    await loadPoliciesFromDb();
}

export async function getAgentPolicy(agentId: X402AgentId): Promise<AgentPolicy> {
    await ensureAgentPoliciesReady();
    return policyState.get(agentId)!;
}

export async function getAllAgentPolicies(): Promise<AgentPolicy[]> {
    await ensureAgentPoliciesReady();
    return X402_AGENT_IDS.map((agentId) => policyState.get(agentId)!);
}

export async function updateAgentPolicy(
    agentId: X402AgentId,
    patch: Partial<Pick<AgentPolicy, 'frozen' | 'dailyLimitUsd' | 'perCallLimitUsd' | 'allowedEndpoints' | 'allowedPayTo'>>,
    updatedBy?: string | null,
): Promise<AgentPolicy> {
    await ensureAgentPoliciesReady();
    const current = policyState.get(agentId)!;

    const next: AgentPolicy = {
        ...current,
        frozen: patch.frozen ?? current.frozen,
        dailyLimitUsd: patch.dailyLimitUsd !== undefined
            ? Number(Math.max(0, patch.dailyLimitUsd).toFixed(6))
            : current.dailyLimitUsd,
        perCallLimitUsd: patch.perCallLimitUsd !== undefined
            ? Number(Math.max(0, patch.perCallLimitUsd).toFixed(6))
            : current.perCallLimitUsd,
        allowedEndpoints: patch.allowedEndpoints && patch.allowedEndpoints.length > 0
            ? Array.from(new Set(patch.allowedEndpoints.map((s) => normalizeEndpoint(s))))
            : current.allowedEndpoints,
        allowedPayTo: patch.allowedPayTo && patch.allowedPayTo.length > 0
            ? Array.from(new Set(patch.allowedPayTo.map((s) => s.toLowerCase())))
            : current.allowedPayTo,
        updatedAt: new Date().toISOString(),
        updatedBy: updatedBy || current.updatedBy || null,
    };

    policyState.set(agentId, next);
    await savePolicyToDb(next);
    return next;
}

export async function setAgentFrozen(agentId: X402AgentId, frozen: boolean, updatedBy?: string | null): Promise<AgentPolicy> {
    return updateAgentPolicy(agentId, { frozen }, updatedBy);
}

export async function isAgentFrozen(agentId: X402AgentId): Promise<boolean> {
    const policy = await getAgentPolicy(agentId);
    return policy.frozen;
}

export async function checkSellerRoutePolicy(agentId: X402AgentId, endpoint: string): Promise<{ allowed: boolean; reason?: string; statusCode?: number; policy: AgentPolicy }> {
    const policy = await getAgentPolicy(agentId);
    if (policy.frozen) {
        return {
            allowed: false,
            reason: `${agentId} is frozen by policy`,
            statusCode: 423,
            policy,
        };
    }

    if (!endpointAllowed(policy, endpoint)) {
        return {
            allowed: false,
            reason: `Endpoint blocked by allowlist policy: ${normalizeEndpoint(endpoint)}`,
            statusCode: 403,
            policy,
        };
    }

    return { allowed: true, policy };
}

export async function evaluatePaidToolPolicy(input: {
    agentId: X402AgentId;
    endpoint: string;
    quotedPriceUsd: number;
    payTo?: string;
    traceId?: string;
    sessionId?: string;
    budgetBeforeUsd?: number;
}): Promise<PaidToolPolicyDecision> {
    const policy = await getAgentPolicy(input.agentId);
    const normalizedEndpoint = normalizeEndpoint(input.endpoint);
    const quoted = Number(Math.max(0, input.quotedPriceUsd || 0).toFixed(6));

    const spentTodayUsd = await getSpentTodayUsd(input.agentId);
    const reservedUsd = getReserved(input.agentId);

    const deny = async (reason: string): Promise<PaidToolPolicyDecision> => {
        const remaining = Number(Math.max(0, policy.dailyLimitUsd - spentTodayUsd - reservedUsd).toFixed(6));
        await logPolicyDecision({
            traceId: input.traceId,
            sessionId: input.sessionId,
            agentId: input.agentId,
            endpoint: normalizedEndpoint,
            quotedPriceUsd: quoted,
            decision: 'deny',
            reason,
            spentTodayUsd,
            reservedUsd,
            remainingDailyUsd: remaining,
            budgetBeforeUsd: input.budgetBeforeUsd,
        });

        return {
            allowed: false,
            reason,
            policy,
            spentTodayUsd,
            reservedUsd,
            remainingDailyUsd: remaining,
        };
    };

    if (policy.frozen) {
        return deny(`${input.agentId} is frozen by policy`);
    }

    if (!endpointAllowed(policy, normalizedEndpoint)) {
        return deny(`Endpoint blocked by allowlist policy: ${normalizedEndpoint}`);
    }

    if (quoted > policy.perCallLimitUsd) {
        return deny(`Quoted price $${quoted.toFixed(4)} exceeds per-call policy limit $${policy.perCallLimitUsd.toFixed(4)}`);
    }

    if (input.payTo && policy.allowedPayTo.length > 0) {
        const normalizedPayTo = input.payTo.toLowerCase();
        if (!policy.allowedPayTo.includes(normalizedPayTo)) {
            return deny(`payTo ${input.payTo} is not allowlisted for ${input.agentId}`);
        }
    }

    const projected = Number((spentTodayUsd + reservedUsd + quoted).toFixed(6));
    if (projected > policy.dailyLimitUsd) {
        return deny(
            `Daily policy limit reached for ${input.agentId}: projected $${projected.toFixed(4)} exceeds limit $${policy.dailyLimitUsd.toFixed(4)}`,
        );
    }

    const reservationId = reserveBudget(input.agentId, quoted);
    const remainingDailyUsd = Number(Math.max(0, policy.dailyLimitUsd - spentTodayUsd - getReserved(input.agentId)).toFixed(6));

    await logPolicyDecision({
        traceId: input.traceId,
        sessionId: input.sessionId,
        agentId: input.agentId,
        endpoint: normalizedEndpoint,
        quotedPriceUsd: quoted,
        decision: 'allow',
        reason: 'Policy checks passed',
        spentTodayUsd,
        reservedUsd: getReserved(input.agentId),
        remainingDailyUsd,
        budgetBeforeUsd: input.budgetBeforeUsd,
    });

    return {
        allowed: true,
        reason: 'Policy checks passed',
        reservationId,
        policy,
        spentTodayUsd,
        reservedUsd: getReserved(input.agentId),
        remainingDailyUsd,
    };
}

export function releasePolicyReservation(reservationId?: string): void {
    if (!reservationId) return;
    const reservation = reservations.get(reservationId);
    if (!reservation) return;

    reservations.delete(reservationId);
    const next = Number(Math.max(0, getReserved(reservation.agentId) - reservation.amountUsd).toFixed(6));
    reservedByAgent.set(reservation.agentId, next);
}
