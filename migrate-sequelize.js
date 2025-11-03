// migrate-sequelize.js
const { sequelize } = require('./config/database');

async function runMigration() {
  console.log('🔧 Starting Sequelize migration...');
  
  try {
    const queryInterface = sequelize.getQueryInterface();
    
    // 1. Füge currency Spalte zu bankrolls hinzu
    console.log('Adding currency column to bankrolls...');
    try {
      await queryInterface.addColumn('bankrolls', 'currency', {
        type: sequelize.Sequelize.STRING(3),
        defaultValue: 'USD',
        allowNull: false
      });
      console.log('✅ Currency column added');
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('Duplicate column')) {
        console.log('⚠️  Currency column already exists - skipping');
      } else {
        throw error;
      }
    }
    
    // 2. Füge winnings Spalte zu games hinzu
    console.log('Adding winnings column to games...');
    try {
      await queryInterface.addColumn('games', 'winnings', {
        type: sequelize.Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: false
      });
      console.log('✅ Winnings column added');
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('Duplicate column')) {
        console.log('⚠️  Winnings column already exists - skipping');
      } else {
        throw error;
      }
    }
    
    // 3. Füge net_profit Spalte zu games hinzu
    console.log('Adding net_profit column to games...');
    try {
      await queryInterface.addColumn('games', 'net_profit', {
        type: sequelize.Sequelize.DECIMAL(10, 2),
        defaultValue: 0.00,
        allowNull: false
      });
      console.log('✅ Net_profit column added');
    } catch (error) {
      if (error.message.includes('already exists') || error.message.includes('Duplicate column')) {
        console.log('⚠️  Net_profit column already exists - skipping');
      } else {
        throw error;
      }
    }
    
    // 4. Update bestehende bankrolls
    console.log('Updating existing bankrolls...');
    await sequelize.query(`
      UPDATE bankrolls 
      SET currency = 'USD' 
      WHERE currency IS NULL OR currency = ''
    `);
    console.log('✅ Existing bankrolls updated');
    
    // 5. Verifizierung
    console.log('\n📊 Verifying migration...');
    
    const [bankrollColumns] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'bankrolls'
    `);
    
    const [gameColumns] = await sequelize.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'games'
    `);
    
    const bankrollCols = bankrollColumns.map(c => c.column_name || c.COLUMN_NAME);
    const gameCols = gameColumns.map(c => c.column_name || c.COLUMN_NAME);
    
    console.log('Bankroll columns:', bankrollCols);
    console.log('Game columns:', gameCols);
    
    if (bankrollCols.includes('currency')) {
      console.log('✅ bankrolls.currency exists');
    } else {
      console.log('❌ bankrolls.currency NOT found');
    }
    
    if (gameCols.includes('winnings')) {
      console.log('✅ games.winnings exists');
    } else {
      console.log('❌ games.winnings NOT found');
    }
    
    if (gameCols.includes('net_profit')) {
      console.log('✅ games.net_profit exists');
    } else {
      console.log('❌ games.net_profit NOT found');
    }
    
    console.log('\n🎉 Migration completed successfully!');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

// Migration ausführen
runMigration();