// models/index.js
const { sequelize } = require('../config/database');

// Import models
const Bankroll = require('./Bankroll');
const Session = require('./Session');
const Game = require('./Game');
const User = require('./User');

// ============================================================================
// ASSOCIATIONS
// ============================================================================

// Bankroll <-> Session
Bankroll.hasMany(Session, {
  foreignKey: 'bankroll_id',
  as: 'sessions',
  onDelete: 'CASCADE'
});
Session.belongsTo(Bankroll, {
  foreignKey: 'bankroll_id',
  as: 'bankroll'
});

// Session <-> Game
Session.hasMany(Game, {
  foreignKey: 'session_id',
  as: 'games',
  onDelete: 'CASCADE'
});
Game.belongsTo(Session, {
  foreignKey: 'session_id',
  as: 'session'
});

// User associations
User.hasMany(Bankroll, {
  foreignKey: 'user_id',
  as: 'bankrolls',
  onDelete: 'CASCADE'
});
Bankroll.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

User.hasMany(Session, {
  foreignKey: 'user_id',
  as: 'sessions',
  onDelete: 'CASCADE'
});
Session.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

User.hasMany(Game, {
  foreignKey: 'user_id',
  as: 'games',
  onDelete: 'CASCADE'
});
Game.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

console.log('✅ Model associations loaded');

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  sequelize,
  Bankroll,
  Session,
  Game,
  User
};