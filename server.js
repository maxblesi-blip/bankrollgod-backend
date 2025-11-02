const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS - Allow all origins for now (configure later)
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { success: false, message: 'Too many requests' }
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined'));
}

// Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Poker Tracker Backend API',
    version: '1.0.0',
    status: 'running',
    environment: process.env.NODE_ENV || 'production',
    database: 'PostgreSQL',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'production'
  });
});

// Production Mock APIs (will be replaced with real database)
const mockBankrolls = [
  {
    id: '1',
    name: 'Online NL200',
    type: 'online',
    starting_amount: 2000.00,
    current_amount: 2500.00,
    goal_amount: 5000.00,
    total_sessions: 5,
    total_games: 12,
    win_rate: 75.5,
    roi: 15.3,
    created_at: new Date().toISOString()
  },
  {
    id: '2',
    name: 'Live 2/5',
    type: 'live', 
    starting_amount: 3000.00,
    current_amount: 3800.00,
    goal_amount: 10000.00,
    total_sessions: 8,
    total_games: 8,
    win_rate: 62.5,
    roi: 26.7,
    created_at: new Date().toISOString()
  },
  {
    id: '3',
    name: 'Tournament Bankroll',
    type: 'online',
    starting_amount: 1000.00,
    current_amount: 1350.00,
    goal_amount: 3000.00,
    total_sessions: 12,
    total_games: 45,
    win_rate: 33.3,
    roi: 35.0,
    created_at: new Date().toISOString()
  }
];

let activeSessions = {};
let games = {};

// Bankroll endpoints
app.get('/api/bankrolls', (req, res) => {
  res.json({ success: true, data: mockBankrolls });
});

app.get('/api/bankrolls/:id', (req, res) => {
  const bankroll = mockBankrolls.find(b => b.id === req.params.id);
  if (!bankroll) {
    return res.status(404).json({ success: false, message: 'Bankroll not found' });
  }
  res.json({ success: true, data: bankroll });
});

// Session endpoints
app.get('/api/sessions/active', (req, res) => {
  const sessions = Object.values(activeSessions);
  res.json({ success: true, data: sessions });
});

app.post('/api/sessions', (req, res) => {
  const sessionId = Date.now().toString();
  const session = {
    id: sessionId,
    name: req.body.name,
    bankroll_id: req.body.bankroll_id,
    status: 'running',
    start_time: new Date().toISOString(),
    total_games: 0,
    total_buy_in: 0.00,
    total_winnings: 0.00,
    total_result: 0.00,
    location: req.body.location || 'Online'
  };
  
  activeSessions[sessionId] = session;
  res.status(201).json({ success: true, data: session });
});

app.post('/api/sessions/:id/complete', (req, res) => {
  const session = activeSessions[req.params.id];
  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }
  
  session.status = 'completed';
  session.end_time = new Date().toISOString();
  delete activeSessions[req.params.id];
  
  res.json({ success: true, data: session });
});

app.get('/api/sessions/:id/games', (req, res) => {
  const sessionGames = Object.values(games).filter(g => g.session_id === req.params.id);
  res.json({ success: true, data: sessionGames });
});

// Game endpoints
app.post('/api/games', (req, res) => {
  const gameId = Date.now().toString();
  const game = {
    id: gameId,
    session_id: req.body.session_id,
    name: req.body.name,
    type: req.body.type,
    status: 'running',
    buy_in: parseFloat(req.body.buy_in),
    entries: req.body.entries || 1,
    winnings: 0.00,
    start_time: new Date().toISOString()
  };
  
  games[gameId] = game;
  
  // Update session stats
  if (activeSessions[req.body.session_id]) {
    activeSessions[req.body.session_id].total_games += 1;
    activeSessions[req.body.session_id].total_buy_in += game.buy_in * game.entries;
  }
  
  res.status(201).json({ success: true, data: game });
});

app.put('/api/games/:id/entries', (req, res) => {
  const game = games[req.params.id];
  if (!game) {
    return res.status(404).json({ success: false, message: 'Game not found' });
  }
  
  const oldEntries = game.entries;
  game.entries = req.body.entries;
  
  // Update session buy-in
  if (activeSessions[game.session_id]) {
    const buyInDiff = game.buy_in * (game.entries - oldEntries);
    activeSessions[game.session_id].total_buy_in += buyInDiff;
  }
  
  res.json({ success: true, data: game });
});

app.post('/api/games/:id/complete', (req, res) => {
  const game = games[req.params.id];
  if (!game) {
    return res.status(404).json({ success: false, message: 'Game not found' });
  }
  
  game.status = 'completed';
  game.end_time = new Date().toISOString();
  game.winnings = parseFloat(req.body.winnings || 0);
  
  // Update session stats
  if (activeSessions[game.session_id]) {
    activeSessions[game.session_id].total_winnings += game.winnings;
    activeSessions[game.session_id].total_result = 
      activeSessions[game.session_id].total_winnings - activeSessions[game.session_id].total_buy_in;
  }
  
  res.json({ success: true, data: game });
});

app.post('/api/games/:id/bust', (req, res) => {
  const game = games[req.params.id];
  if (!game) {
    return res.status(404).json({ success: false, message: 'Game not found' });
  }
  
  game.status = 'busted';
  game.end_time = new Date().toISOString();
  game.winnings = 0;
  
  res.json({ success: true, data: game });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// Add this to your server.js temporarily for database setup
// ADD AFTER line ~500 (before app.listen)

// ONE-TIME DATABASE SETUP ENDPOINT
app.get('/setup-database', async (req, res) => {
  try {
    console.log('🔧 Setting up database schema...');
    
    // Enable UUID extension
    await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Bankrolls table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bankrolls (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        initial_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        current_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'EUR',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Sessions table
    await pool.query(`
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
        status VARCHAR(20) DEFAULT 'running',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Games table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
        buy_in DECIMAL(15,2) NOT NULL DEFAULT 0,
        cash_out DECIMAL(15,2) DEFAULT 0,
        profit_loss DECIMAL(15,2) DEFAULT 0,
        entries INTEGER DEFAULT 1,
        position INTEGER,
        start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        end_time TIMESTAMP,
        status VARCHAR(20) DEFAULT 'running',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_bankrolls_user_id ON bankrolls(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_games_user_id ON games(user_id)');
    
    console.log('✅ Database setup completed successfully!');
    
    res.json({
      success: true,
      message: 'Database setup completed successfully!',
      tables_created: ['users', 'bankrolls', 'sessions', 'games'],
      indexes_created: 5
    });
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    res.status(500).json({
      success: false,
      message: 'Database setup failed',
      error: error.message
    });
  }
});

// Remove this endpoint after setup is complete!

app.listen(PORT, () => {
  console.log('🚀 ================================');
  console.log('🎮 Poker Tracker Backend (Production)');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`🗄️ Database: PostgreSQL (Ready)`);
  console.log('🚀 ================================');
});

module.exports = app;