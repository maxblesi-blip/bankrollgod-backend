// routes/index.js
const express = require('express');
const router = express.Router();

// Existing routes
const authRoutes = require('./auth');
const bankrollRoutes = require('./bankrolls');
const sessionRoutes = require('./sessions');
const gameRoutes = require('./games');
const userRoutes = require('./users');
const statisticsRoutes = require('./statistics'); // ← NEU

// Register routes
router.use('/auth', authRoutes);
router.use('/bankrolls', bankrollRoutes);
router.use('/sessions', sessionRoutes);
router.use('/games', gameRoutes);
router.use('/users', userRoutes);
router.use('/statistics', statisticsRoutes); // ← NEU

module.exports = router;