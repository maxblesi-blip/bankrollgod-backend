const express = require('express');
const { Pool } = require('pg');
const router = express.Router();

// Database Connection (wird von server.js bereitgestellt)
// Wir verwenden die gleiche Pool-Instanz
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false
});

// GET /api/obs/bankroll/:id - Bankroll-Daten für OBS mit korrekter Berechnung
router.get('/bankroll/:id', async (req, res) => {
  try {
    console.log(`🎥 OBS: Fetching bankroll data for ID: ${req.params.id}`);
    
    const bankrollQuery = await pool.query(
      'SELECT * FROM bankrolls WHERE id = $1',
      [req.params.id]
    );
    
    if (bankrollQuery.rows.length === 0) {
      console.log(`❌ OBS: Bankroll ${req.params.id} not found`);
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }

    const bankroll = bankrollQuery.rows[0];
    
    // Berechne korrekten Profit
    const startingAmount = parseFloat(bankroll.initial_amount) || 0;
    const currentAmount = parseFloat(bankroll.current_amount) || 0;
    const totalProfit = currentAmount - startingAmount;

    const obsData = {
      id: bankroll.id,
      name: bankroll.name,
      type: bankroll.type || 'online',
      currency: 'EUR',  // Standard, da nicht in DB gespeichert
      starting_amount: startingAmount,
      current_amount: currentAmount,
      total_profit: totalProfit,
      goal_amount: parseFloat(bankroll.goal_amount) || 0,
      stakes: bankroll.stakes || '',
      last_updated: new Date().toISOString()
    };

    console.log(`✅ OBS: Bankroll data sent:`, obsData);

    res.json({
      success: true,
      data: obsData
    });

  } catch (error) {
    console.error('❌ OBS: Error fetching bankroll data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch bankroll data',
      error: error.message
    });
  }
});

// GET /api/obs/session/:bankrollId/active - Aktive Session-Daten für OBS mit korrekter Buy-in-Berechnung
router.get('/session/:bankrollId/active', async (req, res) => {
  try {
    console.log(`🎥 OBS: Fetching active session for bankroll ID: ${req.params.bankrollId}`);
    
    // Finde die aktive Session für diese Bankroll
    const sessionQuery = await pool.query(
      `SELECT * FROM sessions 
       WHERE bankroll_id = $1 AND status = 'running' 
       ORDER BY start_time DESC 
       LIMIT 1`,
      [req.params.bankrollId]
    );

    if (sessionQuery.rows.length === 0) {
      console.log(`🎥 OBS: No active session found for bankroll ${req.params.bankrollId}`);
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

    const session = sessionQuery.rows[0];
    console.log(`🎥 OBS: Found active session: ${session.name} (${session.id})`);

    // Hole alle Games für diese Session mit korrekter Buy-in-Berechnung
    const gamesQuery = await pool.query(
      `SELECT 
        COUNT(*) as total_games,
        COALESCE(SUM(buy_in * COALESCE(entries, 1)), 0) as total_buyins,
        COALESCE(SUM(CASE WHEN winnings > 0 THEN winnings ELSE 0 END), 0) as total_cashes,
        COUNT(CASE WHEN winnings > 0 THEN 1 END) as cash_count
       FROM games 
       WHERE session_id = $1`,
      [session.id]
    );

    const gameStats = gamesQuery.rows[0];
    
    // ✅ KORREKTE BERECHNUNG
    const totalBuyins = parseFloat(gameStats.total_buyins) || 0;
    const totalCashes = parseFloat(gameStats.total_cashes) || 0;
    const cashCount = parseInt(gameStats.cash_count) || 0;
    const sessionProfit = totalCashes - totalBuyins;

    // Berechne Session-Dauer
    const startTime = new Date(session.start_time);
    const now = new Date();
    const durationMinutes = Math.floor((now - startTime) / (1000 * 60));

    const obsData = {
      session_id: session.id,
      session_name: session.name,
      status: session.status,
      total_buyins: totalBuyins,
      total_cashes: totalCashes,
      cash_count: cashCount,
      profit: sessionProfit,
      games_count: parseInt(gameStats.total_games) || 0,
      duration_minutes: durationMinutes,
      start_time: session.start_time,
      last_updated: new Date().toISOString()
    };

    console.log(`✅ OBS: Session data sent:`, obsData);

    res.json({
      success: true,
      data: obsData
    });

  } catch (error) {
    console.error('❌ OBS: Error fetching session data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session data',
      error: error.message
    });
  }
});

// GET /api/obs/session/:sessionId/direct - Direkte Session-Daten (alternative Endpoint)
router.get('/session/:sessionId/direct', async (req, res) => {
  try {
    console.log(`🎥 OBS: Fetching direct session data for ID: ${req.params.sessionId}`);
    
    const sessionQuery = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [req.params.sessionId]
    );
    
    if (sessionQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

    const session = sessionQuery.rows[0];

    // Hole alle Games für diese Session
    const gamesQuery = await pool.query(
      `SELECT 
        COUNT(*) as total_games,
        COALESCE(SUM(buy_in * COALESCE(entries, 1)), 0) as total_buyins,
        COALESCE(SUM(CASE WHEN winnings > 0 THEN winnings ELSE 0 END), 0) as total_cashes,
        COUNT(CASE WHEN winnings > 0 THEN 1 END) as cash_count
       FROM games 
       WHERE session_id = $1`,
      [session.id]
    );

    const gameStats = gamesQuery.rows[0];
    
    const totalBuyins = parseFloat(gameStats.total_buyins) || 0;
    const totalCashes = parseFloat(gameStats.total_cashes) || 0;
    const cashCount = parseInt(gameStats.cash_count) || 0;
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
      games_count: parseInt(gameStats.total_games) || 0,
      duration_minutes: durationMinutes,
      start_time: session.start_time,
      end_time: session.end_time,
      last_updated: new Date().toISOString()
    };

    console.log(`✅ OBS: Direct session data sent:`, obsData);

    res.json({
      success: true,
      data: obsData
    });

  } catch (error) {
    console.error('❌ OBS: Error fetching direct session data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch session data',
      error: error.message
    });
  }
});

// GET /api/obs/debug/games/:sessionId - Debug Games-Struktur (TEMPORÄR)
router.get('/debug/games/:sessionId', async (req, res) => {
  try {
    console.log(`🔍 DEBUG: Fetching games structure for session: ${req.params.sessionId}`);
    
    // Hole alle Games für diese Session (ohne Auth)
    const gamesQuery = await pool.query(
      'SELECT * FROM games WHERE session_id = $1 LIMIT 3',
      [req.params.sessionId]
    );
    
    console.log(`🔍 DEBUG: Found ${gamesQuery.rows.length} games`);
    
    if (gamesQuery.rows.length === 0) {
      return res.json({
        success: true,
        message: 'No games found',
        sessionId: req.params.sessionId
      });
    }
    
    const firstGame = gamesQuery.rows[0];
    const allGames = gamesQuery.rows;
    
    // Analysiere alle verfügbaren Spalten
    const columns = Object.keys(firstGame);
    
    // Finde entries-ähnliche Felder
    const entriesFields = columns.filter(col => 
      col.toLowerCase().includes('entr') || 
      col.toLowerCase().includes('count') ||
      col.toLowerCase().includes('multi')
    );
    
    // Finde buy-in-ähnliche Felder  
    const buyinFields = columns.filter(col =>
      col.toLowerCase().includes('buy') ||
      col.toLowerCase().includes('cost') ||
      col.toLowerCase().includes('fee') ||
      col.toLowerCase().includes('stake')
    );
    
    // Teste verschiedene Berechnungen
    const calculations = [];
    
    for (const game of allGames) {
      const calc = {
        gameId: game.id,
        gameName: game.name,
        rawData: {
          entries: game.entries,
          entry_count: game.entry_count,
          buy_in: game.buy_in,
          buyin: game.buyin,
          entry_fee: game.entry_fee,
          winnings: game.winnings
        },
        calculations: {}
      };
      
      // Verschiedene Berechnungsansätze
      if (game.buy_in && game.entries) {
        calc.calculations.buyIn_x_entries = parseFloat(game.buy_in) * parseInt(game.entries || 1);
      }
      if (game.buyin && game.entries) {
        calc.calculations.buyin_x_entries = parseFloat(game.buyin) * parseInt(game.entries || 1);
      }
      if (game.entry_fee && game.entries) {
        calc.calculations.entryFee_x_entries = parseFloat(game.entry_fee) * parseInt(game.entries || 1);
      }
      
      calculations.push(calc);
    }
    
    res.json({
      success: true,
      debug: {
        sessionId: req.params.sessionId,
        totalGames: allGames.length,
        availableColumns: columns,
        entriesFields: entriesFields,
        buyinFields: buyinFields,
        firstGameSample: firstGame,
        calculations: calculations,
        recommendation: {
          entriesField: entriesFields.length > 0 ? entriesFields[0] : 'entries',
          buyinField: buyinFields.length > 0 ? buyinFields[0] : 'buy_in'
        }
      }
    });
    
  } catch (error) {
    console.error('❌ DEBUG Error:', error);
    res.status(500).json({
      success: false,
      message: 'Debug failed',
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
    database: 'PostgreSQL (Raw Queries)',
    endpoints: [
      '/api/obs/bankroll/:id',
      '/api/obs/session/:bankrollId/active',
      '/api/obs/session/:sessionId/direct',
      '/api/obs/debug/games/:sessionId'
    ]
  });
});

module.exports = router;