const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const path = require("path");
require("dotenv").config();

const { sequelize } = require("./models");

// Import routes
const authRoutes = require("./routes/auth");
const learningRoutes = require("./routes/learning");
const courseRoutes = require("./routes/courses");
const testRoutes = require("./routes/tests");
const skillRoutes = require("./routes/skills");
const mentorshipRoutes = require("./routes/mentorship");
const dashboardRoutes = require("./routes/dashboard");
const adminRoutes = require("./routes/admin");
const supervisorRoutes = require("./routes/supervisor");
const feedbackRoutes = require("./routes/feedback");
const candidateTestRoutes = require("./routes/candidateTests");
const assignmentRoutes = require("./routes/assignments");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(morgan("combined")); // Logging
app.use(express.json({ limit: "10mb" })); // JSON parser
app.use(express.urlencoded({ extended: true }));

// Static files for uploads
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  });
});

// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/learning", learningRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/tests", testRoutes);
app.use("/api/skills", skillRoutes);
app.use("/api/mentorship", mentorshipRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/supervisor", supervisorRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/candidate/tests", candidateTestRoutes);
app.use("/api/assignments", assignmentRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error("Global error handler:", err);

  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

// Start server
const startServer = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ alter: true }); // Sync models with database
    console.log("Database connection established successfully.");

    app.listen(PORT, () => {
      console.log(`
   ArchetypeOS Learning Platform              
                                                       
  Server running on: http://localhost:${PORT}          
  Environment: ${process.env.NODE_ENV || "development"}                       
                                                       
  API Documentation:                                   
  - Auth:       /api/auth                              
  - Learning:   /api/learning                          
  - Courses:    /api/courses                           
  - Tests:      /api/tests                             
  - Skills:     /api/skills                            
  - Mentorship: /api/mentorship                        
  - Dashboard:  /api/dashboard                         
                                                       
      `);
    });
  } catch (error) {
    console.error("Unable to connect to the database:", error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully...");
  process.exit(0);
});

module.exports = app;
