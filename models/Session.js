const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Session = sequelize.define('Session', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 200]
    }
  },
  bankroll_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Bankroll',
      key: 'id'
    }
  },
  status: {
    type: DataTypes.ENUM('running', 'completed', 'paused'),
    allowNull: false,
    defaultValue: 'running'
  },
  start_time: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  end_time: {
    type: DataTypes.DATE,
    allowNull: true
  },
  duration_minutes: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Calculated session duration in minutes'
  },
  // Session Results
  total_buy_in: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    comment: 'Sum of all game buy-ins in this session'
  },
  total_winnings: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    comment: 'Sum of all game results in this session'
  },
  total_result: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00,
    comment: 'Net result (winnings - buy_ins)'
  },
  total_games: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Number of games played in this session'
  },
  total_entries: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    comment: 'Total entries across all games'
  },
  // Session Metadata
  location: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'e.g., "PokerStars", "Bellagio", "Home Game"'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  session_type: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'e.g., "Tournament Grind", "Cash Session", "Mixed Games"'
  },
  // Performance Metrics
  hourly_rate: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: true,
    comment: 'Calculated hourly win/loss rate'
  },
  roi: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    comment: 'Return on Investment for this session'
  },
  // Game Distribution
  tournaments_played: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  cash_games_played: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  sng_played: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  mtt_played: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  indexes: [
    {
      fields: ['bankroll_id']
    },
    {
      fields: ['status']
    },
    {
      fields: ['start_time']
    },
    {
      fields: ['total_result']
    }
  ],
  hooks: {
    beforeSave: (session) => {
      // Calculate duration if end_time is set
      if (session.end_time && session.start_time) {
        const startTime = new Date(session.start_time);
        const endTime = new Date(session.end_time);
        session.duration_minutes = Math.round((endTime - startTime) / (1000 * 60));
      }
      
      // Calculate total_result
      session.total_result = (session.total_winnings || 0) - (session.total_buy_in || 0);
      
      // Calculate hourly rate if session is completed
      if (session.duration_minutes && session.duration_minutes > 0) {
        const hours = session.duration_minutes / 60;
        session.hourly_rate = session.total_result / hours;
      }
      
      // Calculate ROI
      if (session.total_buy_in && session.total_buy_in > 0) {
        session.roi = (session.total_result / session.total_buy_in) * 100;
      }
    }
  }
});

// Instance methods
Session.prototype.completeSession = async function() {
  this.status = 'completed';
  this.end_time = new Date();
  
  // Update stats from games
  await this.updateStatsFromGames();
  await this.save();
  
  // Update bankroll stats
  const bankroll = await this.getBankroll();
  if (bankroll) {
    await bankroll.updateStats();
  }
  
  return this;
};

Session.prototype.updateStatsFromGames = async function() {
  const games = await this.getGames();
  
  let totalBuyIn = 0;
  let totalWinnings = 0;
  let totalEntries = 0;
  let gameTypeCounts = {
    tournament: 0,
    cashgame: 0,
    sng: 0,
    mtt: 0
  };
  
  for (const game of games) {
    totalBuyIn += parseFloat(game.buy_in || 0) * (game.entries || 1);
    totalWinnings += parseFloat(game.winnings || 0);
    totalEntries += game.entries || 1;
    
    // Count game types
    if (gameTypeCounts.hasOwnProperty(game.type)) {
      gameTypeCounts[game.type]++;
    }
  }
  
  this.total_buy_in = totalBuyIn;
  this.total_winnings = totalWinnings;
  this.total_games = games.length;
  this.total_entries = totalEntries;
  this.tournaments_played = gameTypeCounts.tournament;
  this.cash_games_played = gameTypeCounts.cashgame;
  this.sng_played = gameTypeCounts.sng;
  this.mtt_played = gameTypeCounts.mtt;
  
  await this.save();
};

Session.prototype.addGame = async function(gameData) {
  const Game = require('./Game');
  
  gameData.session_id = this.id;
  const game = await Game.create(gameData);
  
  // Update session stats
  await this.updateStatsFromGames();
  
  return game;
};

// Class methods
Session.findActive = function() {
  return this.findAll({
    where: { status: 'running' },
    include: ['Bankroll'],
    order: [['start_time', 'DESC']]
  });
};

Session.findByBankroll = function(bankrollId) {
  return this.findAll({
    where: { bankroll_id: bankrollId },
    order: [['start_time', 'DESC']]
  });
};

Session.findRecent = function(limit = 10) {
  return this.findAll({
    limit,
    order: [['start_time', 'DESC']],
    include: ['Bankroll']
  });
};

module.exports = Session;