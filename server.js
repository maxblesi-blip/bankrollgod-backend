const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

console.log('🔍 DEBUG: DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('🔍 DEBUG: DATABASE_URL length:', process.env.DATABASE_URL?.length || 0);
console.log('🔍 DEBUG: NODE_ENV:', process.env.NODE_ENV);

const app = express();
const PORT = process.env.PORT || 3001;

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'bankrollgod-jwt-secret-change-in-production';

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false
});

// Security
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// CORS
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
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

  console.log('🔧 JWT DEBUG - Auth header:', !!authHeader);
  console.log('🔧 JWT DEBUG - Token exists:', !!token);
  console.log('🔧 JWT DEBUG - Token preview:', token?.substring(0, 50));
  console.log('🔧 JWT DEBUG - JWT_SECRET:', JWT_SECRET?.substring(0, 20));

  if (!token) {
    console.log('🔧 JWT DEBUG - No token provided');
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      console.log('🔧 JWT DEBUG - Verification failed:', err.message);
      console.log('🔧 JWT DEBUG - Error type:', err.name);
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }
    console.log('🔧 JWT DEBUG - Verification successful for user:', user.userId);
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

    console.log('🔧 DEBUG - Creating token for user:', user.id, user);
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

// =============================================================================
// USER PROFILE ENDPOINTS
// =============================================================================

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

// PUT - Update user profile
app.put('/api/users/profile', authenticateToken, async (req, res) => {
  try {
    const { username, email, first_name, last_name, nickname } = req.body;
    const userId = req.user.userId;

    if (!username || !email) {
      return res.status(400).json({
        success: false,
        message: 'Username and email are required'
      });
    }

    const existingUser = await pool.query(
      'SELECT id FROM users WHERE (email = $1 OR username = $2) AND id != $3',
      [email, username, userId]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already exists'
      });
    }

    const updatedUser = await pool.query(
      `UPDATE users 
       SET username = $1, nickname = $2, email = $3, first_name = $4, last_name = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, username, email, first_name, last_name, nickname, created_at`,
      [username, nickname, email, first_name, last_name, userId]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const user = updatedUser.rows[0];
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        nickname: user.nickname,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PUT - Change password
app.put('/api/users/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    const userResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    await pool.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedNewPassword, userId]
    );

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// PUT - Update privacy settings
app.put('/api/users/privacy', authenticateToken, async (req, res) => {
  try {
    const { profilePublic, showStats, allowMessages, dataSharing } = req.body;
    const userId = req.user.userId;

    await pool.query(
      `UPDATE users 
       SET profile_public = $1, show_stats = $2, allow_messages = $3, data_sharing = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5`,
      [Boolean(profilePublic), Boolean(showStats), Boolean(allowMessages), Boolean(dataSharing), userId]
    );

    res.json({
      success: true,
      message: 'Privacy settings updated successfully'
    });

  } catch (error) {
    console.error('Privacy update error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// DELETE - Delete user account
app.delete('/api/users/delete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    await pool.query('DELETE FROM games WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM bankrolls WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({
      success: true,
      message: 'Account and all associated data deleted successfully'
    });

  } catch (error) {
    console.error('Account deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// =============================================================================
// HEALTH CHECK ENDPOINTS
// =============================================================================

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
// BANKROLL ENDPOINTS
// =============================================================================

// GET ALL BANKROLLS
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
      data: {
        bankrolls: bankrollsResult.rows
      }
    });

  } catch (error) {
    console.error('Get bankrolls error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bankrolls: ' + error.message
    });
  }
});

// GET SINGLE BANKROLL
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
      data: {
        bankroll: bankrollResult.rows[0]
      }
    });

  } catch (error) {
    console.error('Get bankroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get bankroll: ' + error.message
    });
  }
});

// ✅ CREATE BANKROLL
app.post('/api/bankrolls', authenticateToken, async (req, res) => {
  try {
    const { name, type, starting_amount, current_amount, goal_amount, currency } = req.body;
    const userId = req.user.userId;

    if (!name || !type || !starting_amount) {
      return res.status(400).json({
        success: false,
        error: 'Name, type und starting_amount sind erforderlich'
      });
    }

    const newBankroll = await pool.query(
      `INSERT INTO bankrolls 
        (user_id, name, type, starting_amount, current_amount, goal_amount, currency, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [
        userId,
        name,
        type,
        parseFloat(starting_amount),
        parseFloat(current_amount || starting_amount),
        goal_amount ? parseFloat(goal_amount) : null,
        currency || 'USD'
      ]
    );

    console.log('✅ Bankroll created:', newBankroll.rows[0]);

    res.status(201).json({
      success: true,
      data: {
        bankroll: newBankroll.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ Error creating bankroll:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Erstellen der Bankroll'
    });
  }
});

// ✅ UPDATE BANKROLL
app.put('/api/bankrolls/:id', authenticateToken, async (req, res) => {
  try {
    const bankrollId = req.params.id;
    const userId = req.user.userId;
    const { name, goal_amount, currency } = req.body;

    const checkResult = await pool.query(
      'SELECT * FROM bankrolls WHERE id = $1 AND user_id = $2',
      [bankrollId, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bankroll nicht gefunden'
      });
    }

    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (name) {
      updateFields.push(`name = $${paramCount}`);
      values.push(name);
      paramCount++;
    }

    if (goal_amount !== undefined) {
      updateFields.push(`goal_amount = $${paramCount}`);
      values.push(goal_amount ? parseFloat(goal_amount) : null);
      paramCount++;
    }

    if (currency) {
      updateFields.push(`currency = $${paramCount}`);
      values.push(currency);
      paramCount++;
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(bankrollId, userId);

    const updatedBankroll = await pool.query(
      `UPDATE bankrolls 
       SET ${updateFields.join(', ')}
       WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
       RETURNING *`,
      values
    );

    console.log('✅ Bankroll updated:', updatedBankroll.rows[0]);

    res.json({
      success: true,
      data: {
        bankroll: updatedBankroll.rows[0]
      }
    });

  } catch (error) {
    console.error('❌ Error updating bankroll:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Aktualisieren der Bankroll'
    });
  }
});

// ✅ DELETE BANKROLL
app.delete('/api/bankrolls/:id', authenticateToken, async (req, res) => {
  try {
    const bankrollId = req.params.id;
    const userId = req.user.userId;

    const checkResult = await pool.query(
      'SELECT * FROM bankrolls WHERE id = $1 AND user_id = $2',
      [bankrollId, userId]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bankroll nicht gefunden'
      });
    }

    await pool.query(
      'DELETE FROM bankrolls WHERE id = $1 AND user_id = $2',
      [bankrollId, userId]
    );

    console.log('✅ Bankroll deleted:', bankrollId);

    res.json({
      success: true,
      message: 'Bankroll und alle zugehörigen Daten gelöscht'
    });

  } catch (error) {
    console.error('❌ Error deleting bankroll:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Löschen der Bankroll'
    });
  }
});

// GET BANKROLL SESSIONS
app.get('/api/bankrolls/:id/sessions', authenticateToken, async (req, res) => {
  try {
    const sessionsResult = await pool.query(
      `SELECT * FROM sessions 
       WHERE bankroll_id = $1 
       ORDER BY start_time DESC 
       LIMIT $2`,
      [req.params.id, req.query.limit || 10]
    );

    res.json({
      success: true,
      data: {
        sessions: sessionsResult.rows
      }
    });

  } catch (error) {
    console.error('Get bankroll sessions error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sessions'
    });
  }
});

// =============================================================================
// SESSION ENDPOINTS
// =============================================================================

// GET ACTIVE SESSIONS
app.get('/api/sessions/active', authenticateToken, async (req, res) => {
  try {
    const sessionsResult = await pool.query(
      `SELECT s.*, 
              b.name as bankroll_name,
              b.id as bankroll_id,
              b.currency as currency,
              COUNT(g.id) as total_games
       FROM sessions s
       LEFT JOIN bankrolls b ON s.bankroll_id = b.id
       LEFT JOIN games g ON s.id = g.session_id
       WHERE s.user_id = $1 AND s.status = 'running' 
       GROUP BY s.id, b.id, b.name, b.currency
       ORDER BY s.start_time DESC`,
      [req.user.userId]
    );

    res.json({ 
      success: true, 
      data: {
        sessions: sessionsResult.rows
      }
    });

  } catch (error) {
    console.error('Get active sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get active sessions: ' + error.message
    });
  }
});

// CREATE SESSION
app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { name, bankroll_id, location, session_type, game_type, stakes, notes } = req.body;

    const newSession = await pool.query(
      `INSERT INTO sessions (user_id, name, bankroll_id, location, session_type, game_type, stakes, notes, status, start_time, created_at, updated_at) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) 
       RETURNING *`,
      [req.user.userId, name, bankroll_id, location, session_type, game_type, stakes, notes]
    );

    res.status(201).json({ 
      success: true, 
      data: {
        session: newSession.rows[0]
      }
    });

  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create session: ' + error.message
    });
  }
});

// COMPLETE SESSION
app.post('/api/sessions/:id/complete', authenticateToken, async (req, res) => {
  try {
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
      data: {
        session: updatedSession.rows[0]
      }
    });

  } catch (error) {
    console.error('Complete session error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete session: ' + error.message
    });
  }
});

// GET SESSION GAMES
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
      data: {
        games: gamesResult.rows
      }
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
// GAME ENDPOINTS
// =============================================================================

// CREATE GAME
app.post('/api/games', authenticateToken, async (req, res) => {
  try {
    const { session_id, name, type, buy_in, entries } = req.body;

    const newGame = await pool.query(
      `INSERT INTO games 
        (user_id, session_id, name, type, buy_in, entries, start_time, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [req.user.userId, session_id, name, type, parseFloat(buy_in), parseInt(entries) || 1]
    );

    res.status(201).json({
      success: true,
      data: {
        game: newGame.rows[0]
      }
    });

  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Erstellen des Games'
    });
  }
});

// ✅ COMPLETE GAME WITH WINNINGS
app.post('/api/games/:id/complete', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const gameId = req.params.id;
    const userId = req.user.userId;
    const { winnings, update_bankroll } = req.body;

    await client.query('BEGIN');

    const gameResult = await client.query(`
      SELECT 
        g.*,
        s.id as session_id,
        s.bankroll_id,
        b.current_amount as bankroll_current_amount,
        b.currency as bankroll_currency
      FROM games g
      JOIN sessions s ON g.session_id = s.id
      JOIN bankrolls b ON s.bankroll_id = b.id
      WHERE g.id = $1 AND g.user_id = $2
    `, [gameId, userId]);

    if (gameResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Game nicht gefunden'
      });
    }

    const game = gameResult.rows[0];

    const winningsAmount = parseFloat(winnings || 0);
    const totalBuyIn = parseFloat(game.buy_in) * parseInt(game.entries);
    const netProfit = winningsAmount - totalBuyIn;

    console.log('💰 Game Completion:', {
      gameId,
      gameName: game.name,
      buyIn: game.buy_in,
      entries: game.entries,
      totalBuyIn,
      winnings: winningsAmount,
      netProfit
    });

    const updatedGame = await client.query(`
      UPDATE games 
      SET 
        status = 'completed',
        winnings = $1,
        net_profit = $2,
        cash_out = $1,
        profit_loss = $2,
        end_time = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [winningsAmount, netProfit, gameId]);

    let updatedBankroll = null;

    if (update_bankroll === true) {
      const newBankrollAmount = parseFloat(game.bankroll_current_amount) + netProfit;

      const bankrollUpdate = await client.query(`
        UPDATE bankrolls 
        SET 
          current_amount = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `, [newBankrollAmount, game.bankroll_id]);

      updatedBankroll = bankrollUpdate.rows[0];

      console.log('✅ Bankroll updated:', {
        bankrollId: game.bankroll_id,
        oldAmount: game.bankroll_current_amount,
        netProfit,
        newAmount: newBankrollAmount
      });
    }

    await client.query('COMMIT');

    console.log('✅ Game completed successfully');

    const response = {
      success: true,
      data: {
        game: updatedGame.rows[0]
      }
    };

    if (updatedBankroll) {
      response.data.bankroll = updatedBankroll;
    }

    res.json(response);

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error completing game:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Beenden des Games'
    });
  } finally {
    client.release();
  }
});

// UPDATE GAME ENTRIES
app.patch('/api/games/:id/entries', authenticateToken, async (req, res) => {
  try {
    const gameId = req.params.id;
    const userId = req.user.userId;
    const { entries } = req.body;

    if (!entries || entries < 1) {
      return res.status(400).json({
        success: false,
        error: 'Entries muss mindestens 1 sein'
      });
    }

    const updatedGame = await pool.query(`
      UPDATE games 
      SET entries = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [parseInt(entries), gameId, userId]);

    if (updatedGame.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Game nicht gefunden'
      });
    }

    console.log('✅ Game entries updated:', updatedGame.rows[0]);

    res.json({
      success: true,
      data: {
        game: updatedGame.rows[0]
      }
    });

  } catch (error) {
    console.error('Error updating entries:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Aktualisieren der Entries'
    });
  }
});

// =============================================================================
// DATABASE SETUP & MIGRATION ENDPOINTS
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
        nickname VARCHAR(100),
        profile_public BOOLEAN DEFAULT false,
        show_stats BOOLEAN DEFAULT true,
        allow_messages BOOLEAN DEFAULT true,
        data_sharing BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bankrolls (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(20) DEFAULT 'online',
        initial_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        starting_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        current_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        goal_amount DECIMAL(15,2),
        currency VARCHAR(3) DEFAULT 'USD',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        bankroll_id UUID REFERENCES bankrolls(id) ON DELETE SET NULL,
        name VARCHAR(255),
        location VARCHAR(255),
        session_type VARCHAR(100),
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
        name VARCHAR(255),
        type VARCHAR(50),
        buy_in DECIMAL(15,2) NOT NULL DEFAULT 0,
        winnings DECIMAL(15,2) DEFAULT 0,
        net_profit DECIMAL(15,2) DEFAULT 0,
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
      message: 'Database setup completed!',
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

// ✅ MIGRATION ENDPOINT
app.post('/api/migrate', async (req, res) => {
  const client = await pool.connect();
  
  try {
    console.log('🔧 Starting migration...');
    const results = [];

    await client.query('BEGIN');

    try {
      await client.query(`ALTER TABLE bankrolls ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'online'`);
      results.push('✅ Type column added/verified');
    } catch (error) {
      results.push('⚠️ Type column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE bankrolls ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'USD'`);
      results.push('✅ Currency column added');
    } catch (error) {
      results.push('⚠️ Currency column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE bankrolls ADD COLUMN IF NOT EXISTS starting_amount DECIMAL(15,2) DEFAULT 0`);
      results.push('✅ Starting_amount column added');
    } catch (error) {
      results.push('⚠️ Starting_amount column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE bankrolls ADD COLUMN IF NOT EXISTS goal_amount DECIMAL(15,2)`);
      results.push('✅ Goal_amount column added');
    } catch (error) {
      results.push('⚠️ Goal_amount column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
      results.push('✅ Session name column added');
    } catch (error) {
      results.push('⚠️ Session name column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_type VARCHAR(100)`);
      results.push('✅ Session type column added');
    } catch (error) {
      results.push('⚠️ Session type column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
      results.push('✅ Game name column added');
    } catch (error) {
      results.push('⚠️ Game name column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS type VARCHAR(50)`);
      results.push('✅ Game type column added');
    } catch (error) {
      results.push('⚠️ Game type column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS winnings DECIMAL(15,2) DEFAULT 0`);
      results.push('✅ Winnings column added');
    } catch (error) {
      results.push('⚠️ Winnings column: ' + error.message);
    }

    try {
      await client.query(`ALTER TABLE games ADD COLUMN IF NOT EXISTS net_profit DECIMAL(15,2) DEFAULT 0`);
      results.push('✅ Net_profit column added');
    } catch (error) {
      results.push('⚠️ Net_profit column: ' + error.message);
    }

    await client.query(`UPDATE bankrolls SET starting_amount = initial_amount WHERE starting_amount = 0 OR starting_amount IS NULL`);
    results.push('✅ Updated starting_amount from initial_amount');

    await client.query(`UPDATE bankrolls SET currency = 'USD' WHERE currency IS NULL OR currency = ''`);
    results.push('✅ Set default currency to USD');

    await client.query('COMMIT');

    console.log('✅ Migration completed!');

    res.json({
      success: true,
      message: 'Migration completed successfully',
      results: results
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      hint: 'Check server logs for details'
    });
  } finally {
    client.release();
  }
});

// =============================================================================
// ERROR HANDLERS
// =============================================================================

app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    path: req.originalUrl
  });
});

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
  console.log(`🔗 Health check: /health`);
  console.log(`⚙️  Setup database: /setup-database`);
  console.log(`🔄 Migration: POST /api/migrate`);
  console.log('🚀 ================================');
});

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