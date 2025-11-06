const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Session, Bankroll, Game } = require('../models');
const router = express.Router();

// ⚡ CRITICAL: Add authentication middleware
const authenticateToken = require('../middleware/auth');

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

// 🔧 NEW: Check for active session conflicts
const checkActiveSessionConflict = async (bankrollId, excludeSessionId = null) => {
  const whereClause = { 
    bankroll_id: bankrollId, 
    status: 'running' 
  };
  
  if (excludeSessionId) {
    whereClause.id = { [require('sequelize').Op.ne]: excludeSessionId };
  }
  
  const activeSession = await Session.findOne({
    where: whereClause,
    include: [
      {
        model: Bankroll,
        as: 'bankroll',
        attributes: ['id', 'name', 'type', 'currency']
      }
    ]
  });
  
  return activeSession;
};

// 🔧 NEW: GET /api/sessions/check-conflicts/:bankrollId - Check for active sessions
router.get('/check-conflicts/:bankrollId', [
  param('bankrollId').isUUID().withMessage('Invalid bankroll ID')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    const { bankrollId } = req.params;
    
    // Verify bankroll exists and user has access
    const bankroll = await Bankroll.findByPk(bankrollId);
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
    
    const activeSession = await checkActiveSessionConflict(bankrollId);
    
    res.json({
      success: true,
      hasActiveSession: !!activeSession,
      activeSession: activeSession || null
    });
  } catch (error) {
    console.error('Error checking session conflicts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check session conflicts',
      error: error.message
    });
  }
});

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
        attributes: ['id', 'name', 'type', 'currency'],
        where: { user_id: req.user.userId } // Ensure user only sees their sessions
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

// 🔧 ENHANCED: GET /api/sessions/active - Get active sessions with user filtering
router.get('/active', authenticateToken, async (req, res) => {
  try {
    console.log('🔍 Fetching active sessions for user:', req.user.userId);
    
    const sessions = await Session.findAll({
      where: { status: 'running' },
      include: [
        {
          model: Bankroll,
          as: 'bankroll',
          attributes: ['id', 'name', 'type', 'currency'],
          where: { user_id: req.user.userId }
        },
        {
          model: Game,
          as: 'games',
          required: false,
          order: [['start_time', 'DESC']],
          limit: 5
        }
      ],
      order: [['start_time', 'DESC']]
    });
    
    console.log('✅ Found active sessions:', sessions.length);
    
    // Calculate session metadata
    const enrichedSessions = sessions.map(session => {
      const sessionData = session.toJSON();
      
      // Calculate current duration
      if (session.start_time) {
        const now = new Date();
        const startTime = new Date(session.start_time);
        sessionData.current_duration_minutes = Math.round((now - startTime) / (1000 * 60));
      }
      
      // Calculate current stats from games
      if (sessionData.games && sessionData.games.length > 0) {
        let totalBuyIn = 0;
        let totalWinnings = 0;
        
        for (const game of sessionData.games) {
          totalBuyIn += parseFloat(game.buy_in || 0) * (game.entries || 1);
          totalWinnings += parseFloat(game.winnings || 0);
        }
        
        sessionData.current_total_buy_in = totalBuyIn;
        sessionData.current_total_winnings = totalWinnings;
        sessionData.current_total_result = totalWinnings - totalBuyIn;
      }
      
      return sessionData;
    });
    
    res.json({
      success: true,
      data: enrichedSessions,
      count: enrichedSessions.length
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

// 🔧 NEW: POST /api/sessions/resume/:id - Resume an active session
router.post('/resume/:id', [
  param('id').isUUID().withMessage('Invalid session ID')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id, {
      include: [
        {
          model: Bankroll,
          as: 'bankroll',
          attributes: ['id', 'name', 'type', 'currency']
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
    
    if (session.status !== 'running') {
      return res.status(400).json({
        success: false,
        message: 'Can only resume running sessions'
      });
    }
    
    // Update session metadata to indicate it was resumed
    await session.update({
      notes: session.notes ? 
        `${session.notes}\n[Session resumed at ${new Date().toLocaleString()}]` :
        `[Session resumed at ${new Date().toLocaleString()}]`
    });
    
    console.log('✅ Session resumed:', session.id, 'by user:', req.user.userId);
    
    res.json({
      success: true,
      message: 'Session resumed successfully',
      data: session
    });
  } catch (error) {
    console.error('Error resuming session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resume session',
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
          attributes: ['id', 'name', 'type', 'currency']
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

// 🔧 ENHANCED: POST /api/sessions - Create new session with conflict resolution
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
    .withMessage('Notes must be 1000 characters or less'),
  body('force_create')
    .optional()
    .isBoolean()
    .withMessage('force_create must be a boolean'),
  body('action_on_conflict')
    .optional()
    .isIn(['pause_existing', 'complete_existing', 'fail'])
    .withMessage('action_on_conflict must be one of: pause_existing, complete_existing, fail')
], authenticateToken, handleValidationErrors, async (req, res) => {
  try {
    const { bankroll_id, force_create = false, action_on_conflict = 'fail' } = req.body;
    
    // Verify bankroll exists and belongs to user
    const bankroll = await Bankroll.findByPk(bankroll_id);
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
    
    // Check for active session conflicts
    const activeSession = await checkActiveSessionConflict(bankroll_id);
    
    if (activeSession && !force_create) {
      return res.status(409).json({
        success: false,
        message: 'There is already an active session for this bankroll',
        error: 'ACTIVE_SESSION_EXISTS',
        activeSession: {
          id: activeSession.id,
          name: activeSession.name,
          start_time: activeSession.start_time,
          bankroll: activeSession.bankroll
        },
        suggested_actions: [
          { action: 'resume', label: 'Resume existing session' },
          { action: 'pause_existing', label: 'Pause existing and create new' },
          { action: 'complete_existing', label: 'Complete existing and create new' }
        ]
      });
    }
    
    // Handle conflict resolution if force_create is true
    if (activeSession && force_create) {
      switch (action_on_conflict) {
        case 'pause_existing':
          activeSession.status = 'paused';
          await activeSession.save();
          console.log('⏸️ Paused existing session:', activeSession.id);
          break;
          
        case 'complete_existing':
          // Complete the existing session
          activeSession.status = 'completed';
          activeSession.end_time = new Date();
          
          // Calculate duration
          if (activeSession.start_time) {
            const startTime = new Date(activeSession.start_time);
            const endTime = new Date();
            activeSession.duration_minutes = Math.round((endTime - startTime) / (1000 * 60));
          }
          
          // Update stats
          await activeSession.updateStatsFromGames();
          await activeSession.save();
          
          // Update bankroll stats
          await bankroll.updateStats();
          
          console.log('✅ Completed existing session:', activeSession.id);
          break;
          
        case 'fail':
        default:
          return res.status(409).json({
            success: false,
            message: 'Active session exists and no action specified'
          });
      }
    }
    
    // Create new session
    const sessionData = {
      ...req.body,
      status: 'running',
      start_time: new Date()
    };
    
    // Remove conflict resolution fields
    delete sessionData.force_create;
    delete sessionData.action_on_conflict;
    
    const session = await Session.create(sessionData);
    
    // Include bankroll info in response
    const sessionWithBankroll = await Session.findByPk(session.id, {
      include: [
        {
          model: Bankroll,
          as: 'bankroll',
          attributes: ['id', 'name', 'type', 'currency']
        }
      ]
    });
    
    console.log('✅ New session created:', session.id, 'for bankroll:', bankroll_id);
    
    res.status(201).json({
      success: true,
      message: 'Session created successfully',
      data: sessionWithBankroll,
      previousSessionAction: activeSession ? action_on_conflict : null
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

// 🔧 NEW: POST /api/sessions/:id/pause - Pause session
router.post('/:id/pause', [
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
    
    if (session.status !== 'running') {
      return res.status(400).json({
        success: false,
        message: 'Can only pause running sessions'
      });
    }
    
    session.status = 'paused';
    await session.save();
    
    console.log('⏸️ Session paused:', session.id);
    
    res.json({
      success: true,
      message: 'Session paused successfully',
      data: session
    });
  } catch (error) {
    console.error('Error pausing session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pause session',
      error: error.message
    });
  }
});

// POST /api/sessions/:id/complete - Complete session
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
    
    // Manual session completion
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
    
    // Update bankroll stats
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

// GET /api/sessions/:id/games - Get games for session  
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

module.exports = router;