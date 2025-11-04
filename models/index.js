// models/index.js
// Sequelize Model Associations & Exports

const { sequelize } = require('../config/database');

// Import all models
const Bankroll = require('./Bankroll');
const Session = require('./Session');
const Game = require('./Game');
const User = require('./User'); // Falls vorhanden

// ============================================================================
// ASSOCIATIONS
// ============================================================================

// Bankroll <-> Session (One-to-Many)
Bankroll.hasMany(Session, {
  foreignKey: 'bankroll_id',
  as: 'sessions',
  onDelete: 'CASCADE'
});
Session.belongsTo(Bankroll, {
  foreignKey: 'bankroll_id',
  as: 'bankroll'
});

// Session <-> Game (One-to-Many)
Session.hasMany(Game, {
  foreignKey: 'session_id',
  as: 'games',
  onDelete: 'CASCADE'
});
Game.belongsTo(Session, {
  foreignKey: 'session_id',
  as: 'session'
});

// User <-> Bankroll (One-to-Many)
User.hasMany(Bankroll, {
  foreignKey: 'user_id',
  as: 'bankrolls',
  onDelete: 'CASCADE'
});
Bankroll.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// User <-> Session (One-to-Many)
User.hasMany(Session, {
  foreignKey: 'user_id',
  as: 'sessions',
  onDelete: 'CASCADE'
});
Session.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

// User <-> Game (One-to-Many)
User.hasMany(Game, {
  foreignKey: 'user_id',
  as: 'games',
  onDelete: 'CASCADE'
});
Game.belongsTo(User, {
  foreignKey: 'user_id',
  as: 'user'
});

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