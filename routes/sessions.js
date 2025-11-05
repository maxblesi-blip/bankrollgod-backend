const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Session, Bankroll, Game } = require('../models');
const router = express.Router();

// ⚡ CRITICAL: Add authentication middleware
const authenticateToken = require('../middleware/auth'); // Adjust path to your auth middleware

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// GET /api/sessions - Get all sessions
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { 
      bankroll_id, 
      status, 
      limit = 20, 
      offset = 0,
      include_games = 'false'
    } = req.query;
    
    const whereClause = {};
    if (bankroll_id) whereClause.bankroll_id = bankroll_id;
    if (status) whereClause.status = status;
    
    const includeOptions = [
      {
        model: Bankroll,
        as: 'bankroll',
        attributes: ['id', 'name', 'type']
      }
    ];
    
    if (include_games === 'true') {
      includeOptions.push({
        model: Game,
        as: 'games',
        order: [['start_time', 'DESC']]
      });
    }
    
    const sessions = await Session.findAll({
      where: whereClause,
      include: includeOptions,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['start_time', 'DESC']]
    });
    
    res.json({
      success: true,
      data: sessions,
      count: sessions.length
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

// GET /api/sessions/active - Get active sessions
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const sessions = await Session.findActive();
    
    res.json({
      success: true,
      data: sessions,
      count: sessions.length
    });
  } catch (error) {
    console.error('Error fetching active sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active sessions',
      error: error.message
    });
  }
});

// GET /api/sessions/:id - Get specific session
router.get('/:id', [
  param('id').isUUID().withMessage('Invalid session ID')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id, {
      include: [
        {
          model: Bankroll,
          as: 'bankroll',
          attributes: ['id', 'name', 'type']
        },
        {
          model: Game,
          as: 'games',
          order: [['start_time', 'DESC']]
        }
      ]
    });
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check user access
    const bankroll = await Bankroll.findByPk(session.bankroll_id);
    if (!bankroll || bankroll.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    res.json({
      success: true,
      data: session
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

// ⚡ FIXED: GET /api/sessions/:id/games - Get games for session
router.get('/:id/games', [
  param('id').isUUID().withMessage('Invalid session ID')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    console.log('🔍 DEBUG: Getting games for session:', req.params.id);
    console.log('🔍 DEBUG: User ID:', req.user?.userId);
    
    const { status } = req.query;
    
    // Verify session exists and user has access
    const session = await Session.findByPk(req.params.id);
    if (!session) {
      console.log('❌ Session not found:', req.params.id);
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check if user has access through bankroll ownership
    const bankroll = await Bankroll.findByPk(session.bankroll_id);
    if (!bankroll || bankroll.user_id !== req.user.userId) {
      console.log('❌ Access denied for session:', req.params.id, 'bankroll user:', bankroll?.user_id, 'request user:', req.user.userId);
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const whereClause = { session_id: req.params.id };
    if (status) whereClause.status = status;
    
    const games = await Game.findAll({
      where: whereClause,
      order: [['start_time', 'DESC']]
    });
    
    console.log('✅ Found games:', games.length);
    
    res.json({
      success: true,
      data: games,
      count: games.length
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

// POST /api/sessions - Create new session
router.post('/', [
  body('name')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Name must be between 1 and 200 characters'),
  body('bankroll_id')
    .isUUID()
    .withMessage('Valid bankroll ID is required'),
  body('location')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Location must be 100 characters or less'),
  body('session_type')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Session type must be 100 characters or less'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must be 1000 characters or less')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    // Verify bankroll exists and belongs to user
    const bankroll = await Bankroll.findByPk(req.body.bankroll_id);
    if (!bankroll) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }
    
    if (bankroll.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const session = await Session.create(req.body);
    
    // Include bankroll info in response
    const sessionWithBankroll = await Session.findByPk(session.id, {
      include: [
        {
          model: Bankroll,
          as: 'bankroll',
          attributes: ['id', 'name', 'type']
        }
      ]
    });
    
    res.status(201).json({
      success: true,
      message: 'Session created successfully',
      data: sessionWithBankroll
    });
  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create session',
      error: error.message
    });
  }
});

// PUT /api/sessions/:id - Update session
router.put('/:id', [
  param('id').isUUID().withMessage('Invalid session ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Name must be between 1 and 200 characters'),
  body('location')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Location must be 100 characters or less'),
  body('session_type')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Session type must be 100 characters or less'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must be 1000 characters or less')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check user access
    const bankroll = await Bankroll.findByPk(session.bankroll_id);
    if (!bankroll || bankroll.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    await session.update(req.body);
    
    res.json({
      success: true,
      message: 'Session updated successfully',
      data: session
    });
  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update session',
      error: error.message
    });
  }
});

// ⚡ FIXED: POST /api/sessions/:id/complete - Complete session
router.post('/:id/complete', [
  param('id').isUUID().withMessage('Invalid session ID')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    console.log('🔧 DEBUG: Completing session:', req.params.id);
    console.log('🔧 DEBUG: User ID:', req.user?.userId);
    
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      console.log('❌ Session not found:', req.params.id);
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check user access
    const bankroll = await Bankroll.findByPk(session.bankroll_id);
    if (!bankroll || bankroll.user_id !== req.user.userId) {
      console.log('❌ Access denied for session:', req.params.id);
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    if (session.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Session is already completed'
      });
    }
    
    console.log('🔧 DEBUG: About to complete session...');
    
    // ⚡ MANUAL SESSION COMPLETION (safer than model method)
    session.status = 'completed';
    session.end_time = new Date();
    
    // Calculate duration
    if (session.start_time) {
      const startTime = new Date(session.start_time);
      const endTime = new Date();
      session.duration_minutes = Math.round((endTime - startTime) / (1000 * 60));
    }
    
    // Update session stats from games
    const games = await Game.findAll({
      where: { session_id: session.id }
    });
    
    let totalBuyIn = 0;
    let totalWinnings = 0;
    let totalEntries = 0;
    
    for (const game of games) {
      const buyIn = parseFloat(game.buy_in || 0);
      const entries = parseInt(game.entries || 1);
      const winnings = parseFloat(game.winnings || 0);
      
      totalBuyIn += buyIn * entries;
      totalWinnings += winnings;
      totalEntries += entries;
    }
    
    session.total_buy_in = totalBuyIn;
    session.total_winnings = totalWinnings;
    session.total_result = totalWinnings - totalBuyIn;
    session.total_games = games.length;
    session.total_entries = totalEntries;
    
    // Calculate hourly rate
    if (session.duration_minutes && session.duration_minutes > 0) {
      const hours = session.duration_minutes / 60;
      session.hourly_rate = session.total_result / hours;
    }
    
    // Calculate ROI
    if (totalBuyIn > 0) {
      session.roi = (session.total_result / totalBuyIn) * 100;
    }
    
    await session.save();
    console.log('✅ DEBUG: Session completed successfully');
    
    // Update bankroll stats if method exists
    try {
      if (bankroll && typeof bankroll.updateStats === 'function') {
        await bankroll.updateStats();
        console.log('✅ DEBUG: Bankroll stats updated');
      }
    } catch (bankrollError) {
      console.warn('⚠️ Could not update bankroll stats:', bankrollError.message);
    }
    
    res.json({
      success: true,
      message: 'Session completed successfully',
      data: session
    });
  } catch (error) {
    console.error('❌ Error completing session:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to complete session',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', [
  param('id').isUUID().withMessage('Invalid session ID')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check user access
    const bankroll = await Bankroll.findByPk(session.bankroll_id);
    if (!bankroll || bankroll.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    await session.destroy();
    
    res.json({
      success: true,
      message: 'Session deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete session',
      error: error.message
    });
  }
});

// POST /api/sessions/:id/games - Add game to session
router.post('/:id/games', [
  param('id').isUUID().withMessage('Invalid session ID'),
  body('name')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Name must be between 1 and 200 characters'),
  body('type')
    .isIn(['tournament', 'cashgame', 'sng', 'mtt'])
    .withMessage('Type must be one of: tournament, cashgame, sng, mtt'),
  body('buy_in')
    .isFloat({ min: 0 })
    .withMessage('Buy-in must be a positive number'),
  body('entries')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Entries must be between 1 and 20')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check user access
    const bankroll = await Bankroll.findByPk(session.bankroll_id);
    if (!bankroll || bankroll.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    if (session.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot add games to a completed session'
      });
    }
    
    const game = await session.addGame(req.body);
    
    res.status(201).json({
      success: true,
      message: 'Game added to session successfully',
      data: game
    });
  } catch (error) {
    console.error('Error adding game to session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add game to session',
      error: error.message
    });
  }
});

// POST /api/sessions/:id/update-stats - Update session statistics
router.post('/:id/update-stats', [
  param('id').isUUID().withMessage('Invalid session ID')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    // Check user access
    const bankroll = await Bankroll.findByPk(session.bankroll_id);
    if (!bankroll || bankroll.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    await session.updateStatsFromGames();
    
    res.json({
      success: true,
      message: 'Session statistics updated successfully',
      data: session
    });
  } catch (error) {
    console.error('Error updating session stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update session statistics',
      error: error.message
    });
  }
});

module.exports = router;