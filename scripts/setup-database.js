// scripts/setup-database.js
// Database Setup Script für BankrollGod Production Backend

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function setupDatabase() {
  console.log('🚀 Setting up BankrollGod Production Database...');
  
  try {
    // Test connection
    const client = await pool.connect();
    console.log('✅ Database connection successful');
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    console.log('📋 Executing database schema...');
    await client.query(schema);
    console.log('✅ Database schema created successfully');
    
    // Check if tables were created
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    
    console.log('📊 Created tables:');
    tableCheck.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    // Check indexes
    const indexCheck = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND indexname NOT LIKE '%_pkey'
      ORDER BY indexname;
    `);
    
    console.log('🔗 Created indexes:');
    indexCheck.rows.forEach(row => {
      console.log(`  - ${row.indexname}`);
    });
    
    client.release();
    console.log('🎉 Database setup completed successfully!');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error);
    console.error('Error details:', error.message);
    
    if (error.code) {
      console.error('Error code:', error.code);
    }
    
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Health check function
async function healthCheck() {
  console.log('🏥 Running database health check...');
  
  try {
    const client = await pool.connect();
    
    // Test basic connectivity
    const result = await client.query('SELECT NOW() as current_time, version() as pg_version');
    console.log('✅ Database connectivity: OK');
    console.log(`⏰ Current time: ${result.rows[0].current_time}`);
    console.log(`🗄️ PostgreSQL version: ${result.rows[0].pg_version.split(' ')[0]} ${result.rows[0].pg_version.split(' ')[1]}`);
    
    // Check tables exist
    const tables = await client.query(`
      SELECT table_name, 
             (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
      FROM information_schema.tables t
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    
    console.log('📋 Table status:');
    const expectedTables = ['users', 'bankrolls', 'sessions', 'games'];
    expectedTables.forEach(tableName => {
      const table = tables.rows.find(t => t.table_name === tableName);
      if (table) {
        console.log(`  ✅ ${tableName} (${table.column_count} columns)`);
      } else {
        console.log(`  ❌ ${tableName} (missing)`);
      }
    });
    
    // Check extensions
    const extensions = await client.query(`
      SELECT extname, extversion 
      FROM pg_extension 
      WHERE extname IN ('uuid-ossp');
    `);
    
    console.log('🔧 Extensions:');
    extensions.rows.forEach(ext => {
      console.log(`  ✅ ${ext.extname} v${ext.extversion}`);
    });
    
    // Test user view
    const viewCheck = await client.query(`
      SELECT COUNT(*) as user_count FROM user_stats;
    `);
    console.log(`👥 User stats view: ${viewCheck.rows[0].user_count} users`);
    
    client.release();
    console.log('🎉 Database health check passed!');
    
  } catch (error) {
    console.error('❌ Database health check failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Reset database (careful!)
async function resetDatabase() {
  console.log('⚠️  WARNING: This will delete ALL data!');
  console.log('🕐 Waiting 5 seconds... Press Ctrl+C to cancel');
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  console.log('🗑️  Resetting database...');
  
  try {
    const client = await pool.connect();
    
    // Drop all tables in correct order (respecting foreign keys)
    const dropQueries = [
      'DROP TABLE IF EXISTS games CASCADE;',
      'DROP TABLE IF EXISTS sessions CASCADE;',
      'DROP TABLE IF EXISTS bankrolls CASCADE;',
      'DROP TABLE IF EXISTS users CASCADE;',
      'DROP VIEW IF EXISTS user_stats CASCADE;',
      'DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;'
    ];
    
    for (const query of dropQueries) {
      await client.query(query);
    }
    
    console.log('✅ All tables dropped');
    
    client.release();
    console.log('🎉 Database reset completed!');
    console.log('💡 Run "npm run setup-db" to recreate the schema');
    
  } catch (error) {
    console.error('❌ Database reset failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Command line interface
const command = process.argv[2];

switch (command) {
  case 'setup':
    setupDatabase();
    break;
  case 'health':
    healthCheck();
    break;
  case 'reset':
    resetDatabase();
    break;
  default:
    console.log('🛠️  BankrollGod Database Setup');
    console.log('');
    console.log('Available commands:');
    console.log('  setup  - Create database schema and indexes');
    console.log('  health - Check database health and connectivity');
    console.log('  reset  - Drop all tables (DANGEROUS!)');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/setup-database.js setup');
    console.log('  node scripts/setup-database.js health');
    console.log('  node scripts/setup-database.js reset');
    console.log('');
    console.log('Or use npm scripts:');
    console.log('  npm run setup-db');
    break;
}

module.exports = { setupDatabase, healthCheck, resetDatabase };