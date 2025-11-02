const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Game = sequelize.define('Game', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  session_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'Session',
      key: 'id'
    }
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true,
      len: [1, 200]
    }
  },
  type: {
    type: DataTypes.ENUM('tournament', 'cashgame', 'sng', 'mtt'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('running', 'completed', 'busted'),
    allowNull: false,
    defaultValue: 'running'
  },
  // Timing
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
    comment: 'Calculated game duration in minutes'
  },
  // Financial Data
  buy_in: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  entries: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1,
    validate: {
      min: 1,
      max: 20
    }
  },
  total_buy_in: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'buy_in * entries (calculated)'
  },
  winnings: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00
  },
  net_result: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    comment: 'winnings - total_buy_in (calculated)'
  },
  // Tournament Specific
  position_finished: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Final position in tournament'
  },
  total_players: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Total players in tournament'
  },
  prize_pool: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: true,
    comment: 'Total tournament prize pool'
  },
  // Cash Game Specific
  stakes: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'e.g., "NL200", "2/5", "PLO100"'
  },
  table_type: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'e.g., "6-max", "Full Ring", "Heads Up"'
  },
  // Game Details
  location: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'e.g., "PokerStars", "Bellagio", "Home Game"'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  tags: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'Comma-separated tags: "bounty,turbo,deepstack"'
  },
  // Performance Metrics
  roi: {
    type: DataTypes.DECIMAL(6, 2),
    allowNull: true,
    comment: 'Return on Investment percentage for this game'
  },
  itm: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    comment: 'In The Money (for tournaments)'
  }
}, {
  indexes: [
    {
      fields: ['session_id']
    },
    {
      fields: ['type']
    },
    {
      fields: ['status']
    },
    {
      fields: ['start_time']
    },
    {
      fields: ['buy_in']
    },
    {
      fields: ['net_result']
    }
  ],
  hooks: {
    beforeSave: (game) => {
      // Calculate total_buy_in
      game.total_buy_in = parseFloat(game.buy_in) * game.entries;
      
      // Calculate net_result
      game.net_result = parseFloat(game.winnings || 0) - parseFloat(game.total_buy_in);
      
      // Calculate duration if end_time is set
      if (game.end_time && game.start_time) {
        const startTime = new Date(game.start_time);
        const endTime = new Date(game.end_time);
        game.duration_minutes = Math.round((endTime - startTime) / (1000 * 60));
      }
      
      // Calculate ROI
      if (game.total_buy_in && game.total_buy_in > 0) {
        game.roi = (game.net_result / game.total_buy_in) * 100;
      }
      
      // Determine ITM for tournaments
      if (['tournament', 'sng', 'mtt'].includes(game.type) && 
          game.position_finished && game.total_players) {
        // Rough estimate: top 10-15% is ITM
        const itmThreshold = Math.ceil(game.total_players * 0.15);
        game.itm = game.position_finished <= itmThreshold;
      }
    }
  }
});

// Instance methods
Game.prototype.completeGame = async function(winnings = 0, position = null, totalPlayers = null) {
  this.status = 'completed';
  this.end_time = new Date();
  this.winnings = winnings;
  
  if (position) this.position_finished = position;
  if (totalPlayers) this.total_players = totalPlayers;
  
  await this.save();
  
  // Update session stats
  const session = await this.getSession();
  if (session) {
    await session.updateStatsFromGames();
  }
  
  return this;
};

Game.prototype.bustOut = async function() {
  this.status = 'busted';
  this.end_time = new Date();
  this.winnings = 0;
  
  await this.save();
  
  // Update session stats
  const session = await this.getSession();
  if (session) {
    await session.updateStatsFromGames();
  }
  
  return this;
};

Game.prototype.updateEntries = async function(newEntries) {
  if (newEntries < 1) throw new Error('Entries must be at least 1');
  
  this.entries = newEntries;
  await this.save();
  
  // Update session stats
  const session = await this.getSession();
  if (session) {
    await session.updateStatsFromGames();
  }
  
  return this;
};

// Class methods
Game.findActive = function() {
  return this.findAll({
    where: { status: 'running' },
    order: [['start_time', 'DESC']]
  });
};

Game.findBySession = function(sessionId) {
  return this.findAll({
    where: { session_id: sessionId },
    order: [['start_time', 'DESC']]
  });
};

Game.findByType = function(type) {
  return this.findAll({
    where: { type },
    order: [['start_time', 'DESC']]
  });
};

Game.getStats = async function(filters = {}) {
  const whereClause = {};
  
  if (filters.type) whereClause.type = filters.type;
  if (filters.status) whereClause.status = filters.status;
  if (filters.session_id) whereClause.session_id = filters.session_id;
  
  const games = await this.findAll({ where: whereClause });
  
  if (games.length === 0) return null;
  
  const totalGames = games.length;
  const totalBuyIn = games.reduce((sum, game) => sum + parseFloat(game.total_buy_in || 0), 0);
  const totalWinnings = games.reduce((sum, game) => sum + parseFloat(game.winnings || 0), 0);
  const totalResult = totalWinnings - totalBuyIn;
  const winningGames = games.filter(game => parseFloat(game.net_result || 0) > 0).length;
  const winRate = (winningGames / totalGames) * 100;
  const avgBuyIn = totalBuyIn / totalGames;
  const avgResult = totalResult / totalGames;
  const roi = totalBuyIn > 0 ? (totalResult / totalBuyIn) * 100 : 0;
  
  return {
    totalGames,
    totalBuyIn,
    totalWinnings,
    totalResult,
    winningGames,
    winRate,
    avgBuyIn,
    avgResult,
    roi
  };
};

module.exports = Game;