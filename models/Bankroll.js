const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Bankroll = sequelize.define('Bankroll', {
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
      len: [1, 100]
    }
  },
  type: {
    type: DataTypes.ENUM('online', 'live'),
    allowNull: false,
    defaultValue: 'online'
  },
  currency: {
    type: DataTypes.STRING(3),
    allowNull: false,
    defaultValue: 'USD',
    validate: {
      isIn: [['USD', 'EUR', 'GBP', 'CAD', 'AUD']]
    }
  },
  starting_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  current_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    validate: {
      min: 0
    }
  },
  goal_amount: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true,
    validate: {
      min: 0
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  stakes: {
    type: DataTypes.STRING,
    allowNull: true,
    comment: 'e.g., "NL200", "2/5", "$215 MTT"'
  },
  is_active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  // Statistics (calculated fields)
  total_sessions: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  total_games: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  total_winnings: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00
  },
  total_buy_ins: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00
  },
  best_session: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00
  },
  worst_session: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0.00
  },
  win_rate: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Percentage of winning sessions'
  },
  roi: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0.00,
    comment: 'Return on Investment percentage'
  },
  // Metadata
  last_session_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  created_by: {
    type: DataTypes.UUID,
    allowNull: true,
    comment: 'User ID - for future multi-user support'
  }
}, {
  indexes: [
    {
      fields: ['name']
    },
    {
      fields: ['type']
    },
    {
      fields: ['is_active']
    },
    {
      fields: ['created_by']
    }
  ],
  hooks: {
    beforeValidate: (bankroll) => {
      // Ensure current_amount starts as starting_amount for new bankrolls
      if (bankroll.isNewRecord && !bankroll.current_amount) {
        bankroll.current_amount = bankroll.starting_amount;
      }
    }
  }
});

// Instance methods
Bankroll.prototype.updateStats = async function() {
  const sessions = await this.getSessions();
  
  this.total_sessions = sessions.length;
  
  let totalWinnings = 0;
  let totalBuyIns = 0;
  let totalGames = 0;
  let bestSession = 0;
  let worstSession = 0;
  let winningSessions = 0;
  
  for (const session of sessions) {
    const sessionResult = session.total_result || 0;
    const sessionBuyIn = session.total_buy_in || 0;
    
    totalWinnings += sessionResult;
    totalBuyIns += sessionBuyIn;
    totalGames += session.total_games || 0;
    
    if (sessionResult > bestSession) bestSession = sessionResult;
    if (sessionResult < worstSession) worstSession = sessionResult;
    if (sessionResult > 0) winningSessions++;
  }
  
  this.total_winnings = totalWinnings;
  this.total_buy_ins = totalBuyIns;
  this.total_games = totalGames;
  this.best_session = bestSession;
  this.worst_session = worstSession;
  this.win_rate = sessions.length > 0 ? (winningSessions / sessions.length) * 100 : 0;
  this.roi = totalBuyIns > 0 ? (totalWinnings / totalBuyIns) * 100 : 0;
  
  // Update current_amount based on starting_amount + total_winnings
  this.current_amount = parseFloat(this.starting_amount) + totalWinnings;
  
  await this.save();
};

// Class methods
Bankroll.findActive = function() {
  return this.findAll({
    where: { is_active: true },
    order: [['updated_at', 'DESC']]
  });
};

module.exports = Bankroll;