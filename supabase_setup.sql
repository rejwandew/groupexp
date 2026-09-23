-- ============================================================
-- EXPENSE & DONATION TRACKER SUPABASE SCHEMA
-- Run this script in your Supabase Project -> SQL Editor
-- ============================================================

-- 1. Create Servers Table
CREATE TABLE IF NOT EXISTS servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create Members Table
CREATE TABLE IF NOT EXISTS members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_member_per_server UNIQUE (server_id, name)
);

-- 3. Create Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    person_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('incoming', 'outgoing')),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    purpose TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- 5. Create permissive policies for public access with anon key
-- (Ideal for shared room/server passcode architecture)
CREATE POLICY "Allow public read access to servers" 
    ON servers FOR SELECT USING (true);

CREATE POLICY "Allow public insert to servers" 
    ON servers FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public read access to members" 
    ON members FOR SELECT USING (true);

CREATE POLICY "Allow public insert to members" 
    ON members FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public delete from members" 
    ON members FOR DELETE USING (true);

CREATE POLICY "Allow public read access to transactions" 
    ON transactions FOR SELECT USING (true);

CREATE POLICY "Allow public insert to transactions" 
    ON transactions FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public delete from transactions" 
    ON transactions FOR DELETE USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_members_server_id ON members(server_id);
CREATE INDEX IF NOT EXISTS idx_transactions_server_id ON transactions(server_id);
