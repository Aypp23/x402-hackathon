import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;
let lastSupabaseError: string | null = null;

function recordSupabaseError(context: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    lastSupabaseError = `${context}: ${message}`;
}

export interface ChatMessage {
    id: string;
    content: string;
    is_user: boolean;
    timestamp: string;
    escrow_id?: string;
    tx_hash?: string;
    image_preview?: string;
}

export interface ChatSession {
    id: string;
    wallet_address: string;
    title: string;
    created_at: string;
    updated_at: string;
}

export function initSupabase() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    if (!url || !key) {
        console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_ANON_KEY');
        recordSupabaseError('init', 'Missing SUPABASE_URL or SUPABASE_ANON_KEY');
        return false;
    }

    supabase = createClient(url, key);
    console.log('[Supabase] Client initialized');
    lastSupabaseError = null;
    return true;
}

export function getSupabase(): SupabaseClient | null {
    return supabase;
}

export function getLastSupabaseError(): string | null {
    return lastSupabaseError;
}

// ============ Chat Sessions ============

export async function createChatSession(walletAddress: string, title: string = 'New Chat'): Promise<ChatSession | null> {
    if (!supabase) {
        recordSupabaseError('createChatSession', 'Supabase not initialized');
        return null;
    }

    const { data, error } = await supabase
        .from('chat_sessions')
        .insert({
            wallet_address: walletAddress.toLowerCase(),
            title,
        })
        .select()
        .single();

    if (error) {
        console.error('[Supabase] Failed to create chat session:', error);
        recordSupabaseError('createChatSession', error.message);
        return null;
    }

    lastSupabaseError = null;

    return data;
}

export async function getChatSessions(walletAddress: string): Promise<ChatSession[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('chat_sessions')
        .select('*')
        .eq('wallet_address', walletAddress.toLowerCase())
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('[Supabase] Failed to get chat sessions:', error);
        return [];
    }

    return data || [];
}

export async function deleteChatSession(sessionId: string, walletAddress: string): Promise<boolean> {
    if (!supabase) return false;

    // Delete messages first
    await supabase
        .from('chat_messages')
        .delete()
        .eq('session_id', sessionId);

    // Then delete session
    const { error } = await supabase
        .from('chat_sessions')
        .delete()
        .eq('id', sessionId)
        .eq('wallet_address', walletAddress.toLowerCase());

    if (error) {
        console.error('[Supabase] Failed to delete chat session:', error);
        return false;
    }

    return true;
}

// ============ Chat Messages ============

export async function saveMessage(
    sessionId: string,
    message: Pick<ChatMessage, 'id' | 'content' | 'is_user' | 'escrow_id' | 'tx_hash' | 'image_preview'>
): Promise<ChatMessage | null> {
    if (!supabase) {
        recordSupabaseError('saveMessage', 'Supabase not initialized');
        return null;
    }

    const { data, error } = await supabase
        .from('chat_messages')
        .insert({
            session_id: sessionId,
            message_id: message.id,
            content: message.content,
            is_user: message.is_user,
            escrow_id: message.escrow_id,
            tx_hash: message.tx_hash,
            image_preview: message.image_preview,
        })
        .select()
        .single();

    if (error) {
        console.error('[Supabase] Failed to save message:', error);
        recordSupabaseError('saveMessage', error.message);
        return null;
    }

    lastSupabaseError = null;

    // Update session's updated_at
    await supabase
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', sessionId);

    // Update session title if it's the first user message
    if (message.is_user && message.content) {
        const title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
        await supabase
            .from('chat_sessions')
            .update({ title })
            .eq('id', sessionId)
            .eq('title', 'New Chat');
    }

    return data;
}

export async function getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('[Supabase] Failed to get messages:', error);
        return [];
    }

    return (data || []).map(m => ({
        id: m.message_id,
        content: m.content,
        is_user: m.is_user,
        timestamp: m.created_at,
        escrow_id: m.escrow_id,
        tx_hash: m.tx_hash,
        image_preview: m.image_preview,
    }));
}

export async function clearMessages(sessionId: string): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
        .from('chat_messages')
        .delete()
        .eq('session_id', sessionId);

    if (error) {
        console.error('[Supabase] Failed to clear messages:', error);
        return false;
    }

    return true;
}

// ============ Message Ratings ============

export interface MessageRating {
    message_id: string;
    user_address: string;
    is_positive: boolean;
}

export async function rateMessage(
    messageId: string,
    userAddress: string,
    isPositive: boolean,
    agentId?: string
): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
        .from('message_ratings')
        .upsert({
            message_id: messageId,
            user_address: userAddress.toLowerCase(),
            is_positive: isPositive,
            agent_id: agentId || null,
        }, {
            onConflict: 'message_id,user_address',
        });

    if (error) {
        console.error('[Supabase] Failed to rate message:', error);
        return false;
    }

    return true;
}


export async function getMessageRating(
    messageId: string,
    userAddress: string
): Promise<boolean | null> {
    if (!supabase) return null;

    const { data, error } = await supabase
        .from('message_ratings')
        .select('is_positive')
        .eq('message_id', messageId)
        .eq('user_address', userAddress.toLowerCase())
        .single();

    if (error || !data) {
        return null; // Not rated yet
    }

    return data.is_positive;
}

export async function getAgentRating(): Promise<{ rating: number; totalRatings: number }> {
    if (!supabase) return { rating: 0, totalRatings: 0 };

    const { data, error } = await supabase
        .from('message_ratings')
        .select('is_positive');

    if (error || !data || data.length === 0) {
        return { rating: 0, totalRatings: 0 };
    }

    const positiveCount = data.filter(r => r.is_positive).length;
    const totalRatings = data.length;
    const rating = (positiveCount / totalRatings) * 5;

    return {
        rating: Math.round(rating * 10) / 10, // Round to 1 decimal
        totalRatings
    };
}

// ============ Query Logs (Response Time) ============

export async function logQueryTime(responseTimeMs: number, agentId?: string, txHash?: string): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
        .from('query_logs')
        .insert({
            response_time_ms: responseTimeMs,
            agent_id: agentId || null,
            tx_hash: txHash || null
        });

    if (error) {
        console.error('[Supabase] Failed to log query time:', error);
        return false;
    }

    return true;
}

export async function getAverageResponseTime(agentId?: string): Promise<number> {
    if (!supabase) return 0;

    let query = supabase
        .from('query_logs')
        .select('response_time_ms')
        .order('created_at', { ascending: false })
        .limit(100);

    if (agentId) {
        query = query.eq('agent_id', agentId);
    }

    const { data, error } = await query;

    if (error || !data || data.length === 0) {
        return 0;
    }

    const totalMs = data.reduce((sum, d) => sum + d.response_time_ms, 0);
    return Math.round(totalMs / data.length);
}

export async function getTotalUsageCount(agentId?: string): Promise<number> {
    if (!supabase) return 0;

    let query = supabase
        .from('query_logs')
        .select('*', { count: 'exact', head: true });

    if (agentId) {
        query = query.eq('agent_id', agentId);
    }

    const { count, error } = await query;

    if (error) {
        console.error('[Supabase] Failed to get usage count:', error);
        return 0;
    }

    return count || 0;
}

export interface RecentQuery {
    id: string;
    agentId: string;
    responseTimeMs: number;
    createdAt: string;
    txHash: string | null;
}

export async function getRecentQueries(agentId: string, limit: number = 10): Promise<RecentQuery[]> {
    if (!supabase) return [];

    const { data, error } = await supabase
        .from('query_logs')
        .select('id, agent_id, response_time_ms, created_at, tx_hash')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error || !data) {
        console.error('[Supabase] Failed to get recent queries:', error);
        return [];
    }

    return data.map(q => ({
        id: q.id,
        agentId: q.agent_id,
        responseTimeMs: q.response_time_ms,
        createdAt: q.created_at,
        txHash: q.tx_hash || null
    }));
}

// Get stats for a single agent (optimized - no loop)
export async function getAgentStatsById(agentId: string): Promise<AgentStats | null> {
    const { rating, totalRatings } = await getAgentRatingById(agentId);
    const avgResponseTimeMs = await getAverageResponseTime(agentId);
    const usageCount = await getTotalUsageCount(agentId);

    return {
        agentId,
        rating,
        totalRatings,
        avgResponseTimeMs,
        usageCount
    };
}

// ============ Per-Agent Stats ============

export async function getAgentRatingById(agentId: string): Promise<{ rating: number; totalRatings: number }> {
    if (!supabase) return { rating: 0, totalRatings: 0 };

    const { data, error } = await supabase
        .from('message_ratings')
        .select('is_positive')
        .eq('agent_id', agentId);

    if (error || !data || data.length === 0) {
        return { rating: 0, totalRatings: 0 };
    }

    const positiveCount = data.filter(r => r.is_positive).length;
    const totalRatings = data.length;
    const rating = (positiveCount / totalRatings) * 5;

    return {
        rating: Math.round(rating * 10) / 10,
        totalRatings
    };
}

export interface AgentStats {
    agentId: string;
    rating: number;
    totalRatings: number;
    avgResponseTimeMs: number;
    usageCount: number;
}

export async function getAllAgentStats(): Promise<AgentStats[]> {
    if (!supabase) return [];

    const agents = ['oracle', 'scout', 'news', 'yield', 'tokenomics', 'nft', 'perp'];

    // Fetch all data in just 2 queries instead of 21
    const [queryLogsData, ratingsData] = await Promise.all([
        // Get all query logs grouped by agent_id
        supabase
            .from('query_logs')
            .select('agent_id, response_time_ms')
            .in('agent_id', agents),
        // Get all ratings grouped by agent_id
        supabase
            .from('message_ratings')
            .select('agent_id, is_positive')
            .in('agent_id', agents)
    ]);

    // Process query logs
    const queryLogsByAgent = new Map<string, number[]>();
    if (queryLogsData.data) {
        for (const log of queryLogsData.data) {
            const logs = queryLogsByAgent.get(log.agent_id) || [];
            logs.push(log.response_time_ms);
            queryLogsByAgent.set(log.agent_id, logs);
        }
    }

    // Process ratings
    const ratingsByAgent = new Map<string, { positive: number; total: number }>();
    if (ratingsData.data) {
        for (const rating of ratingsData.data) {
            const current = ratingsByAgent.get(rating.agent_id) || { positive: 0, total: 0 };
            current.total++;
            if (rating.is_positive) current.positive++;
            ratingsByAgent.set(rating.agent_id, current);
        }
    }

    // Build stats for each agent
    return agents.map(agentId => {
        const logs = queryLogsByAgent.get(agentId) || [];
        const ratings = ratingsByAgent.get(agentId) || { positive: 0, total: 0 };

        const avgResponseTimeMs = logs.length > 0
            ? Math.round(logs.reduce((a, b) => a + b, 0) / Math.min(logs.length, 100))
            : 0;
        const rating = ratings.total > 0
            ? Math.round((ratings.positive / ratings.total) * 5 * 10) / 10
            : 0;

        return {
            agentId,
            rating,
            totalRatings: ratings.total,
            avgResponseTimeMs,
            usageCount: logs.length
        };
    });
}

// ============ x402 Payment Logs / Traces ============

export interface X402PaymentLog {
    id: string;
    sessionId?: string;
    traceId?: string;
    agentId: string;
    endpoint: string;
    method: string;
    amount: string;
    amountUsd: number;
    network: string;
    payTo: string;
    receiptRef?: string;
    txHash?: string;
    settlePayer?: string;
    settleNetwork?: string;
    settleTxHash?: string;
    facilitatorSettlementId?: string;
    facilitatorPaymentId?: string;
    paymentResponseHeader?: string;
    paymentResponseHeaderHash?: string;
    settleResponse?: Record<string, unknown>;
    settleResponseHash?: string;
    settleExtensions?: Record<string, unknown>;
    paymentPayload?: Record<string, unknown>;
    paymentPayloadHash?: string;
    settledAt: string;
    latencyMs: number;
    success: boolean;
    error?: string;
}

export interface X402SessionSpendSnapshot {
    sessionId: string;
    totalSpendUsd: number;
    paidCalls: number;
    updatedAt: string;
}

export interface X402TraceStepLog {
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

export interface X402TraceLog {
    traceId: string;
    sessionId?: string;
    userPrompt?: string;
    limitUsd: number;
    spentUsdStart: number;
    spentUsdEnd: number;
    remainingUsdEnd: number;
    createdAt: string;
    steps: X402TraceStepLog[];
}

export async function logX402PaymentRecord(payment: X402PaymentLog): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
        .from('x402_payment_logs')
        .insert({
            id: payment.id,
            session_id: payment.sessionId || null,
            trace_id: payment.traceId || null,
            agent_id: payment.agentId,
            endpoint: payment.endpoint,
            method: payment.method,
            amount: payment.amount,
            amount_usd: payment.amountUsd,
            network: payment.network,
            pay_to: payment.payTo,
            receipt_ref: payment.receiptRef || null,
            tx_hash: payment.txHash || null,
            settle_payer: payment.settlePayer || null,
            settle_network: payment.settleNetwork || null,
            settle_tx_hash: payment.settleTxHash || null,
            facilitator_settlement_id: payment.facilitatorSettlementId || null,
            facilitator_payment_id: payment.facilitatorPaymentId || null,
            payment_response_header: payment.paymentResponseHeader || null,
            payment_response_hash: payment.paymentResponseHeaderHash || null,
            settle_response: payment.settleResponse || null,
            settle_response_hash: payment.settleResponseHash || null,
            settle_extensions: payment.settleExtensions || null,
            payment_payload: payment.paymentPayload || null,
            payment_payload_hash: payment.paymentPayloadHash || null,
            settled_at: payment.settledAt,
            latency_ms: payment.latencyMs,
            success: payment.success,
            error: payment.error || null,
        });

    if (error) {
        console.warn('[Supabase] Failed to log x402 payment:', error.message);
        return false;
    }

    return true;
}

export async function saveSessionSpendSnapshot(snapshot: X402SessionSpendSnapshot): Promise<boolean> {
    if (!supabase) return false;

    const { error } = await supabase
        .from('x402_session_spend')
        .upsert({
            session_id: snapshot.sessionId,
            total_spend_usd: snapshot.totalSpendUsd,
            paid_calls: snapshot.paidCalls,
            updated_at: snapshot.updatedAt,
        }, {
            onConflict: 'session_id',
        });

    if (error) {
        console.warn('[Supabase] Failed to save spend snapshot:', error.message);
        return false;
    }

    return true;
}

export async function saveX402Trace(trace: X402TraceLog): Promise<boolean> {
    if (!supabase) return false;

    const { error: traceError } = await supabase
        .from('x402_traces')
        .upsert({
            trace_id: trace.traceId,
            session_id: trace.sessionId || null,
            user_prompt: trace.userPrompt || null,
            budget_limit_usd: trace.limitUsd,
            spent_usd_start: trace.spentUsdStart,
            spent_usd_end: trace.spentUsdEnd,
            remaining_usd_end: trace.remainingUsdEnd,
            created_at: trace.createdAt,
        }, {
            onConflict: 'trace_id',
        });

    if (traceError) {
        console.warn('[Supabase] Failed to save x402 trace:', traceError.message);
        return false;
    }

    if (trace.steps.length > 0) {
        await supabase
            .from('x402_trace_steps')
            .delete()
            .eq('trace_id', trace.traceId);

        const rows = trace.steps.map(step => ({
            trace_id: trace.traceId,
            step_index: step.stepIndex,
            tool_name: step.toolName,
            endpoint: step.endpoint,
            quoted_price_usd: step.quotedPriceUsd,
            reason: step.reason,
            budget_before_usd: step.budgetBeforeUsd,
            budget_after_usd: step.budgetAfterUsd,
            outcome: step.outcome,
            receipt_ref: step.receiptRef || null,
            latency_ms: step.latencyMs || null,
        }));

        const { error: stepsError } = await supabase
            .from('x402_trace_steps')
            .insert(rows);

        if (stepsError) {
            console.warn('[Supabase] Failed to save x402 trace steps:', stepsError.message);
            return false;
        }
    }

    return true;
}

export async function getSessionSpendFromDb(sessionId: string): Promise<{
    totalSpendUsd: number;
    paidCalls: number;
    receipts: Array<{
        agentId: string;
        endpoint: string;
        amount: string;
        amountUsd: number;
        payTo: string;
        txHash: string | null;
        receiptRef: string | null;
        settlePayer: string | null;
        settleNetwork: string | null;
        settleTxHash: string | null;
        facilitatorSettlementId: string | null;
        facilitatorPaymentId: string | null;
        paymentResponseHeader: string | null;
        paymentResponseHash: string | null;
        settleResponse: Record<string, unknown> | null;
        settleResponseHash: string | null;
        settleExtensions: Record<string, unknown> | null;
        paymentPayload: Record<string, unknown> | null;
        paymentPayloadHash: string | null;
        settledAt: string;
        success: boolean;
    }>;
} | null> {
    if (!supabase) return null;

    const { data: summaryData, error: summaryError } = await supabase
        .from('x402_session_spend')
        .select('total_spend_usd, paid_calls')
        .eq('session_id', sessionId)
        .single();

    if (summaryError && summaryError.code !== 'PGRST116') {
        console.warn('[Supabase] Failed to load session spend summary:', summaryError.message);
    }

    const { data: receiptsData, error: receiptsError } = await supabase
        .from('x402_payment_logs')
        .select('agent_id, endpoint, amount, amount_usd, pay_to, tx_hash, receipt_ref, settle_payer, settle_network, settle_tx_hash, facilitator_settlement_id, facilitator_payment_id, payment_response_header, payment_response_hash, settle_response, settle_response_hash, settle_extensions, payment_payload, payment_payload_hash, settled_at, success')
        .eq('session_id', sessionId)
        .order('settled_at', { ascending: false })
        .limit(100);

    if (receiptsError) {
        console.warn('[Supabase] Failed to load session receipts:', receiptsError.message);
    }

    return {
        totalSpendUsd: summaryData?.total_spend_usd || 0,
        paidCalls: summaryData?.paid_calls || 0,
        receipts: (receiptsData || []).map((row: any) => ({
            agentId: row.agent_id,
            endpoint: row.endpoint,
            amount: row.amount,
            amountUsd: row.amount_usd,
            payTo: row.pay_to,
            txHash: row.tx_hash,
            receiptRef: row.receipt_ref,
            settlePayer: row.settle_payer,
            settleNetwork: row.settle_network,
            settleTxHash: row.settle_tx_hash,
            facilitatorSettlementId: row.facilitator_settlement_id,
            facilitatorPaymentId: row.facilitator_payment_id,
            paymentResponseHeader: row.payment_response_header,
            paymentResponseHash: row.payment_response_hash,
            settleResponse: row.settle_response,
            settleResponseHash: row.settle_response_hash,
            settleExtensions: row.settle_extensions,
            paymentPayload: row.payment_payload,
            paymentPayloadHash: row.payment_payload_hash,
            settledAt: row.settled_at,
            success: row.success,
        })),
    };
}

export interface RecentX402Payment {
    id: string;
    agentId: string;
    endpoint: string;
    amount: string;
    amountUsd: number;
    settledAt: string;
    latencyMs: number;
    txHash: string | null;
    receiptRef: string | null;
}

export async function getRecentX402Payments(
    agentId: string,
    limit: number = 10,
    sessionId?: string,
): Promise<RecentX402Payment[]> {
    if (!supabase) return [];

    let query = supabase
        .from('x402_payment_logs')
        .select('id, agent_id, endpoint, amount, amount_usd, settled_at, latency_ms, tx_hash, receipt_ref')
        .eq('agent_id', agentId)
        .eq('success', true)
        .order('settled_at', { ascending: false })
        .limit(Math.max(1, Math.min(limit, 50)));

    if (sessionId) {
        query = query.eq('session_id', sessionId);
    }

    const { data, error } = await query;

    if (error || !data) {
        console.error('[Supabase] Failed to get recent x402 payments:', error);
        return [];
    }

    return data.map((row: any) => ({
        id: row.id,
        agentId: row.agent_id,
        endpoint: row.endpoint,
        amount: row.amount,
        amountUsd: Number(row.amount_usd || 0),
        settledAt: row.settled_at,
        latencyMs: Number(row.latency_ms || 0),
        txHash: row.tx_hash || null,
        receiptRef: row.receipt_ref || null,
    }));
}
