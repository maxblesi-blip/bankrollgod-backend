const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Game, Session, Bankroll } = require('../models');
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

// Helper function to update bankroll in real-time
async function updateBankrollFromSession(sessionId) {
  try {
    const session = await Session.findByPk(sessionId, {
      include: [{ model: Bankroll, as: 'bankroll' }]
    });
    
    if (!session || !session.bankroll) {
      return null;
    }

    // Update session stats first
    await session.updateStatsFromGames();
    
    // Then update bankroll stats
    await session.bankroll.updateStats();
    
    // Reload to get fresh data
    await session.bankroll.reload();
    
    return session.bankroll;
  } catch (error) {
    console.error('Error updating bankroll:', error);
    throw error;
  }
}

// GET /api/games - Get all games
router.get('/', async (req, res) => {
  try {
    const { 
      session_id, 
      type, 
      status, 
      limit = 50, 
      offset = 0,
      include_session = 'false'
    } = req.query;
    
    const whereClause = {};
    if (session_id) whereClause.session_id = session_id;
    if (type) whereClause.type = type;
    if (status) whereClause.status = status;
    
    const includeOptions = [];
    if (include_session === 'true') {
      includeOptions.push({
        model: Session,
        as: 'session',
        attributes: ['id', 'name', 'bankroll_id'],
        include: [
          {
            model: Bankroll,
            as: 'bankroll',
            attributes: ['id', 'name', 'type']
          }
        ]
      });
    }
    
    const games = await Game.findAll({
      where: whereClause,
      include: includeOptions,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['start_time', 'DESC']]
    });
    
    res.json({
      success: true,
      data: games,
      count: games.length
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

// GET /api/games/active - Get active games
router.get('/active', async (req, res) => {
  try {
    const games = await Game.findActive();
    
    res.json({
      success: true,
      data: games,
      count: games.length
    });
  } catch (error) {
    console.error('Error fetching active games:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active games',
      error: error.message
    });
  }
});

// GET /api/games/stats - Get game statistics
router.get('/stats', async (req, res) => {
  try {
    const { type, session_id } = req.query;
    
    const filters = {};
    if (type) filters.type = type;
    if (session_id) filters.session_id = session_id;
    
    const stats = await Game.getStats(filters);
    
    if (!stats) {
      return res.json({
        success: true,
        data: {
          totalGames: 0,
          totalBuyIn: 0,
          totalWinnings: 0,
          totalResult: 0,
          winningGames: 0,
          winRate: 0,
          avgBuyIn: 0,
          avgResult: 0,
          roi: 0
        }
      });
    }
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error fetching game stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch game statistics',
      error: error.message
    });
  }
});

// GET /api/games/:id - Get specific game
router.get('/:id', [
  param('id').isUUID().withMessage('Invalid game ID')
], handleValidationErrors, async (req, res) => {
  try {
    const game = await Game.findByPk(req.params.id, {
      include: [
        {
          model: Session,
          as: 'session',
          attributes: ['id', 'name', 'bankroll_id'],
          include: [
            {
              model: Bankroll,
              as: 'bankroll',
              attributes: ['id', 'name', 'type']
            }
          ]
        }
      ]
    });
    
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }
    
    res.json({
      success: true,
      data: game
    });
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch game',
      error: error.message
    });
  }
});

// POST /api/games - Create new game with REAL-TIME BANKROLL UPDATE
router.post('/', [
  body('session_id')
    .isUUID()
    .withMessage('Valid session ID is required'),
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
    .withMessage('Entries must be between 1 and 20'),
  body('location')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Location must be 100 characters or less'),
  body('stakes')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Stakes must be 50 characters or less'),
  body('table_type')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Table type must be 50 characters or less'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must be 1000 characters or less')
], handleValidationErrors, async (req, res) => {
  try {
    // Verify session exists and is not completed
    const session = await Session.findByPk(req.body.session_id);
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
    
    const game = await Game.create(req.body);
    
    // ⚡ REAL-TIME BANKROLL UPDATE
    const updatedBankroll = await updateBankrollFromSession(req.body.session_id);
    
    // Reload session for fresh stats
    await session.reload();
    
    res.status(201).json({
      success: true,
      message: 'Game created successfully',
      data: {
        game,
        bankroll: updatedBankroll,
        sessionStats: {
          total_buy_in: session.total_buy_in,
          total_winnings: session.total_winnings,
          total_result: session.total_result
        }
      }
    });
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create game',
      error: error.message
    });
  }
});

// PUT /api/games/:id - Update game with REAL-TIME BANKROLL UPDATE
router.put('/:id', [
  param('id').isUUID().withMessage('Invalid game ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Name must be between 1 and 200 characters'),
  body('buy_in')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Buy-in must be a positive number'),
  body('winnings')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Winnings must be a positive number'),
  body('entries')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Entries must be between 1 and 20'),
  body('position_finished')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Position finished must be a positive integer'),
  body('total_players')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Total players must be a positive integer'),
  body('location')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Location must be 100 characters or less'),
  body('stakes')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Stakes must be 50 characters or less'),
  body('table_type')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Table type must be 50 characters or less'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Notes must be 1000 characters or less')
], handleValidationErrors, async (req, res) => {
  try {
    const game = await Game.findByPk(req.params.id);
    
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }
    
    await game.update(req.body);
    
    // ⚡ REAL-TIME BANKROLL UPDATE
    const updatedBankroll = await updateBankrollFromSession(game.session_id);
    
    res.json({
      success: true,
      message: 'Game updated successfully',
      data: {
        game,
        bankroll: updatedBankroll
      }
    });
  } catch (error) {
    console.error('Error updating game:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update game',
      error: error.message
    });
  }
});

// POST /api/games/:id/complete - Complete game with BANKROLL UPDATE
router.post('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { winnings = 0, position = null, total_players = null } = req.body;

    // Find game
    const game = await Game.findByPk(id);
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    // Update game
    game.status = 'completed';
    game.winnings = winnings;
    game.cash_out = winnings;
    game.net_profit = parseFloat(winnings) - (parseFloat(game.buy_in) * game.entries);
    game.end_time = new Date();
    
    if (position) game.position = position;
    
    await game.save();

    // ⚡ REAL-TIME BANKROLL UPDATE - DAS FEHLT!
    const session = await Session.findByPk(game.session_id, {
      include: [{ model: Bankroll, as: 'bankroll' }]
    });
    
    if (session && session.bankroll) {
      await session.updateStatsFromGames();
      await session.bankroll.updateStats();
      await session.bankroll.reload();
    }

    // Response MIT Bankroll
    res.json({
      success: true,
      data: {
        game,
        bankroll: session?.bankroll  // ⚡ DAS MUSS ZURÜCK!
      }
    });

  } catch (error) {
    console.error('Error completing game:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// POST /api/games/:id/bust - Mark game as busted with REAL-TIME BANKROLL UPDATE
router.post('/:id/bust', [
  param('id').isUUID().withMessage('Invalid game ID')
], handleValidationErrors, async (req, res) => {
  try {
    const game = await Game.findByPk(req.params.id);
    
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }
    
    if (game.status !== 'running') {
      return res.status(400).json({
        success: false,
        message: 'Can only bust running games'
      });
    }
    
    await game.bustOut();
    
    // ⚡ REAL-TIME BANKROLL UPDATE
    const updatedBankroll = await updateBankrollFromSession(game.session_id);
    
    res.json({
      success: true,
      message: 'Game marked as busted',
      data: {
        game,
        bankroll: updatedBankroll
      }
    });
  } catch (error) {
    console.error('Error busting game:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to bust game',
      error: error.message
    });
  }
});

// PUT /api/games/:id/entries - Update game entries with REAL-TIME BANKROLL UPDATE
router.put('/:id/entries', [
  param('id').isUUID().withMessage('Invalid game ID'),
  body('entries')
    .isInt({ min: 1, max: 20 })
    .withMessage('Entries must be between 1 and 20')
], handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(game.session_id, {
  include: [{ model: Bankroll, as: 'bankroll' }]
});
    
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }
    
    await game.updateEntries(req.body.entries);
    
    // ⚡ REAL-TIME BANKROLL UPDATE
    const updatedBankroll = await updateBankrollFromSession(game.session_id);
    
    res.json({
      success: true,
      message: 'Game entries updated successfully',
      data: {
        game,
        bankroll: updatedBankroll
      }
    });
  } catch (error) {
    console.error('Error updating game entries:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update game entries',
      error: error.message
    });
  }
});

// DELETE /api/games/:id - Delete game with REAL-TIME BANKROLL UPDATE
router.delete('/:id', [
  param('id').isUUID().withMessage('Invalid game ID')
], handleValidationErrors, async (req, res) => {
  try {
    const game = await Game.findByPk(req.params.id);
    
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }
    
    const sessionId = game.session_id;
    await game.destroy();
    
    // ⚡ REAL-TIME BANKROLL UPDATE
    const updatedBankroll = await updateBankrollFromSession(sessionId);
    
    res.json({
      success: true,
      message: 'Game deleted successfully',
      data: {
        bankroll: updatedBankroll
      }
    });
  } catch (error) {
    console.error('Error deleting game:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete game',
      error: error.message
    });
  }
});

module.exports = router;