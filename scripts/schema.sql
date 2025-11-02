-- scripts/schema.sql
-- Database Schema für BankrollGod Production Backend
-- PostgreSQL Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Bankrolls table
CREATE TABLE IF NOT EXISTS bankrolls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    initial_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    current_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for bankrolls
CREATE INDEX IF NOT EXISTS idx_bankrolls_user_id ON bankrolls(user_id);
CREATE INDEX IF NOT EXISTS idx_bankrolls_created_at ON bankrolls(created_at);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bankroll_id UUID REFERENCES bankrolls(id) ON DELETE SET NULL,
    location VARCHAR(255),
    game_type VARCHAR(100),
    stakes VARCHAR(100),
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    profit_loss DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for sessions
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_bankroll_id ON sessions(bankroll_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_start_time ON sessions(start_time);

-- Games table
CREATE TABLE IF NOT EXISTS games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    buy_in DECIMAL(15,2) NOT NULL DEFAULT 0,
    cash_out DECIMAL(15,2) DEFAULT 0,
    profit_loss DECIMAL(15,2) GENERATED ALWAYS AS (cash_out - buy_in) STORED,
    entries INTEGER DEFAULT 1,
    position INTEGER,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'busted')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for games
CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id);
CREATE INDEX IF NOT EXISTS idx_games_session_id ON games(session_id);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX IF NOT EXISTS idx_games_start_time ON games(start_time);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_bankrolls_updated_at BEFORE UPDATE ON bankrolls FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_games_updated_at BEFORE UPDATE ON games FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create views for common queries
CREATE OR REPLACE VIEW user_stats AS
SELECT 
    u.id,
    u.username,
    u.email,
    COUNT(DISTINCT b.id) as total_bankrolls,
    COUNT(DISTINCT s.id) as total_sessions,
    COUNT(DISTINCT g.id) as total_games,
    COALESCE(SUM(s.profit_loss), 0) as total_session_profit,
    COALESCE(SUM(g.profit_loss), 0) as total_game_profit,
    u.created_at as member_since
FROM users u
LEFT JOIN bankrolls b ON u.id = b.user_id
LEFT JOIN sessions s ON u.id = s.user_id AND s.status = 'completed'
LEFT JOIN games g ON u.id = g.user_id AND g.status IN ('completed', 'busted')
GROUP BY u.id, u.username, u.email, u.created_at;

-- Sample data for testing (optional)
-- Uncomment these lines if you want some test data

/*
-- Test user (password: "testpass123")
INSERT INTO users (id, email, username, password_hash, first_name, last_name) 
VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'test@bankrollgod.com',
    'testuser',
    '$2a$12$LQv3c1yqBw.YNr2A1LzrZu6l/Z4l/XPOdgP3Z8.Zw4QY6Q8Y6Q8Y6Q',
    'Test',
    'User'
) ON CONFLICT (email) DO NOTHING;

-- Test bankroll
INSERT INTO bankrolls (id, user_id, name, initial_amount, current_amount) 
VALUES (
    '550e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440000',
    'Test Bankroll',
    1000.00,
    1000.00
) ON CONFLICT (id) DO NOTHING;
*/

-- Performance optimization
ANALYZE users;
ANALYZE bankrolls;
ANALYZE sessions;
ANALYZE games;