const express = require('express');
const { param, validationResult } = require('express-validator');
const { Bankroll, Session, Game } = require('../models');
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

// GET /api/obs/bankroll/:id - Bankroll-Daten für OBS mit korrekter Berechnung
router.get('/bankroll/:id', [
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

    // Berechne korrekten Profit
    const startingAmount = parseFloat(bankroll.starting_amount) || 0;
    const currentAmount = parseFloat(bankroll.current_amount) || 0;
    const totalProfit = currentAmount - startingAmount;

    const obsData = {
      id: bankroll.id,
      name: bankroll.name,
      type: bankroll.type,
      currency: bankroll.currency || 'EUR',
      starting_amount: startingAmount,
      current_amount: currentAmount,
      total_profit: totalProfit,
      goal_amount: parseFloat(bankroll.goal_amount) || 0,
      stakes: bankroll.stakes || '',
      last_updated: new Date().toISOString()
    };

    res.json({
      success: true,
      data: obsData
    });

  } catch (error) {
    console.error('Error fetching OBS bankroll data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bankroll data',
      error: error.message
    });
  }
});

// GET /api/obs/session/:bankrollId/active - Aktive Session-Daten für OBS mit korrekter Buy-in-Berechnung
router.get('/session/:bankrollId/active', [
  param('bankrollId').isUUID().withMessage('Invalid bankroll ID')
], handleValidationErrors, async (req, res) => {
  try {
    // Finde die aktive Session für diese Bankroll
    const activeSession = await Session.findOne({
      where: {
        bankroll_id: req.params.bankrollId,
        status: 'running'
      },
      order: [['start_time', 'DESC']]
    });

    if (!activeSession) {
      // Keine aktive Session - return empty data
      return res.json({
        success: true,
        data: {
          session_id: null,
          session_name: 'Keine aktive Session',
          status: 'inactive',
          total_buyins: 0,
          total_cashes: 0,
          cash_count: 0,
          profit: 0,
          games_count: 0,
          duration_minutes: 0,
          start_time: null
        }
      });
    }

    // Hole alle Games für diese Session
    const games = await Game.findAll({
      where: { session_id: activeSession.id },
      order: [['start_time', 'DESC']]
    });

    // ✅ KORREKTE BERECHNUNG - Buy-ins mit Entries multiplizieren
    let totalBuyins = 0;
    let totalCashes = 0;
    let cashCount = 0;

    games.forEach(game => {
      const buyIn = parseFloat(game.buy_in) || 0;
      const entries = parseInt(game.entries) || 1;
      const winnings = parseFloat(game.winnings) || 0;

      // Buy-in = buy_in * entries (KORREKT!)
      totalBuyins += (buyIn * entries);
      
      // Cashes = gewonnene Beträge
      if (winnings > 0) {
        totalCashes += winnings;
        cashCount++;
      }
    });

    // Session Profit = Cashes - Buy-ins
    const sessionProfit = totalCashes - totalBuyins;

    // Berechne Session-Dauer
    const startTime = new Date(activeSession.start_time);
    const now = new Date();
    const durationMinutes = Math.floor((now - startTime) / (1000 * 60));

    const obsData = {
      session_id: activeSession.id,
      session_name: activeSession.name,
      status: activeSession.status,
      total_buyins: totalBuyins,
      total_cashes: totalCashes,
      cash_count: cashCount,
      profit: sessionProfit,
      games_count: games.length,
      duration_minutes: durationMinutes,
      start_time: activeSession.start_time,
      last_updated: new Date().toISOString()
    };

    res.json({
      success: true,
      data: obsData
    });

  } catch (error) {
    console.error('Error fetching OBS session data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session data',
      error: error.message
    });
  }
});

// GET /api/obs/session/:sessionId/direct - Direkte Session-Daten (alternative Endpoint)
router.get('/session/:sessionId/direct', [
  param('sessionId').isUUID().withMessage('Invalid session ID')
], handleValidationErrors, async (req, res) => {
  try {
    const session = await Session.findByPk(req.params.sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    // Hole alle Games für diese Session
    const games = await Game.findAll({
      where: { session_id: session.id },
      order: [['start_time', 'DESC']]
    });

    // ✅ KORREKTE BERECHNUNG
    let totalBuyins = 0;
    let totalCashes = 0;
    let cashCount = 0;

    games.forEach(game => {
      const buyIn = parseFloat(game.buy_in) || 0;
      const entries = parseInt(game.entries) || 1;
      const winnings = parseFloat(game.winnings) || 0;

      totalBuyins += (buyIn * entries);
      
      if (winnings > 0) {
        totalCashes += winnings;
        cashCount++;
      }
    });

    const sessionProfit = totalCashes - totalBuyins;

    // Berechne Dauer
    let durationMinutes = 0;
    if (session.start_time) {
      const startTime = new Date(session.start_time);
      const endTime = session.end_time ? new Date(session.end_time) : new Date();
      durationMinutes = Math.floor((endTime - startTime) / (1000 * 60));
    }

    const obsData = {
      session_id: session.id,
      session_name: session.name,
      status: session.status,
      total_buyins: totalBuyins,
      total_cashes: totalCashes,
      cash_count: cashCount,
      profit: sessionProfit,
      games_count: games.length,
      duration_minutes: durationMinutes,
      start_time: session.start_time,
      end_time: session.end_time,
      last_updated: new Date().toISOString()
    };

    res.json({
      success: true,
      data: obsData
    });

  } catch (error) {
    console.error('Error fetching OBS session data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session data',
      error: error.message
    });
  }
});

// GET /api/obs/health - Health check für OBS
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'OBS API is running',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/api/obs/bankroll/:id',
      '/api/obs/session/:bankrollId/active',
      '/api/obs/session/:sessionId/direct'
    ]
  });
});

module.exports = router;