const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Session, Bankroll, Game } = require('../models');
const router = express.Router();

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
router.get('/', async (req, res) => {
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
router.get('/active', async (req, res) => {
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
], handleValidationErrors, async (req, res) => {
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
], handleValidationErrors, async (req, res) => {
  try {
    // Verify bankroll exists
    const bankroll = await Bankroll.findByPk(req.body.bankroll_id);
    if (!bankroll) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
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
], handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
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

// POST /api/sessions/:id/complete - Complete session
router.post('/:id/complete', [
  param('id').isUUID().withMessage('Invalid session ID')
], handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }
    
    if (session.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Session is already completed'
      });
    }
    
    await session.completeSession();
    
    res.json({
      success: true,
      message: 'Session completed successfully',
      data: session
    });
  } catch (error) {
    console.error('Error completing session:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to complete session',
      error: error.message
    });
  }
});

// DELETE /api/sessions/:id - Delete session
router.delete('/:id', [
  param('id').isUUID().withMessage('Invalid session ID')
], handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
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

// GET /api/sessions/:id/games - Get games for session
router.get('/:id/games', [
  param('id').isUUID().withMessage('Invalid session ID')
], handleValidationErrors, async (req, res) => {
  try {
    const { status } = req.query;
    
    const whereClause = { session_id: req.params.id };
    if (status) whereClause.status = status;
    
    const games = await Game.findAll({
      where: whereClause,
      order: [['start_time', 'DESC']]
    });
    
    res.json({
      success: true,
      data: games,
      count: games.length
    });
  } catch (error) {
    console.error('Error fetching session games:', error);
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
], handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
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
], handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.id);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
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