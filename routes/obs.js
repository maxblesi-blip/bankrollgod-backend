// routes/obs.js - OBS Public Endpoints
const express = require('express');
const router = express.Router();

// OBS Health Check
router.get('/status', (req, res) => {
  res.json({
    success: true,
    message: 'OBS API running',
    timestamp: new Date().toISOString()
  });
});

// OBS Bankroll Data (OHNE Auth)
router.get('/bankroll/:id', async (req, res) => {
  try {
    const bankrollId = req.params.id;
    
    // Pool aus der Haupt-App importieren - das müssen wir anpassen
    const { pool } = require('../app'); // oder direkt DB connection
    
    const bankroll = await pool.query(
      'SELECT name, current_amount, starting_amount, currency, type FROM bankrolls WHERE id = $1',
      [bankrollId]
    );
    
    if (bankroll.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }

    const publicData = {
      name: bankroll.rows[0].name,
      current_amount: bankroll.rows[0].current_amount,
      starting_amount: bankroll.rows[0].starting_amount,
      currency: bankroll.rows[0].currency || 'EUR',
      type: bankroll.rows[0].type
    };

    res.json({
      success: true,
      data: publicData
    });

  } catch (error) {
    console.error('OBS Bankroll Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// OBS Active Session Data (OHNE Auth)
router.get('/session/:bankrollId/active', async (req, res) => {
  try {
    const bankrollId = req.params.bankrollId;
    
    const { pool } = require('../app'); // DB connection
    
    const activeSession = await pool.query(
      `SELECT name, total_result, total_games, duration_minutes, 
              total_invested, total_winnings 
       FROM sessions 
       WHERE bankroll_id = $1 AND status = $2
       ORDER BY start_time DESC LIMIT 1`,
      [bankrollId, 'running']
    );

    if (activeSession.rows.length === 0) {
      return res.json({
        success: true,
        data: {
          total_buyins: 0,
          total_cashes: 0,
          cash_count: 0,
          session_name: 'Keine aktive Session',
          profit: 0
        }
      });
    }

    const session = activeSession.rows[0];
    const sessionData = {
      total_buyins: session.total_invested || 0,
      total_cashes: session.total_winnings || 0,
      cash_count: session.total_games || 0,
      session_name: session.name || 'Aktive Session',
      profit: session.total_result || 0
    };

    res.json({
      success: true,
      data: sessionData
    });

  } catch (error) {
    console.error('OBS Session Error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;