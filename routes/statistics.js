// routes/statistics.js
// Backend Route für zuverlässige Statistik-Berechnungen

const express = require('express');
const router = express.Router();
const { Session, Game, Bankroll } = require('../models');
const { Op } = require('sequelize');
const authenticateToken = require('../middleware/auth');

/**
 * GET /api/statistics/bankroll/:bankrollId
 * Berechnet alle Statistiken für eine bestimmte Bankroll
 */
router.get('/bankroll/:bankrollId', authenticateToken, async (req, res) => {
  try {
    const { bankrollId } = req.params;
    const { filter = 'all' } = req.query; // 'all', 'cashgames', 'tournaments'
    
    console.log(`📊 Calculating statistics for bankroll ${bankrollId}, filter: ${filter}`);
    
    // Verify bankroll exists and belongs to user
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
    
    // Load all sessions for this bankroll WITH games
    const sessions = await Session.findAll({
      where: { 
        bankroll_id: bankrollId,
        status: { [Op.in]: ['completed', 'running', 'paused'] }
      },
      include: [{
        model: Game,
        as: 'games'
      }],
      order: [['start_time', 'DESC']]
    });
    
    console.log(`✅ Found ${sessions.length} sessions for bankroll ${bankrollId}`);
    
    // Extract all games
    const allGames = [];
    sessions.forEach(session => {
      if (session.games && Array.isArray(session.games)) {
        allGames.push(...session.games);
      }
    });
    
    console.log(`✅ Extracted ${allGames.length} games from sessions`);
    
    // Calculate statistics based on filter
    let stats;
    if (filter === 'cashgames') {
      stats = calculateCashgameStats(sessions, allGames);
    } else if (filter === 'tournaments') {
      stats = calculateTournamentStats(sessions, allGames);
    } else {
      stats = calculateAllStats(sessions, allGames);
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

/**
 * Calculate statistics for ALL games/sessions
 */
function calculateAllStats(sessions, games) {
  if (sessions.length === 0) {
    return getEmptyAllStats();
  }
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalPlaytime = 0;
  
  sessions.forEach(session => {
    totalProfit += parseFloat(session.total_result || 0);
    totalBuyIns += parseFloat(session.total_buy_in || 0);
    totalPlaytime += parseFloat(session.duration_minutes || 0);
  });
  
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

function getEmptyAllStats() {
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

/**
 * Calculate statistics for CASHGAMES only
 */
function calculateCashgameStats(sessions, games) {
  const cashgames = games.filter(g => g.type === 'cashgame');
  const cashgameSessions = sessions.filter(s => s.cash_games_played > 0);
  
  if (cashgameSessions.length === 0) {
    return getEmptyCashgameStats();
  }
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalPlaytime = 0;
  
  cashgameSessions.forEach(session => {
    totalProfit += parseFloat(session.total_result || 0);
    totalBuyIns += parseFloat(session.total_buy_in || 0);
    totalPlaytime += parseFloat(session.duration_minutes || 0);
  });
  
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

function getEmptyCashgameStats() {
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

/**
 * Calculate statistics for TOURNAMENTS only
 */
function calculateTournamentStats(sessions, games) {
  const tournaments = games.filter(g => ['tournament', 'sng', 'mtt'].includes(g.type));
  
  if (tournaments.length === 0) {
    return getEmptyTournamentStats();
  }
  
  let totalProfit = 0;
  let totalBuyIns = 0;
  let totalEntries = 0;
  let totalPlaytime = 0;
  let itmCount = 0;
  
  tournaments.forEach(t => {
    totalProfit += parseFloat(t.net_result || 0);
    totalBuyIns += parseFloat(t.total_buy_in || 0);
    totalEntries += t.entries || 1;
    totalPlaytime += parseFloat(t.duration_minutes || 0);
    
    if (t.itm === true || parseFloat(t.net_result || 0) > 0) {
      itmCount++;
    }
  });
  
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

function getEmptyTournamentStats() {
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

module.exports = router;