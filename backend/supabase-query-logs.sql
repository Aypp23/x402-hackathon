-- Query Logs table for response time tracking
CREATE TABLE IF NOT EXISTS query_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_time_ms INTEGER NOT NULL,
    agent_id TEXT,
    tx_hash TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- x402 payment-level receipts
CREATE TABLE IF NOT EXISTS x402_payment_logs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    trace_id TEXT,
    agent_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    amount TEXT NOT NULL,
    amount_usd NUMERIC(18,6) NOT NULL,
    network TEXT NOT NULL,
    pay_to TEXT NOT NULL,
    receipt_ref TEXT,
    tx_hash TEXT,
    settle_payer TEXT,
    settle_network TEXT,
    settle_tx_hash TEXT,
    facilitator_settlement_id TEXT,
    facilitator_payment_id TEXT,
    payment_response_header TEXT,
    payment_response_hash TEXT,
    settle_response JSONB,
    settle_response_hash TEXT,
    settle_extensions JSONB,
    payment_payload JSONB,
    payment_payload_hash TEXT,
    settled_at TIMESTAMPTZ NOT NULL,
    latency_ms INTEGER,
    success BOOLEAN NOT NULL DEFAULT true,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill-compatible migrations for existing tables
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS settle_payer TEXT;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS settle_network TEXT;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS settle_tx_hash TEXT;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS facilitator_settlement_id TEXT;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS facilitator_payment_id TEXT;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS payment_response_header TEXT;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS payment_response_hash TEXT;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS settle_response JSONB;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS settle_response_hash TEXT;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS settle_extensions JSONB;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS payment_payload JSONB;
ALTER TABLE x402_payment_logs ADD COLUMN IF NOT EXISTS payment_payload_hash TEXT;

-- Session-level spend snapshot
CREATE TABLE IF NOT EXISTS x402_session_spend (
    session_id TEXT PRIMARY KEY,
    total_spend_usd NUMERIC(18,6) NOT NULL DEFAULT 0,
    paid_calls INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trace header (budget + totals)
CREATE TABLE IF NOT EXISTS x402_traces (
    trace_id TEXT PRIMARY KEY,
    session_id TEXT,
    user_prompt TEXT,
    budget_limit_usd NUMERIC(18,6) NOT NULL,
    spent_usd_start NUMERIC(18,6) NOT NULL,
    spent_usd_end NUMERIC(18,6) NOT NULL,
    remaining_usd_end NUMERIC(18,6) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trace step details (decision log)
CREATE TABLE IF NOT EXISTS x402_trace_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL REFERENCES x402_traces(trace_id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    tool_name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    quoted_price_usd NUMERIC(18,6) NOT NULL,
    reason TEXT NOT NULL,
    budget_before_usd NUMERIC(18,6) NOT NULL,
    budget_after_usd NUMERIC(18,6) NOT NULL,
    outcome TEXT NOT NULL,
    receipt_ref TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(trace_id, step_index)
);

-- Procurement provider state (scoring + circuit breaker)
CREATE TABLE IF NOT EXISTS x402_procurement_provider_stats (
    id TEXT PRIMARY KEY,
    calls INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    failures INTEGER NOT NULL DEFAULT 0,
    avg_latency_ms NUMERIC(12,2) NOT NULL DEFAULT 0,
    schema_passes INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    circuit_open_until TIMESTAMPTZ,
    last_status INTEGER,
    last_error TEXT,
    last_seen_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE x402_procurement_provider_stats ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE x402_procurement_provider_stats ADD COLUMN IF NOT EXISTS circuit_open_until TIMESTAMPTZ;
ALTER TABLE x402_procurement_provider_stats ADD COLUMN IF NOT EXISTS last_status INTEGER;
ALTER TABLE x402_procurement_provider_stats ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE x402_procurement_provider_stats ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE x402_procurement_provider_stats ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Procurement receipt ledger
CREATE TABLE IF NOT EXISTS x402_procurement_receipts (
    id TEXT PRIMARY KEY,
    intent TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    url TEXT NOT NULL,
    method TEXT NOT NULL,
    status INTEGER NOT NULL,
    paid_amount_atomic TEXT NOT NULL,
    response_hash TEXT NOT NULL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT false,
    schema_ok BOOLEAN NOT NULL DEFAULT false,
    score NUMERIC(10,6) NOT NULL DEFAULT 0,
    tx_hash TEXT,
    pay_to TEXT,
    attempt INTEGER NOT NULL DEFAULT 1,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_query_logs_created ON query_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_query_logs_agent ON query_logs(agent_id);

CREATE INDEX IF NOT EXISTS idx_x402_payment_logs_session ON x402_payment_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_x402_payment_logs_trace ON x402_payment_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_x402_payment_logs_agent ON x402_payment_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_x402_payment_logs_settled ON x402_payment_logs(settled_at);

CREATE INDEX IF NOT EXISTS idx_x402_trace_steps_trace ON x402_trace_steps(trace_id);
CREATE INDEX IF NOT EXISTS idx_x402_procurement_stats_updated ON x402_procurement_provider_stats(updated_at);
CREATE INDEX IF NOT EXISTS idx_x402_procurement_receipts_created ON x402_procurement_receipts(created_at);
CREATE INDEX IF NOT EXISTS idx_x402_procurement_receipts_provider ON x402_procurement_receipts(provider_id);

-- Enable RLS
ALTER TABLE query_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_payment_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_session_spend ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_trace_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_procurement_provider_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE x402_procurement_receipts ENABLE ROW LEVEL SECURITY;

-- Allow all operations (for dev)
DROP POLICY IF EXISTS "Allow all on query_logs" ON query_logs;
CREATE POLICY "Allow all on query_logs" ON query_logs 
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on x402_payment_logs" ON x402_payment_logs;
CREATE POLICY "Allow all on x402_payment_logs" ON x402_payment_logs
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on x402_session_spend" ON x402_session_spend;
CREATE POLICY "Allow all on x402_session_spend" ON x402_session_spend
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on x402_traces" ON x402_traces;
CREATE POLICY "Allow all on x402_traces" ON x402_traces
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on x402_trace_steps" ON x402_trace_steps;
CREATE POLICY "Allow all on x402_trace_steps" ON x402_trace_steps
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on x402_procurement_provider_stats" ON x402_procurement_provider_stats;
CREATE POLICY "Allow all on x402_procurement_provider_stats" ON x402_procurement_provider_stats
    FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all on x402_procurement_receipts" ON x402_procurement_receipts;
CREATE POLICY "Allow all on x402_procurement_receipts" ON x402_procurement_receipts
    FOR ALL USING (true) WITH CHECK (true);
