const fs = require("fs");
const path = require("path");
const { sequelize } = require("../models");

async function setupDatabase() {
  try {
    console.log("🚀 Starting database setup...\n");

    console.log("📋 Syncing database schema via Sequelize...");
    await sequelize.sync({ force: true });
    console.log("✅ Database schema created successfully!\n");

    // Create uploads directories
    const dirs = [
      path.join(__dirname, "../uploads"),
      path.join(__dirname, "../uploads/assignments"),
      path.join(__dirname, "../uploads/courses"),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    }
    console.log("");

    console.log("✅ Database setup complete!");
    console.log("\nNext steps:");
    console.log("1. Run: npm run seed (to add sample data)");
    console.log("2. Run: npm start (to start the server)");
  } catch (error) {
    console.error("❌ Database setup failed:", error.message);
    throw error;
  } finally {
    await sequelize.close();
  }
}

setupDatabase().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
