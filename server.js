// server.js
// Production Backend für BankrollGod Multi-User System
// Echte JWT Authentication + PostgreSQL

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5000;

// Database Connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection error:', err.stack);
  } else {
    console.log('✅ Database connected successfully');
    release();
  }
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { success: false, message: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

// JWT Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify user still exists
    const userResult = await pool.query(
      'SELECT id, email, username, first_name, last_name, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    req.user = userResult.rows[0];
    next();
  } catch (error) {
    console.error('Token verification error:', error);
    return res.status(403).json({ success: false, message: 'Invalid or expired token' });
  }
};

// Utility Functions
const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId, type: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  
  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};

const hashPassword = async (password) => {
  return await bcrypt.hash(password, 12);
};

const validatePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

// Health Check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'BankrollGod Production Backend is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// ===== AUTHENTICATION ROUTES =====

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username, first_name, last_name } = req.body;

    // Validation
    if (!email || !password || !username) {
      return res.status(400).json({
        success: false,
        message: 'Email, password, and username are required'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or username already exists'
      });
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const userId = uuidv4();
    const userResult = await pool.query(`
      INSERT INTO users (id, email, username, password_hash, first_name, last_name)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, email, username, first_name, last_name, created_at
    `, [userId, email.toLowerCase(), username.toLowerCase(), passwordHash, first_name, last_name]);

    const user = userResult.rows[0];
    const tokens = generateTokens(userId);

    console.log(`✅ New user registered: ${email}`);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during registration'
    });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, remember_me } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find user
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = userResult.rows[0];

    // Validate password
    const isValidPassword = await validatePassword(password, user.password_hash);

    if (!isValidPassword) {
      console.log(`❌ Failed login attempt for: ${email}`);
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate tokens
    const tokens = generateTokens(user.id);

    // Remove password from response
    const { password_hash, ...userResponse } = user;

    console.log(`✅ Successful login: ${email}`);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userResponse,
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login'
    });
  }
});

// Refresh Token
app.post('/api/auth/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    const decoded = jwt.verify(refresh_token, process.env.JWT_REFRESH_SECRET);
    
    // Verify user exists
    const userResult = await pool.query(
      'SELECT id, email, username, first_name, last_name FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const tokens = generateTokens(decoded.userId);

    res.json({
      success: true,
      message: 'Tokens refreshed successfully',
      data: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken
      }
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(403).json({
      success: false,
      message: 'Invalid or expired refresh token'
    });
  }
});

// Get User Profile
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      user: req.user
    }
  });
});

// Logout
app.post('/api/auth/logout', authenticateToken, (req, res) => {
  // In a production app, you'd typically blacklist the token
  // For now, we'll just send a success response
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// ===== BANKROLL ROUTES =====

// Get all bankrolls for user
app.get('/api/bankrolls', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, name, initial_amount, current_amount, currency,
        created_at, updated_at
      FROM bankrolls 
      WHERE user_id = $1 
      ORDER BY created_at DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get bankrolls error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching bankrolls'
    });
  }
});

// Create new bankroll
app.post('/api/bankrolls', authenticateToken, async (req, res) => {
  try {
    const { name, initial_amount, currency = 'EUR' } = req.body;

    if (!name || !initial_amount) {
      return res.status(400).json({
        success: false,
        message: 'Name and initial amount are required'
      });
    }

    const bankrollId = uuidv4();
    const result = await pool.query(`
      INSERT INTO bankrolls (id, user_id, name, initial_amount, current_amount, currency)
      VALUES ($1, $2, $3, $4, $4, $5)
      RETURNING *
    `, [bankrollId, req.user.id, name, initial_amount, currency]);

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Create bankroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating bankroll'
    });
  }
});

// Update bankroll
app.put('/api/bankrolls/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, current_amount } = req.body;

    const result = await pool.query(`
      UPDATE bankrolls 
      SET name = COALESCE($1, name),
          current_amount = COALESCE($2, current_amount),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `, [name, current_amount, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update bankroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating bankroll'
    });
  }
});

// Delete bankroll
app.delete('/api/bankrolls/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM bankrolls WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }

    res.json({
      success: true,
      message: 'Bankroll deleted successfully'
    });

  } catch (error) {
    console.error('Delete bankroll error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting bankroll'
    });
  }
});

// ===== SESSION ROUTES =====

// Get all sessions for user
app.get('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { status } = req.query;
    
    let query = `
      SELECT s.*, b.name as bankroll_name
      FROM sessions s
      LEFT JOIN bankrolls b ON s.bankroll_id = b.id
      WHERE s.user_id = $1
    `;
    const params = [req.user.id];

    if (status) {
      query += ' AND s.status = $2';
      params.push(status);
    }

    query += ' ORDER BY s.created_at DESC';

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching sessions'
    });
  }
});

// Create new session
app.post('/api/sessions', authenticateToken, async (req, res) => {
  try {
    const { 
      bankroll_id, 
      location, 
      game_type, 
      stakes, 
      start_time = new Date().toISOString() 
    } = req.body;

    if (!bankroll_id) {
      return res.status(400).json({
        success: false,
        message: 'Bankroll ID is required'
      });
    }

    // Verify bankroll belongs to user
    const bankrollCheck = await pool.query(
      'SELECT id FROM bankrolls WHERE id = $1 AND user_id = $2',
      [bankroll_id, req.user.id]
    );

    if (bankrollCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }

    const sessionId = uuidv4();
    const result = await pool.query(`
      INSERT INTO sessions (
        id, user_id, bankroll_id, location, game_type, stakes, 
        start_time, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'running')
      RETURNING *
    `, [sessionId, req.user.id, bankroll_id, location, game_type, stakes, start_time]);

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Create session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating session'
    });
  }
});

// Update session
app.put('/api/sessions/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Build dynamic update query
    const allowedFields = ['location', 'game_type', 'stakes', 'end_time', 'profit_loss', 'status', 'notes'];
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    Object.keys(updates).forEach(field => {
      if (allowedFields.includes(field)) {
        updateFields.push(`${field} = $${paramCount}`);
        updateValues.push(updates[field]);
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(id, req.user.id);

    const query = `
      UPDATE sessions 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
      RETURNING *
    `;

    const result = await pool.query(query, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating session'
    });
  }
});

// Complete session
app.post('/api/sessions/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { profit_loss, end_time = new Date().toISOString(), notes } = req.body;

    const result = await pool.query(`
      UPDATE sessions 
      SET status = 'completed',
          end_time = $1,
          profit_loss = $2,
          notes = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4 AND user_id = $5
      RETURNING *
    `, [end_time, profit_loss, notes, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Update bankroll if profit/loss provided
    if (profit_loss !== undefined && result.rows[0].bankroll_id) {
      await pool.query(`
        UPDATE bankrolls 
        SET current_amount = current_amount + $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND user_id = $3
      `, [profit_loss, result.rows[0].bankroll_id, req.user.id]);
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Complete session error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing session'
    });
  }
});

// Get games for session
app.get('/api/sessions/:id/games', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Verify session belongs to user
    const sessionCheck = await pool.query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const result = await pool.query(`
      SELECT * FROM games 
      WHERE session_id = $1 
      ORDER BY created_at DESC
    `, [id]);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get session games error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching session games'
    });
  }
});

// ===== GAME ROUTES =====

// Get all games for user
app.get('/api/games', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT g.*, s.location, s.game_type, s.stakes
      FROM games g
      LEFT JOIN sessions s ON g.session_id = s.id
      WHERE g.user_id = $1
      ORDER BY g.created_at DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Get games error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching games'
    });
  }
});

// Create new game
app.post('/api/games', authenticateToken, async (req, res) => {
  try {
    const { 
      session_id, 
      buy_in, 
      entries = 1,
      start_time = new Date().toISOString() 
    } = req.body;

    if (!session_id || !buy_in) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and buy-in are required'
      });
    }

    // Verify session belongs to user
    const sessionCheck = await pool.query(
      'SELECT id FROM sessions WHERE id = $1 AND user_id = $2',
      [session_id, req.user.id]
    );

    if (sessionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const gameId = uuidv4();
    const result = await pool.query(`
      INSERT INTO games (
        id, user_id, session_id, buy_in, entries, start_time, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'running')
      RETURNING *
    `, [gameId, req.user.id, session_id, buy_in, entries, start_time]);

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Create game error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating game'
    });
  }
});

// Update game
app.put('/api/games/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const allowedFields = ['buy_in', 'cash_out', 'entries', 'position', 'end_time', 'status', 'notes'];
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    Object.keys(updates).forEach(field => {
      if (allowedFields.includes(field)) {
        updateFields.push(`${field} = $${paramCount}`);
        updateValues.push(updates[field]);
        paramCount++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid fields to update'
      });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(id, req.user.id);

    const query = `
      UPDATE games 
      SET ${updateFields.join(', ')}
      WHERE id = $${paramCount} AND user_id = $${paramCount + 1}
      RETURNING *
    `;

    const result = await pool.query(query, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Update game error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating game'
    });
  }
});

// Complete game
app.post('/api/games/:id/complete', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      cash_out = 0, 
      position, 
      end_time = new Date().toISOString(),
      notes 
    } = req.body;

    const result = await pool.query(`
      UPDATE games 
      SET status = 'completed',
          cash_out = $1,
          position = $2,
          end_time = $3,
          notes = $4,
          profit_loss = $1 - buy_in,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $5 AND user_id = $6
      RETURNING *
    `, [cash_out, position, end_time, notes, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Complete game error:', error);
    res.status(500).json({
      success: false,
      message: 'Error completing game'
    });
  }
});

// Bust game (special case of completion)
app.post('/api/games/:id/bust', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { end_time = new Date().toISOString(), notes } = req.body;

    const result = await pool.query(`
      UPDATE games 
      SET status = 'busted',
          cash_out = 0,
          end_time = $1,
          notes = $2,
          profit_loss = 0 - buy_in,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `, [end_time, notes, id, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Bust game error:', error);
    res.status(500).json({
      success: false,
      message: 'Error busting game'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'API endpoint not found'
  });
});

app.listen(PORT, () => {
  console.log(`🚀 BankrollGod Production Backend running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;