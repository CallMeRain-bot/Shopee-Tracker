-- SQL Migration for Order Journey Tracking Feature
-- Run this in your Supabase SQL Editor

-- 1. Create the order_tracking table
CREATE TABLE IF NOT EXISTS order_tracking (
    tracking_number TEXT PRIMARY KEY,
    records JSONB NOT NULL,
    last_fetched TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Create index for performance on cleanup/stale checks
CREATE INDEX IF NOT EXISTS idx_order_tracking_last_fetched ON order_tracking (last_fetched);

-- 3. (Optional) Set up RLS if needed. 
-- For now, we assume service_role or authenticated access via the backend is sufficient.
ALTER TABLE order_tracking ENABLE ROW LEVEL SECURITY;

-- If you want all authenticated users to read (assuming backend handles per-user logic):
CREATE POLICY "Enable read/write for service role" ON order_tracking
    FOR ALL
    USING (true)
    WITH CHECK (true);
