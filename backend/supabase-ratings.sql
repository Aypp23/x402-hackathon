-- Message Ratings table for thumbs up/down
CREATE TABLE IF NOT EXISTS message_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id TEXT NOT NULL,
    user_address TEXT NOT NULL,
    is_positive BOOLEAN NOT NULL, -- true = 👍, false = 👎
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(message_id, user_address) -- one rating per user per message
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_message_ratings_message ON message_ratings(message_id);
CREATE INDEX IF NOT EXISTS idx_message_ratings_user ON message_ratings(user_address);

-- Enable RLS
ALTER TABLE message_ratings ENABLE ROW LEVEL SECURITY;

-- Allow all operations (for dev)
CREATE POLICY "Allow all on message_ratings" ON message_ratings 
    FOR ALL USING (true) WITH CHECK (true);
