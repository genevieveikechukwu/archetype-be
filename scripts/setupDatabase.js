const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function setupDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting database setup...\n');

    // Read and execute schema file
    const schemaPath = path.join(__dirname, '../schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    console.log('📋 Creating database schema...');
    await client.query(schema);
    console.log('✅ Database schema created successfully!\n');

    // Create uploads directory
    const uploadsDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
      console.log('📁 Created uploads directory\n');
    }

    console.log('✅ Database setup complete!');
    console.log('\nNext steps:');
    console.log('1. Run: npm run seed (to add sample data)');
    console.log('2. Run: npm start (to start the server)');
    
  } catch (error) {
    console.error('❌ Database setup failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});