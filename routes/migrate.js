// routes/migrate.js
const express = require('express');
const router = express.Router();
const { sequelize } = require('../config/database');

router.post('/migrate', async (req, res) => {
  console.log('🔧 Starting migration...');
  
  try {
    const queryInterface = sequelize.getQueryInterface();
    const results = [];
    
    // 1. Currency column
    try {
      await queryInterface.addColumn('bankrolls', 'currency', {
        type: sequelize.Sequelize.STRING(3),
        defaultValue: 'USD',
        allowNull: false
      });
      results.push('✅ Currency column added');
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
        results.push('⚠️ Currency column already exists');
      } else {
        throw error;
      }
    }
    
    // 2. Winnings column
    try {
      await queryInterface.addColumn('games', 'winnings', {
        type: sequelize.Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: false
      });
      results.push('✅ Winnings column added');
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
        results.push('⚠️ Winnings column already exists');
      } else {
        throw error;
      }
    }
    
    // 3. Net profit column
    try {
      await queryInterface.addColumn('games', 'net_profit', {
        type: sequelize.Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: false
      });
      results.push('✅ Net_profit column added');
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('Duplicate')) {
        results.push('⚠️ Net_profit column already exists');
      } else {
        throw error;
      }
    }
    
    // 4. Update existing data
    await sequelize.query(`
      UPDATE bankrolls 
      SET currency = 'USD' 
      WHERE currency IS NULL OR currency = ''
    `);
    results.push('✅ Updated existing bankrolls');
    
    console.log('✅ Migration completed!');
    
    res.json({
      success: true,
      message: 'Migration completed successfully',
      results: results
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;