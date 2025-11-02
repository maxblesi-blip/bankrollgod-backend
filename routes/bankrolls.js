const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { Bankroll, Session } = require('../models');
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

// GET /api/bankrolls - Get all bankrolls
router.get('/', async (req, res) => {
  try {
    const { active_only } = req.query;
    
    let bankrolls;
    if (active_only === 'true') {
      bankrolls = await Bankroll.findActive();
    } else {
      bankrolls = await Bankroll.findAll({
        order: [['updated_at', 'DESC']]
      });
    }
    
    res.json({
      success: true,
      data: bankrolls,
      count: bankrolls.length
    });
  } catch (error) {
    console.error('Error fetching bankrolls:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bankrolls',
      error: error.message
    });
  }
});

// GET /api/bankrolls/:id - Get specific bankroll
router.get('/:id', [
  param('id').isUUID().withMessage('Invalid bankroll ID')
], handleValidationErrors, async (req, res) => {
  try {
    const bankroll = await Bankroll.findByPk(req.params.id, {
      include: [
        {
          model: Session,
          as: 'sessions',
          limit: 10,
          order: [['start_time', 'DESC']]
        }
      ]
    });
    
    if (!bankroll) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }
    
    res.json({
      success: true,
      data: bankroll
    });
  } catch (error) {
    console.error('Error fetching bankroll:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bankroll',
      error: error.message
    });
  }
});

// POST /api/bankrolls - Create new bankroll
router.post('/', [
  body('name')
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('type')
    .isIn(['online', 'live'])
    .withMessage('Type must be either "online" or "live"'),
  body('starting_amount')
    .isFloat({ min: 0 })
    .withMessage('Starting amount must be a positive number'),
  body('goal_amount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Goal amount must be a positive number'),
  body('stakes')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Stakes must be 50 characters or less'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must be 500 characters or less')
], handleValidationErrors, async (req, res) => {
  try {
    const bankroll = await Bankroll.create(req.body);
    
    res.status(201).json({
      success: true,
      message: 'Bankroll created successfully',
      data: bankroll
    });
  } catch (error) {
    console.error('Error creating bankroll:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create bankroll',
      error: error.message
    });
  }
});

// PUT /api/bankrolls/:id - Update bankroll
router.put('/:id', [
  param('id').isUUID().withMessage('Invalid bankroll ID'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage('Name must be between 1 and 100 characters'),
  body('type')
    .optional()
    .isIn(['online', 'live'])
    .withMessage('Type must be either "online" or "live"'),
  body('starting_amount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Starting amount must be a positive number'),
  body('goal_amount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Goal amount must be a positive number'),
  body('stakes')
    .optional()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Stakes must be 50 characters or less'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must be 500 characters or less')
], handleValidationErrors, async (req, res) => {
  try {
    const bankroll = await Bankroll.findByPk(req.params.id);
    
    if (!bankroll) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }
    
    await bankroll.update(req.body);
    
    res.json({
      success: true,
      message: 'Bankroll updated successfully',
      data: bankroll
    });
  } catch (error) {
    console.error('Error updating bankroll:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bankroll',
      error: error.message
    });
  }
});

// DELETE /api/bankrolls/:id - Delete bankroll
router.delete('/:id', [
  param('id').isUUID().withMessage('Invalid bankroll ID')
], handleValidationErrors, async (req, res) => {
  try {
    const bankroll = await Bankroll.findByPk(req.params.id);
    
    if (!bankroll) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }
    
    await bankroll.destroy();
    
    res.json({
      success: true,
      message: 'Bankroll deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting bankroll:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete bankroll',
      error: error.message
    });
  }
});

// POST /api/bankrolls/:id/update-stats - Update bankroll statistics
router.post('/:id/update-stats', [
  param('id').isUUID().withMessage('Invalid bankroll ID')
], handleValidationErrors, async (req, res) => {
  try {
    const bankroll = await Bankroll.findByPk(req.params.id);
    
    if (!bankroll) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }
    
    await bankroll.updateStats();
    
    res.json({
      success: true,
      message: 'Bankroll statistics updated successfully',
      data: bankroll
    });
  } catch (error) {
    console.error('Error updating bankroll stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update bankroll statistics',
      error: error.message
    });
  }
});

// GET /api/bankrolls/:id/sessions - Get sessions for bankroll
router.get('/:id/sessions', [
  param('id').isUUID().withMessage('Invalid bankroll ID')
], handleValidationErrors, async (req, res) => {
  try {
    const { limit = 20, offset = 0, status } = req.query;
    
    const whereClause = { bankroll_id: req.params.id };
    if (status) whereClause.status = status;
    
    const sessions = await Session.findAll({
      where: whereClause,
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
    console.error('Error fetching bankroll sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bankroll sessions',
      error: error.message
    });
  }
});

module.exports = router;