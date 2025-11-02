const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'bankrollgod-jwt-secret-change-in-production';

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS
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

// =============================================================================
// AUTH MIDDLEWARE
// =============================================================================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
};

// =============================================================================
// AUTHENTICATION ENDPOINTS
// =============================================================================

// REGISTER
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password, firstName, lastName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username, email, and password are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'User with this email or username already exists'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = await pool.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, username, email, first_name, last_name, created_at`,
      [username, email, hashedPassword, firstName || null, lastName || null]
    );

    const user = newUser.rows[0];

    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username,
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    await pool.query(
      `INSERT INTO bankrolls (user_id, name, initial_amount, current_amount) 
       VALUES ($1, $2, $3, $4)`,
      [user.id, 'Main Bankroll', 0, 0]
    );

    console.log(`✅ New user registered: ${user.username} (${user.email})`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        createdAt: user.created_at
      },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed: ' + error.message
    });
  }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const userResult = await pool.query(
      'SELECT id, username, email, password_hash, first_name, last_name FROM users WHERE email = $1 OR username = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username,
        email: user.email 
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    await pool.query(
      'UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [user.id]
    );

    console.log(`✅ User logged in: ${user.username} (${user.email})`);

    res.json({
      success: true,
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed: ' + error.message
    });
  }
});

// GET CURRENT USER
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT id, username, email, first_name, last_name, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = userResult.rows[0];

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user data'
    });
  }
});

// LOGOUT
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  console.log(`✅ User logged out: ${req.user.username}`);
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

// CREATE DEMO USER
app.get('/api/create-demo-user', async (req, res) => {
  try {
    const existingDemo = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      ['demo@bankrollgod.com']
    );

    if (existingDemo.rows.length > 0) {
      return res.json({
        success: true,
        message: 'Demo user already exists! Use these credentials:',
        credentials: {
          email: 'demo@bankrollgod.com',
          password: 'demo123'
        }
      });
    }

    const hashedPassword = await bcrypt.hash('demo123', 12);
    const demoUser = await pool.query(
      `INSERT INTO users (username, email, password_hash, first_name, last_name) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, username, email`,
      ['demouser', 'demo@bankrollgod.com', hashedPassword, 'Demo', 'User']
    );

    await pool.query(
      `INSERT INTO bankrolls (user_id, name, initial_amount, current_amount) 
       VALUES ($1, $2, $3, $4)`,
      [demoUser.rows[0].id, 'Demo Bankroll', 1000, 1250]
    );

    res.json({
      success: true,
      message: 'Demo user created successfully! Login with:',
      credentials: {
        email: 'demo@bankrollgod.com',
        password: 'demo123'
      }
    });

  } catch (error) {
    console.error('Create demo user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create demo user: ' + error.message
    });
  }
});

// =============================================================================
// HEALTH CHECK ENDPOINTS
// =============================================================================

// Root
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'BankrollGod Backend API',
    version: '1.0.0',
    status: 'running',
    environment: process.env.NODE_ENV || 'production',
    database: 'PostgreSQL',
    authentication: 'JWT',
    timestamp: new Date().toISOString()
  });
});

// Health Check
app.get('/health', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    
    const tableCheck = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'bankrolls', 'sessions', 'games')
    `);
    
    client.release();
    
    const tablesExist = parseInt(tableCheck.rows[0].count) >= 4;
    
    res.status(200).json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'BankrollGod Backend',
      database: {
        connected: true,
        server_time: result.rows[0].current_time,
        tables_ready: tablesExist,
        tables_count: parseInt(tableCheck.rows[0].count)
      },
      server: {
        uptime: Math.floor(process.uptime()),
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        node_version: process.version,
        environment: process.env.NODE_ENV || 'production'
      }
    });
    
  } catch (error) {
    console.error('Health check failed:', error);
    
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      database: {
        connected: false
      }
    });
  }
});

// API Health Check
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as current_time');
    client.release();
    
    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'production',
      database: {
        connected: true,
        server_time: result.rows[0].current_time
      }
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// =============================================================================
// PROTECTED API ENDPOINTS
// =============================================================================

// Bankrolls (Protected)
app.get('/api/bankrolls', authenticateToken, async (req, res) => {
  try {
    const bankrollsResult = await pool.query(
      `SELECT b.*, 
              COUNT(s.id) as total_sessions,
              COALESCE(SUM(s.profit_loss), 0) as total_profit_loss
       FROM bankrolls b
       LEFT JOIN sessions s ON b.id = s.bankroll_id AND s.status = 'completed'
       WHERE b.user_id = $1 
       GROUP BY b.id
       ORDER BY b.created_at DESC`,
      [req.user.userId]
    );

    res.json({ 
      success: true, 
      data: bankrollsResult.rows 
    });

  } catch (error) {
    console.error('Get bankrolls error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bankrolls: ' + error.message
    });
  }
});

app.get('/api/bankrolls/:id', authenticateToken, async (req, res) => {
  try {
    const bankrollResult = await pool.query(
      'SELECT * FROM bankrolls WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );

    if (bankrollResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Bankroll not found' 
      });
    }

    res.json({ 
      success: true, 
      data: bankrollResult.rows[0] 
    });

  } catch (error) {
    console.error('Get bankroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bankroll: ' + error.message
    });
  }
});

// Sessions (Protected)
app.get('/api/sessions/active', authenticateToken, async (req, res) => {
  try {
    const sessionsResult = await pool.query(
      `SELECT s.*, b.name as bankroll_name 
       FROM sessions s
       LEFT JOIN bankrolls b ON s.bankroll_id = b.id
       WHERE s.user_id = $1 AND s.status = $2 
       ORDER BY s.start_time DESC`,
      [req.user.userId, 'running']
    );

    res.json({ 
      success: true, 
      data: sessionsResult.rows 
    });

  } catch (error) {
    console.error('Get active sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get active sessions: ' + error.message
    });
  }
});

app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { bankroll_id, location, game_type, stakes, notes } = req.body;

    const newSession = await pool.query(
      `INSERT INTO sessions (user_id, bankroll_id, location, game_type, stakes, notes) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING *`,
      [req.user.userId, bankroll_id, location, game_type, stakes, notes]
    );

    res.status(201).json({ 
      success: true, 
      data: newSession.rows[0] 
    });

  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create session: ' + error.message
    });
  }
});

app.post('/api/sessions/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { finalData } = req.body;

    const session = await pool.query(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        message: 'Session not found' 
      });
    }

    const updatedSession = await pool.query(
      `UPDATE sessions 
       SET status = 'completed', end_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [req.params.id, req.user.userId]
    );

    res.json({ 
      success: true, 
      data: updatedSession.rows[0] 
    });

  } catch (error) {
    console.error('Complete session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete session: ' + error.message
    });
  }
});

app.get('/api/sessions/:id/games', authenticateToken, async (req, res) => {
  try {
    const gamesResult = await pool.query(
      `SELECT g.* FROM games g
       JOIN sessions s ON g.session_id = s.id
       WHERE s.id = $1 AND s.user_id = $2
       ORDER BY g.start_time DESC`,
      [req.params.id, req.user.userId]
    );

    res.json({ 
      success: true, 
      data: gamesResult.rows 
    });

  } catch (error) {
    console.error('Get session games error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get session games: ' + error.message
    });
  }
});

// =============================================================================
// DATABASE SETUP ENDPOINT
// =============================================================================

app.get('/setup-database', async (req, res) => {
  try {
    console.log('🔧 Setting up database schema...');
    
    await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    
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
    
    console.log('✅ Database setup completed successfully!');
    
    res.json({
      success: true,
      message: 'Database setup completed successfully!',
      tables_created: ['users', 'bankrolls', 'sessions', 'games']
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

// =============================================================================
// ERROR HANDLERS
// =============================================================================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl,
    available_endpoints: [
      'GET /',
      'GET /health',
      'GET /api/health',
      'POST /api/auth/login',
      'POST /api/auth/register',
      'GET /api/auth/me',
      'POST /api/auth/logout',
      'GET /api/create-demo-user',
      'GET /setup-database',
      'GET /api/bankrolls',
      'GET /api/sessions/active'
    ]
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

// =============================================================================
// SERVER START
// =============================================================================

app.listen(PORT, () => {
  console.log('🚀 ================================');
  console.log('🎮 BankrollGod Backend (Production)');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`🗄️ Database: PostgreSQL (Ready)`);
  console.log(`🔐 Authentication: JWT (Ready)`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`⚙️  Setup database: http://localhost:${PORT}/setup-database`);
  console.log(`👤 Create demo user: http://localhost:${PORT}/api/create-demo-user`);
  console.log('🚀 ================================');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down server...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down server...');
  await pool.end();
  process.exit(0);
});

module.exports = app;