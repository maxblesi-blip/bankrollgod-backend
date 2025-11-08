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

// CREATE BANKROLL
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
      data: newBankroll.rows[0]
    });

  } catch (error) {
    console.error('❌ Error creating bankroll:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Erstellen der Bankroll'
    });
  }
});

// UPDATE BANKROLL
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
      data: updatedBankroll.rows[0]
    });

  } catch (error) {
    console.error('❌ Error updating bankroll:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Aktualisieren der Bankroll'
    });
  }
});

// DELETE BANKROLL
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

// ⚡ GET ALL SESSIONS - FEHLTE KOMPLETT!
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { 
      bankroll_id, 
      status, 
      limit = 20, 
      offset = 0,
      include_games = 'false'
    } = req.query;
    
    let whereClause = 'WHERE s.user_id = $1';
    const params = [req.user.userId];
    let paramCount = 2;
    
    if (bankroll_id) {
      whereClause += ` AND s.bankroll_id = $${paramCount}`;
      params.push(bankroll_id);
      paramCount++;
    }
    
    if (status) {
      whereClause += ` AND s.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    const sessions = await pool.query(
      `SELECT s.*, b.name as bankroll_name, b.type as bankroll_type
       FROM sessions s 
       LEFT JOIN bankrolls b ON s.bankroll_id = b.id
       ${whereClause}
       ORDER BY s.start_time DESC 
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    console.log('✅ Found sessions:', sessions.rows.length);

    res.json({
      success: true,
      data: sessions.rows,
      count: sessions.rows.length
    });

  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch sessions',
      error: error.message
    });
  }
});

// ⚡ GET ACTIVE SESSIONS - MUSS VOR :id Route!
app.get('/api/sessions/active', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 Getting active sessions for user:', req.user.userId);

    const activeSessions = await pool.query(
      `SELECT s.*, b.name as bankroll_name, b.current_amount as bankroll_amount
       FROM sessions s 
       LEFT JOIN bankrolls b ON s.bankroll_id = b.id
       WHERE s.user_id = $1 AND s.status = $2
       ORDER BY s.start_time DESC`,
      [req.user.userId, 'running']
    );

    console.log('✅ Found active sessions:', activeSessions.rows.length);

    res.json({
      success: true,
      data: {
        sessions: activeSessions.rows
      }
    });

  } catch (error) {
    console.error('❌ Error fetching active sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active sessions: ' + error.message
    });
  }
});

// ⚡ GET SINGLE SESSION - FEHLTE AUCH!
app.get('/api/sessions/:id', authenticateToken, async (req, res) => {
  try {
    const session = await pool.query(
      `SELECT s.*, b.name as bankroll_name, b.type as bankroll_type
       FROM sessions s 
       LEFT JOIN bankrolls b ON s.bankroll_id = b.id
       WHERE s.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.userId]
    );

    if (session.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    res.json({
      success: true,
      data: session.rows[0]
    });

  } catch (error) {
    console.error('Error fetching session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session',
      error: error.message
    });
  }
});

// ⚡ GET SESSION GAMES - DAS WICHTIGSTE FEHLTE!
app.get('/api/sessions/:id/games', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 DEBUG: Getting games for session:', req.params.id);
    console.log('🔍 DEBUG: User ID:', req.user?.userId);
    
    const { status } = req.query;
    
    // Verify session exists and user has access
    const session = await pool.query(
      'SELECT * FROM sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    
    if (session.rows.length === 0) {
      console.log('❌ Session not found:', req.params.id);
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    let whereClause = 'WHERE g.session_id = $1';
    const params = [req.params.id];
    
    if (status) {
      whereClause += ' AND g.status = $2';
      params.push(status);
    }
    
    const games = await pool.query(
      `SELECT g.* FROM games g 
       ${whereClause}
       ORDER BY g.start_time DESC`,
      params
    );

    console.log('✅ Found games:', games.rows.length);

    res.json({
      success: true,
      data: games.rows,
      count: games.rows.length
    });

  } catch (error) {
    console.error('❌ Error fetching session games:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session games',
      error: error.message
    });
  }
});

// CREATE NEW SESSION
app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    console.log('🎯 Creating new session for user:', req.user.userId);
    console.log('🎯 Session data received:', req.body);

    const { 
      bankroll_id, 
      name, 
      location, 
      session_type, 
      game_type, 
      stakes,
      notes 
    } = req.body;

    // Validate required fields
    if (!bankroll_id) {
      return res.status(400).json({
        success: false,
        error: 'Bankroll ID is required'
      });
    }

    // Verify bankroll belongs to user
    const bankrollCheck = await pool.query(
      'SELECT id FROM bankrolls WHERE id = $1 AND user_id = $2',
      [bankroll_id, req.user.userId]
    );

    if (bankrollCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Bankroll not found or access denied'
      });
    }

    // Check for existing active sessions for this bankroll
    const activeSessionCheck = await pool.query(
      'SELECT id FROM sessions WHERE bankroll_id = $1 AND status = $2',
      [bankroll_id, 'running']
    );

    if (activeSessionCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'There is already an active session for this bankroll'
      });
    }

    // Create the session
    const newSession = await pool.query(
      `INSERT INTO sessions (
        user_id, bankroll_id, name, location, session_type, 
        game_type, stakes, notes, status, start_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP) 
      RETURNING *`,
      [
        req.user.userId,
        bankroll_id,
        name || 'Untitled Session',
        location || '',
        session_type || 'Cash Game',
        game_type || '',
        stakes || '',
        notes || '',
        'running'
      ]
    );

    const session = newSession.rows[0];

    console.log('✅ Session created successfully:', session.id);

    res.status(201).json({
      success: true,
      data: session
    });

  } catch (error) {
    console.error('❌ Session creation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create session: ' + error.message
    });
  }
});

// GET ACTIVE SESSIONS
app.get('/api/sessions/active', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 Getting active sessions for user:', req.user.userId);

    const activeSessions = await pool.query(
      `SELECT s.*, b.name as bankroll_name, b.current_amount as bankroll_amount
       FROM sessions s 
       LEFT JOIN bankrolls b ON s.bankroll_id = b.id
       WHERE s.user_id = $1 AND s.status = $2
       ORDER BY s.start_time DESC`,
      [req.user.userId, 'running']
    );

    console.log('✅ Found active sessions:', activeSessions.rows.length);

    res.json({
      success: true,
      data: {
        sessions: activeSessions.rows
      }
    });

  } catch (error) {
    console.error('❌ Error fetching active sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch active sessions: ' + error.message
    });
  }
});

// COMPLETE SESSION - WITH STATISTICS CALCULATION ⚡
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

    // ⚡ 1. Get all games for this session
    const gamesResult = await pool.query(
      `SELECT 
        COUNT(*) as total_games,
        COALESCE(SUM(buy_in * entries), 0) as total_invested,
        COALESCE(SUM(winnings), 0) as total_winnings
       FROM games 
       WHERE session_id = $1`,
      [req.params.id]
    );

    const stats = gamesResult.rows[0];
    const totalResult = parseFloat(stats.total_winnings) - parseFloat(stats.total_invested);
    const totalGames = parseInt(stats.total_games);

    // ⚡ 2. Calculate duration in minutes
    const startTime = new Date(session.rows[0].start_time);
    const endTime = new Date();
    const durationMinutes = Math.round((endTime - startTime) / 60000); // ms to minutes

    // ⚡ 3. Update session with all statistics
    const updatedSession = await pool.query(
      `UPDATE sessions 
       SET status = 'completed', 
           end_time = CURRENT_TIMESTAMP,
           duration_minutes = $1,
           total_games = $2,
           total_result = $3,
           total_invested = $4,
           total_winnings = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [
        durationMinutes,
        totalGames,
        totalResult,
        stats.total_invested,
        stats.total_winnings,
        req.params.id,
        req.user.userId
      ]
    );

    console.log(`✅ Session completed with stats:`, {
      duration: durationMinutes,
      games: totalGames,
      result: totalResult
    });

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

// =============================================================================
// GAME ENDPOINTS
// =============================================================================

// CREATE GAME - WITH BANKROLL DEDUCTION
app.post('/api/games', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { session_id, name, type, buy_in, entries } = req.body;

    await client.query('BEGIN');

    // Get session with bankroll info
    const sessionResult = await client.query(`
      SELECT 
        s.id as session_id,
        s.bankroll_id,
        b.current_amount as bankroll_current_amount
      FROM sessions s
      JOIN bankrolls b ON s.bankroll_id = b.id
      WHERE s.id = $1
    `, [session_id]);

    if (sessionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Session nicht gefunden'
      });
    }

    const session = sessionResult.rows[0];
    
    // Create game
    const newGame = await client.query(
      `INSERT INTO games 
        (user_id, session_id, name, type, buy_in, entries, start_time, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, 'running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [req.user.userId, session_id, name, type, parseFloat(buy_in), parseInt(entries) || 1]
    );

    // ⚡ DEDUCT BUY-IN FROM BANKROLL
    const totalBuyIn = parseFloat(buy_in) * parseInt(entries);
    const newBankrollAmount = parseFloat(session.bankroll_current_amount) - totalBuyIn;

    const bankrollUpdate = await client.query(`
      UPDATE bankrolls 
      SET 
        current_amount = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [newBankrollAmount, session.bankroll_id]);

    await client.query('COMMIT');

    console.log('✅ Game created, bankroll deducted:', {
      gameId: newGame.rows[0].id,
      buyIn: totalBuyIn,
      oldAmount: session.bankroll_current_amount,
      newAmount: newBankrollAmount
    });

    res.status(201).json({
      success: true,
      data: {
        game: newGame.rows[0],
        bankroll: bankrollUpdate.rows[0]  // ⚡ Return updated bankroll
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating game:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Erstellen des Games'
    });
  } finally {
    client.release();
  }
});

// COMPLETE GAME WITH WINNINGS - ⚡ ONLY ADD WINNINGS (Buy-Ins already deducted!)
app.post('/api/games/:id/complete', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const gameId = req.params.id;
    const userId = req.user.userId;
    const { winnings } = req.body;

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
    const netProfit = winningsAmount - totalBuyIn;  // For display only

    console.log('💰 Game Completion:', {
      gameId,
      gameName: game.name,
      buyIn: game.buy_in,
      entries: game.entries,
      totalBuyIn,
      winnings: winningsAmount,
      netProfitForDisplay: netProfit,
      bankrollBefore: game.bankroll_current_amount
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

    // ⚡ BANKROLL UPDATE - ONLY ADD WINNINGS (Buy-Ins already deducted at game start!)
    const newBankrollAmount = parseFloat(game.bankroll_current_amount) + winningsAmount;

    const bankrollUpdate = await client.query(`
      UPDATE bankrolls 
      SET 
        current_amount = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [newBankrollAmount, game.bankroll_id]);

    const updatedBankroll = bankrollUpdate.rows[0];

    console.log('✅ Bankroll updated (only winnings added):', {
      bankrollId: game.bankroll_id,
      oldAmount: game.bankroll_current_amount,
      winningsAdded: winningsAmount,
      newAmount: newBankrollAmount,
      netProfitDisplay: netProfit
    });

    await client.query('COMMIT');

    console.log('✅ Game completed successfully');

    // ⚡ RETURN BOTH GAME AND BANKROLL
    res.json({
      success: true,
      data: {
        game: updatedGame.rows[0],
        bankroll: updatedBankroll
      }
    });

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

// UPDATE GAME ENTRIES - WITH BANKROLL ADJUSTMENT
app.patch('/api/games/:id/entries', authenticateToken, async (req, res) => {
  const client = await pool.connect();
  
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

    await client.query('BEGIN');

    // Get current game with bankroll info
    const gameResult = await client.query(`
      SELECT 
        g.*,
        s.bankroll_id,
        b.current_amount as bankroll_current_amount
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
    const oldEntries = parseInt(game.entries);
    const newEntries = parseInt(entries);
    const entriesDiff = newEntries - oldEntries;

    // Update game entries
    const updatedGame = await client.query(`
      UPDATE games 
      SET entries = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [newEntries, gameId, userId]);

    // ⚡ ADJUST BANKROLL (add or subtract buy-in difference)
    const buyInDiff = parseFloat(game.buy_in) * entriesDiff;
    const newBankrollAmount = parseFloat(game.bankroll_current_amount) - buyInDiff;

    const bankrollUpdate = await client.query(`
      UPDATE bankrolls 
      SET 
        current_amount = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [newBankrollAmount, game.bankroll_id]);

    await client.query('COMMIT');

    console.log('✅ Game entries updated, bankroll adjusted:', {
      gameId,
      oldEntries,
      newEntries,
      entriesDiff,
      buyInDiff,
      newAmount: newBankrollAmount
    });

    res.json({
      success: true,
      data: {
        game: updatedGame.rows[0],
        bankroll: bankrollUpdate.rows[0]  // ⚡ Return updated bankroll
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating entries:', error);
    res.status(500).json({
      success: false,
      error: 'Fehler beim Aktualisieren der Entries'
    });
  } finally {
    client.release();
  }
});

// ⚡ GET /api/games (with session filtering)
app.get('/api/games', authenticateToken, async (req, res) => {
  try {
    const { session_id, status, limit = 50, offset = 0 } = req.query;
    
    let whereClause = 'WHERE g.user_id = $1';
    const params = [req.user.userId];
    let paramCount = 2;
    
    if (session_id) {
      whereClause += ` AND g.session_id = $${paramCount}`;
      params.push(session_id);
      paramCount++;
    }
    
    if (status) {
      whereClause += ` AND g.status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }
    
    const games = await pool.query(
      `SELECT g.*, s.name as session_name 
       FROM games g 
       LEFT JOIN sessions s ON g.session_id = s.id
       ${whereClause}
       ORDER BY g.start_time DESC 
       LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    console.log('✅ Found games for session:', games.rows.length);

    res.json({
      success: true,
      data: games.rows,
      count: games.rows.length
    });

  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch games',
      error: error.message
    });
  }
});

// ⚡ ADD: PUT /api/games/:id (general game updates)  
app.put('/api/games/:id', authenticateToken, async (req, res) => {
  // ... der ganze PUT code ...
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

// =============================================================================
// STATISTICS ENDPOINTS - FINAL: Korrekte Feldnamen für ALLE Game-Typen
// Turniere: buy_in, cash_out, profit_loss
// Cashgames: buy_in, cash_out
// =============================================================================

// GET /api/statistics/bankroll/:bankrollId
app.get('/api/statistics/bankroll/:bankrollId', authenticateToken, async (req, res) => {
  try {
    const { bankrollId } = req.params;
    const { filter = 'all' } = req.query; // 'all', 'cashgames', 'tournaments'
    
    console.log(`📊 Calculating statistics for bankroll ${bankrollId}, filter: ${filter}`);
    
    // Verify bankroll exists and belongs to user
    const bankrollResult = await pool.query(
      'SELECT * FROM bankrolls WHERE id = $1 AND user_id = $2',
      [bankrollId, req.user.userId]
    );
    
    if (bankrollResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }
    
    const bankroll = bankrollResult.rows[0];
    
    // Load all sessions for this bankroll
    const sessionsResult = await pool.query(
      `SELECT * FROM sessions 
       WHERE bankroll_id = $1 
       AND status IN ('completed', 'running', 'paused')
       ORDER BY start_time DESC`,
      [bankrollId]
    );
    
    const sessions = sessionsResult.rows;
    console.log(`✅ Found ${sessions.length} sessions for bankroll ${bankrollId}`);
    
    // Load all games for these sessions
    const sessionIds = sessions.map(s => s.id);
    let allGames = [];
    
    if (sessionIds.length > 0) {
      const gamesResult = await pool.query(
        `SELECT * FROM games WHERE session_id = ANY($1::uuid[])`,
        [sessionIds]
      );
      allGames = gamesResult.rows;
    }
    
    console.log(`✅ Extracted ${allGames.length} games from sessions`);
    
    // Calculate statistics based on filter
    let stats;
    if (filter === 'cashgames') {
      stats = calculateCashgameStatsFromGames(sessions, allGames);
    } else if (filter === 'tournaments') {
      stats = calculateTournamentStatsFromGames(sessions, allGames);
    } else {
      stats = calculateAllStatsFromGames(sessions, allGames);
    }
    
    res.json({
      success: true,
      data: {
        bankroll: {
          id: bankroll.id,
          name: bankroll.name,
          type: bankroll.type,
          currency: bankroll.currency,
          current_amount: bankroll.current_amount
        },
        filter,
        statistics: stats
      }
    });
    
  } catch (error) {
    console.error('❌ Error calculating statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate statistics',
      error: error.message
    });
  }
});

// GET /api/statistics/overview
app.get('/api/statistics/overview', authenticateToken, async (req, res) => {
  try {
    const bankrollsResult = await pool.query(
      'SELECT * FROM bankrolls WHERE user_id = $1',
      [req.user.userId]
    );
    
    const bankrolls = bankrollsResult.rows;
    
    const overviewStats = {
      totalBankrolls: bankrolls.length,
      totalValue: 0,
      totalProfit: 0,
      totalSessions: 0
    };
    
    for (const bankroll of bankrolls) {
      overviewStats.totalValue += parseFloat(bankroll.current_amount || 0);
      overviewStats.totalProfit += parseFloat(bankroll.total_winnings || 0);
      overviewStats.totalSessions += parseInt(bankroll.total_sessions || 0);
    }
    
    res.json({
      success: true,
      data: overviewStats
    });
    
  } catch (error) {
    console.error('Error calculating overview statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate overview',
      error: error.message
    });
  }
});

// =============================================================================
// STATISTICS HELPER FUNCTIONS - FINALE VERSION
// =============================================================================

function calculateAllStatsFromGames(sessions, games) {
  if (sessions.length === 0) {
    return {
      totalProfit: 0,
      avgProfitPerHour: 0,
      avgProfitPerSession: 0,
      totalPlaytime: 0,
      totalROI: 0,
      totalCosts: 0,
      totalSessions: 0
    };
  }
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalPlaytime = 0;
  
  // Berechne aus Sessions
  sessions.forEach(session => {
    totalProfit += parseFloat(session.total_result || 0);
    totalPlaytime += parseFloat(session.duration_minutes || 0);
  });
  
  // Berechne Buy-Ins aus GAMES
  games.forEach(game => {
    const buyIn = parseFloat(game.buy_in || 0);
    totalBuyIns += buyIn;
  });
  
  console.log(`💰 Total Buy-Ins from ${games.length} games: ${totalBuyIns}`);
  
  const avgProfitPerHour = totalPlaytime > 0 ? (totalProfit / (totalPlaytime / 60)) : 0;
  const avgProfitPerSession = sessions.length > 0 ? totalProfit / sessions.length : 0;
  const totalROI = totalBuyIns > 0 ? (totalProfit / totalBuyIns) * 100 : 0;
  
  return {
    totalProfit,
    avgProfitPerHour,
    avgProfitPerSession,
    totalPlaytime,
    totalROI,
    totalCosts: totalBuyIns,
    totalSessions: sessions.length
  };
}

function calculateCashgameStatsFromGames(sessions, games) {
  const cashgames = games.filter(g => g.type === 'cashgame');
  
  if (cashgames.length === 0) {
    return {
      totalProfit: 0,
      totalSessions: 0,
      totalPlaytime: 0,
      avgProfitPerHour: 0,
      avgProfitPerSession: 0,
      totalROI: 0,
      totalBuyIns: 0
    };
  }
  
  // Sessions die Cashgames enthalten
  const cashgameSessionIds = new Set(cashgames.map(g => g.session_id));
  const cashgameSessions = sessions.filter(s => cashgameSessionIds.has(s.id));
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalPlaytime = 0;
  
  // Profit und Zeit aus Sessions
  cashgameSessions.forEach(session => {
    totalProfit += parseFloat(session.total_result || 0);
    totalPlaytime += parseFloat(session.duration_minutes || 0);
  });
  
  // Buy-Ins aus Cashgames
  cashgames.forEach(game => {
    const buyIn = parseFloat(game.buy_in || 0);
    totalBuyIns += buyIn;
  });
  
  console.log(`💰 Cashgame Buy-Ins from ${cashgames.length} games: ${totalBuyIns}`);
  
  const avgProfitPerHour = totalPlaytime > 0 ? (totalProfit / (totalPlaytime / 60)) : 0;
  const avgProfitPerSession = cashgameSessions.length > 0 ? totalProfit / cashgameSessions.length : 0;
  const totalROI = totalBuyIns > 0 ? (totalProfit / totalBuyIns) * 100 : 0;
  
  return {
    totalProfit,
    totalSessions: cashgameSessions.length,
    totalPlaytime,
    avgProfitPerHour,
    avgProfitPerSession,
    totalROI,
    totalBuyIns
  };
}

function calculateTournamentStatsFromGames(sessions, games) {
  const tournaments = games.filter(g => ['tournament', 'sng', 'mtt'].includes(g.type));
  
  console.log(`🔍 TOURNAMENT DEBUG: Found ${tournaments.length} tournaments from ${games.length} total games`);
  
  if (tournaments.length === 0) {
    console.log(`⚠️ No tournaments found, returning zeros`);
    return {
      totalProfit: 0,
      totalTournaments: 0,
      totalEntries: 0,
      totalPlaytime: 0,
      itmRatio: 0,
      totalROI: 0,
      avgBuyIn: 0,
      totalBuyIns: 0
    };
  }
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalEntries = 0;
  let totalPlaytime = 0;
  let itmCount = 0;
  
  tournaments.forEach((t, index) => {
    const buyIn = parseFloat(t.buy_in || 0);
    const profitLoss = parseFloat(t.profit_loss || t.net_profit || 0);
    
    console.log(`  🎰 Tournament ${index + 1}/${tournaments.length}:`);
    console.log(`     - Name: ${t.name || 'N/A'}`);
    console.log(`     - buy_in field: ${t.buy_in} → parsed: ${buyIn}`);
    console.log(`     - profit_loss field: ${t.profit_loss} → parsed: ${profitLoss}`);
    console.log(`     - cash_out: ${t.cash_out}`);
    
    totalProfit += profitLoss;
    totalBuyIns += buyIn;
    totalEntries += parseInt(t.entries || 1);
    totalPlaytime += parseFloat(t.duration_minutes || 0);
    
    // ITM = In The Money (Gewinn gemacht)
    if (t.itm === true || profitLoss > 0) {
      itmCount++;
    }
  });
  
  console.log(`💰 Tournament FINAL stats from ${tournaments.length} tournaments:`);
  console.log(`   - Total Buy-Ins: ${totalBuyIns}`);
  console.log(`   - Total Profit: ${totalProfit}`);
  console.log(`   - ITM Count: ${itmCount}`);
  
  const avgBuyIn = tournaments.length > 0 ? totalBuyIns / tournaments.length : 0;
  const itmRatio = tournaments.length > 0 ? (itmCount / tournaments.length) * 100 : 0;
  const totalROI = totalBuyIns > 0 ? (totalProfit / totalBuyIns) * 100 : 0;
  
  console.log(`   - AVG Buy-In: ${avgBuyIn}`);
  console.log(`   - ITM Ratio: ${itmRatio}%`);
  console.log(`   - Total ROI: ${totalROI}%`);
  
  return {
    totalProfit,
    totalTournaments: tournaments.length,
    totalEntries,
    totalPlaytime,
    itmRatio,
    totalROI,
    avgBuyIn,
    totalBuyIns
  };
}

// =============================================================================
// STATISTICS HELPER FUNCTIONS - RICHTIGE FELDNAMEN
// =============================================================================

function calculateAllStatsFromGames(sessions, games) {
  if (sessions.length === 0) {
    return {
      totalProfit: 0,
      avgProfitPerHour: 0,
      avgProfitPerSession: 0,
      totalPlaytime: 0,
      totalROI: 0,
      totalCosts: 0,
      totalSessions: 0
    };
  }
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalPlaytime = 0;
  
  // Berechne aus Sessions
  sessions.forEach(session => {
    totalProfit += parseFloat(session.total_result || 0);
    totalPlaytime += parseFloat(session.duration_minutes || 0);
  });
  
  // Berechne Buy-Ins aus GAMES mit RICHTIGEN Feldnamen
  games.forEach(game => {
    // Für Cashgames: buy_in
    // Für Turniere: buy_in oder prize_money - cash_out (je nach Typ)
    const buyIn = parseFloat(game.buy_in || 0);
    totalBuyIns += buyIn;
  });
  
  console.log(`💰 Total Buy-Ins from ${games.length} games: ${totalBuyIns}`);
  
  const avgProfitPerHour = totalPlaytime > 0 ? (totalProfit / (totalPlaytime / 60)) : 0;
  const avgProfitPerSession = sessions.length > 0 ? totalProfit / sessions.length : 0;
  const totalROI = totalBuyIns > 0 ? (totalProfit / totalBuyIns) * 100 : 0;
  
  return {
    totalProfit,
    avgProfitPerHour,
    avgProfitPerSession,
    totalPlaytime,
    totalROI,
    totalCosts: totalBuyIns,
    totalSessions: sessions.length
  };
}

function calculateCashgameStatsFromGames(sessions, games) {
  const cashgames = games.filter(g => g.type === 'cashgame');
  
  if (cashgames.length === 0) {
    return {
      totalProfit: 0,
      totalSessions: 0,
      totalPlaytime: 0,
      avgProfitPerHour: 0,
      avgProfitPerSession: 0,
      totalROI: 0,
      totalBuyIns: 0
    };
  }
  
  // Sessions die Cashgames enthalten
  const cashgameSessionIds = new Set(cashgames.map(g => g.session_id));
  const cashgameSessions = sessions.filter(s => cashgameSessionIds.has(s.id));
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalPlaytime = 0;
  
  // Profit und Zeit aus Sessions
  cashgameSessions.forEach(session => {
    totalProfit += parseFloat(session.total_result || 0);
    totalPlaytime += parseFloat(session.duration_minutes || 0);
  });
  
  // Buy-Ins aus Cashgames (buy_in Feld)
  cashgames.forEach(game => {
    const buyIn = parseFloat(game.buy_in || 0);
    totalBuyIns += buyIn;
  });
  
  console.log(`💰 Cashgame Buy-Ins from ${cashgames.length} games: ${totalBuyIns}`);
  
  const avgProfitPerHour = totalPlaytime > 0 ? (totalProfit / (totalPlaytime / 60)) : 0;
  const avgProfitPerSession = cashgameSessions.length > 0 ? totalProfit / cashgameSessions.length : 0;
  const totalROI = totalBuyIns > 0 ? (totalProfit / totalBuyIns) * 100 : 0;
  
  return {
    totalProfit,
    totalSessions: cashgameSessions.length,
    totalPlaytime,
    avgProfitPerHour,
    avgProfitPerSession,
    totalROI,
    totalBuyIns
  };
}

function calculateTournamentStatsFromGames(sessions, games) {
  const tournaments = games.filter(g => ['tournament', 'sng', 'mtt'].includes(g.type));
  
  if (tournaments.length === 0) {
    return {
      totalProfit: 0,
      totalTournaments: 0,
      totalEntries: 0,
      totalPlaytime: 0,
      itmRatio: 0,
      totalROI: 0,
      avgBuyIn: 0,
      totalBuyIns: 0
    };
  }
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalEntries = 0;
  let totalPlaytime = 0;
  let itmCount = 0;
  
  tournaments.forEach(t => {
    // Für Turniere: buy_in und prize_money (falls vorhanden)
    const buyIn = parseFloat(t.buy_in || 0);
    const prizeMoney = parseFloat(t.prize_money || t.cash_out || 0);
    const netResult = prizeMoney - buyIn;
    
    totalProfit += netResult;
    totalBuyIns += buyIn;
    totalEntries += t.entries || 1;
    totalPlaytime += parseFloat(t.duration_minutes || 0);
    
    // ITM = In The Money (Gewinn gemacht)
    if (t.itm === true || netResult > 0) {
      itmCount++;
    }
  });
  
  console.log(`💰 Tournament Buy-Ins from ${tournaments.length} games: ${totalBuyIns}`);
  
  const avgBuyIn = tournaments.length > 0 ? totalBuyIns / tournaments.length : 0;
  const itmRatio = tournaments.length > 0 ? (itmCount / tournaments.length) * 100 : 0;
  const totalROI = totalBuyIns > 0 ? (totalProfit / totalBuyIns) * 100 : 0;
  
  return {
    totalProfit,
    totalTournaments: tournaments.length,
    totalEntries,
    totalPlaytime,
    itmRatio,
    totalROI,
    avgBuyIn,
    totalBuyIns
  };
}

console.log('🔍 DEBUG tournaments:', tournaments.length);
  if (tournaments.length > 0) {
    const first = tournaments[0];
    console.log('🔍 First tournament fields:', {
      id: first.id,
      buy_in: first.buy_in,
      profit_loss: first.profit_loss,
      net_profit: first.net_profit,
      cash_out: first.cash_out
    });
  }
  
  if (tournaments.length === 0) {
  const tournaments = games.filter(g => ['tournament', 'sng', 'mtt'].includes(g.type));
  
  if (tournaments.length === 0) {
    return {
      totalProfit: 0,
      totalTournaments: 0,
      totalEntries: 0,
      totalPlaytime: 0,
      itmRatio: 0,
      totalROI: 0,
      avgBuyIn: 0,
      totalBuyIns: 0
    };
  }
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalEntries = 0;
  let totalPlaytime = 0;
  let itmCount = 0;
  
  tournaments.forEach(t => {
    const netResult = parseFloat(t.net_result || 0);
    const buyIn = parseFloat(t.total_buy_in || 0);
    
    totalProfit += netResult;
    totalBuyIns += buyIn;
    totalEntries += t.entries || 1;
    totalPlaytime += parseFloat(t.duration_minutes || 0);
    
    // ITM = In The Money (Gewinn gemacht)
    if (t.itm === true || netResult > 0) {
      itmCount++;
    }
  });
  
  console.log(`💰 Tournament Buy-Ins: ${totalBuyIns}`);
  
  const avgBuyIn = tournaments.length > 0 ? totalBuyIns / tournaments.length : 0;
  const itmRatio = tournaments.length > 0 ? (itmCount / tournaments.length) * 100 : 0;
  const totalROI = totalBuyIns > 0 ? (totalProfit / totalBuyIns) * 100 : 0;
  
  return {
    totalProfit,
    totalTournaments: tournaments.length,
    totalEntries,
    totalPlaytime,
    itmRatio,
    totalROI,
    avgBuyIn,
    totalBuyIns
  };
}

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
// GAMES TABLE MIGRATION - Füge diese Route in server.js ein
// Fügt fehlende Spalten zur games-Tabelle hinzu
// =============================================================================

// POST /api/migrate/games-table
app.post('/api/migrate/games-table', authenticateToken, async (req, res) => {
  try {
    console.log('🔧 Starting games table migration...');
    
    // Check if user is authorized (optional - remove if you want anyone to run migrations)
    // For security, you might want to check if user is admin
    
    const migrations = [];
    
    // Migration 1: Add total_buy_in column if not exists
    try {
      await pool.query(`
        ALTER TABLE games 
        ADD COLUMN IF NOT EXISTS total_buy_in DECIMAL(10, 2) DEFAULT 0
      `);
      migrations.push('✅ Added total_buy_in column');
      console.log('✅ total_buy_in column added or already exists');
    } catch (err) {
      console.error('❌ Error adding total_buy_in:', err.message);
      migrations.push(`❌ total_buy_in failed: ${err.message}`);
    }
    
    // Migration 2: Add net_result column if not exists
    try {
      await pool.query(`
        ALTER TABLE games 
        ADD COLUMN IF NOT EXISTS net_result DECIMAL(10, 2) DEFAULT 0
      `);
      migrations.push('✅ Added net_result column');
      console.log('✅ net_result column added or already exists');
    } catch (err) {
      console.error('❌ Error adding net_result:', err.message);
      migrations.push(`❌ net_result failed: ${err.message}`);
    }
    
    // Migration 3: Add buy_in column if not exists (some games might use this)
    try {
      await pool.query(`
        ALTER TABLE games 
        ADD COLUMN IF NOT EXISTS buy_in DECIMAL(10, 2) DEFAULT 0
      `);
      migrations.push('✅ Added buy_in column');
      console.log('✅ buy_in column added or already exists');
    } catch (err) {
      console.error('❌ Error adding buy_in:', err.message);
      migrations.push(`❌ buy_in failed: ${err.message}`);
    }
    
    // Migration 4: Add cash_out column for cashgames
    try {
      await pool.query(`
        ALTER TABLE games 
        ADD COLUMN IF NOT EXISTS cash_out DECIMAL(10, 2) DEFAULT 0
      `);
      migrations.push('✅ Added cash_out column');
      console.log('✅ cash_out column added or already exists');
    } catch (err) {
      console.error('❌ Error adding cash_out:', err.message);
      migrations.push(`❌ cash_out failed: ${err.message}`);
    }
    
    // Migration 5: Add prize_money column for tournaments
    try {
      await pool.query(`
        ALTER TABLE games 
        ADD COLUMN IF NOT EXISTS prize_money DECIMAL(10, 2) DEFAULT 0
      `);
      migrations.push('✅ Added prize_money column');
      console.log('✅ prize_money column added or already exists');
    } catch (err) {
      console.error('❌ Error adding prize_money:', err.message);
      migrations.push(`❌ prize_money failed: ${err.message}`);
    }
    
    // Migration 6: Add entries column for tournaments (re-entries)
    try {
      await pool.query(`
        ALTER TABLE games 
        ADD COLUMN IF NOT EXISTS entries INTEGER DEFAULT 1
      `);
      migrations.push('✅ Added entries column');
      console.log('✅ entries column added or already exists');
    } catch (err) {
      console.error('❌ Error adding entries:', err.message);
      migrations.push(`❌ entries failed: ${err.message}`);
    }
    
    // Migration 7: Add itm (In The Money) boolean for tournaments
    try {
      await pool.query(`
        ALTER TABLE games 
        ADD COLUMN IF NOT EXISTS itm BOOLEAN DEFAULT false
      `);
      migrations.push('✅ Added itm column');
      console.log('✅ itm column added or already exists');
    } catch (err) {
      console.error('❌ Error adding itm:', err.message);
      migrations.push(`❌ itm failed: ${err.message}`);
    }
    
    // Migration 8: Add duration_minutes for games
    try {
      await pool.query(`
        ALTER TABLE games 
        ADD COLUMN IF NOT EXISTS duration_minutes INTEGER DEFAULT 0
      `);
      migrations.push('✅ Added duration_minutes column');
      console.log('✅ duration_minutes column added or already exists');
    } catch (err) {
      console.error('❌ Error adding duration_minutes:', err.message);
      migrations.push(`❌ duration_minutes failed: ${err.message}`);
    }
    
    // Check current table structure
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'games'
      ORDER BY ordinal_position
    `);
    
    console.log('✅ Games table migration completed!');
    
    res.json({
      success: true,
      message: 'Games table migration completed successfully',
      migrations: migrations,
      currentColumns: tableInfo.rows
    });
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Migration failed',
      error: error.message
    });
  }
});

// GET /api/games/structure - Check games table structure
app.get('/api/games/structure', authenticateToken, async (req, res) => {
  try {
    const tableInfo = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'games'
      ORDER BY ordinal_position
    `);
    
    res.json({
      success: true,
      columns: tableInfo.rows
    });
  } catch (error) {
    console.error('Error getting table structure:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get table structure',
      error: error.message
    });
  }
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