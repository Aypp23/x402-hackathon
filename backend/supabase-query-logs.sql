-- Query Logs table for response time tracking
CREATE TABLE IF NOT EXISTS query_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    response_time_ms INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_query_logs_created ON query_logs(created_at);

-- Enable RLS
ALTER TABLE query_logs ENABLE ROW LEVEL SECURITY;

-- Allow all operations (for dev)
CREATE POLICY "Allow all on query_logs" ON query_logs 
    FOR ALL USING (true) WITH CHECK (true);
