// routes/index.js
const express = require('express');
const router = express.Router();

// Existing routes
const authRoutes = require('./auth'); // falls vorhanden
const bankrollRoutes = require('./bankrolls');
const sessionRoutes = require('./sessions');
const gameRoutes = require('./games');
const userRoutes = require('./users'); // ← NEU HINZUFÜGEN

// Register routes
router.use('/auth', authRoutes); // falls vorhanden
router.use('/bankrolls', bankrollRoutes);
router.use('/sessions', sessionRoutes);
router.use('/games', gameRoutes);
router.use('/users', userRoutes); // ← NEU HINZUFÜGEN

module.exports = router;