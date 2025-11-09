// routes/obs.js - Neue Datei erstellen
const express = require('express');
const router = express.Router();
// Importiere deine DB Models (anpassen an deine Struktur)
const Bankroll = require('../models/Bankroll');
const Session = require('../models/Session');

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
    
    const bankroll = await Bankroll.findById(bankrollId);
    
    if (!bankroll) {
      return res.status(404).json({
        success: false,
        message: 'Bankroll not found'
      });
    }

    const publicData = {
      name: bankroll.name,
      current_amount: bankroll.current_amount,
      starting_amount: bankroll.starting_amount,
      currency: bankroll.currency || 'EUR',
      type: bankroll.type
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
    
    const activeSession = await Session.findOne({
      bankroll_id: bankrollId,
      status: 'active'
    }).sort({ created_at: -1 });

    if (!activeSession) {
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

    const sessionData = {
      total_buyins: activeSession.total_buyins || 0,
      total_cashes: activeSession.total_cashes || 0,
      cash_count: activeSession.cash_count || 0,
      session_name: activeSession.name || 'Aktive Session',
      profit: (activeSession.total_cashes || 0) - (activeSession.total_buyins || 0)
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