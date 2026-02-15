const express = require("express");
const { body, validationResult } = require("express-validator");
const { sequelize, LearningSession, User } = require("../models");
const { authenticateToken, authorize } = require("../middleware/auth");
const { QueryTypes, Op } = require("sequelize");

const router = express.Router();

// Clock-in (Start learning session)
router.post(
  "/clock-in",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const ongoing = await LearningSession.findOne({
        where: { user_id: req.user.id, end_time: null },
        attributes: ["id"],
      });

      if (ongoing) {
        return res
          .status(400)
          .json({ error: "Already clocked in. Please clock out first." });
      }

      const session = await LearningSession.create({
        user_id: req.user.id,
        start_time: new Date(),
      });

      res.status(201).json({
        message: "Clocked in successfully",
        session,
      });
    } catch (error) {
      console.error("Clock-in error:", error);
      res.status(500).json({ error: "Failed to clock in" });
    }
  },
);

// Clock-out (End learning session)
router.post(
  "/clock-out",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const { reflection_text } = req.body;

      const session = await LearningSession.findOne({
        where: { user_id: req.user.id, end_time: null },
        attributes: ["id", "start_time"],
      });

      if (!session) {
        return res
          .status(400)
          .json({ error: "No active session found. Please clock in first." });
      }

      await session.update({
        end_time: new Date(),
        reflection_text: reflection_text || null,
      });

      await session.reload();

      const hours = session.duration_minutes / 60;
      const requiredHours = parseInt(
        process.env.REQUIRED_LEARNING_HOURS || "6",
      );

      res.json({
        message: "Clocked out successfully",
        session,
        hours_completed: hours.toFixed(2),
        meets_requirement: hours >= requiredHours,
        needs_reflection: !reflection_text,
      });
    } catch (error) {
      console.error("Clock-out error:", error);
      res.status(500).json({ error: "Failed to clock out" });
    }
  },
);

// Get today's learning sessions
router.get(
  "/today",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const sessions = await sequelize.query(
        `SELECT id, start_time, end_time, duration_minutes, reflection_text, date
       FROM learning_sessions
       WHERE user_id = :userId AND date = CURRENT_DATE
       ORDER BY start_time DESC`,
        { replacements: { userId: req.user.id }, type: QueryTypes.SELECT },
      );

      const totalMinutes = sessions.reduce(
        (sum, s) => sum + (s.duration_minutes || 0),
        0,
      );
      const requiredHours = parseInt(
        process.env.REQUIRED_LEARNING_HOURS || "6",
      );

      res.json({
        sessions,
        total_hours: (totalMinutes / 60).toFixed(2),
        required_hours: requiredHours,
        meets_requirement: totalMinutes / 60 >= requiredHours,
        has_active_session: sessions.some((s) => !s.end_time),
      });
    } catch (error) {
      console.error("Today sessions error:", error);
      res.status(500).json({ error: "Failed to fetch today's sessions" });
    }
  },
);

// Get learning history (with date range)
router.get(
  "/history",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const { start_date, end_date, limit = 30 } = req.query;

      let query = `
      SELECT date, 
             COUNT(*) as session_count,
             SUM(duration_minutes) as total_minutes,
             STRING_AGG(reflection_text, ' | ') as reflections
      FROM learning_sessions
      WHERE user_id = :userId AND end_time IS NOT NULL
    `;

      const replacements = { userId: req.user.id };

      if (start_date) {
        query += " AND date >= :start_date";
        replacements.start_date = start_date;
      }

      if (end_date) {
        query += " AND date <= :end_date";
        replacements.end_date = end_date;
      }

      query += " GROUP BY date ORDER BY date DESC LIMIT :limit";
      replacements.limit = parseInt(limit);

      const result = await sequelize.query(query, {
        replacements,
        type: QueryTypes.SELECT,
      });

      const history = result.map((row) => ({
        date: row.date,
        session_count: parseInt(row.session_count),
        hours: (row.total_minutes / 60).toFixed(2),
        meets_requirement:
          row.total_minutes / 60 >=
          parseInt(process.env.REQUIRED_LEARNING_HOURS || "6"),
        reflections: row.reflections
          ? row.reflections.split(" | ").filter((r) => r)
          : [],
      }));

      res.json({ history });
    } catch (error) {
      console.error("Learning history error:", error);
      res.status(500).json({ error: "Failed to fetch learning history" });
    }
  },
);

// Get weekly report
router.get(
  "/weekly-report",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const result = await sequelize.query(
        `SELECT 
         DATE_TRUNC('week', date) as week_start,
         COUNT(DISTINCT date) as days_logged,
         SUM(duration_minutes) as total_minutes,
         AVG(duration_minutes) as avg_minutes_per_session
       FROM learning_sessions
       WHERE user_id = :userId 
         AND end_time IS NOT NULL
         AND date >= CURRENT_DATE - INTERVAL '8 weeks'
       GROUP BY week_start
       ORDER BY week_start DESC`,
        { replacements: { userId: req.user.id }, type: QueryTypes.SELECT },
      );

      const requiredHours = parseInt(
        process.env.REQUIRED_LEARNING_HOURS || "6",
      );
      const weeklyReport = result.map((row) => ({
        week_start: row.week_start,
        days_logged: parseInt(row.days_logged),
        total_hours: (row.total_minutes / 60).toFixed(2),
        avg_hours_per_session: (row.avg_minutes_per_session / 60).toFixed(2),
        compliance_percentage: (
          (row.total_minutes / 60 / (requiredHours * 5)) *
          100
        ).toFixed(1),
      }));

      res.json({ weekly_report: weeklyReport });
    } catch (error) {
      console.error("Weekly report error:", error);
      res.status(500).json({ error: "Failed to generate weekly report" });
    }
  },
);

// Get learning streak
router.get(
  "/streak",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const result = await sequelize.query(
        `WITH daily_hours AS (
         SELECT date, SUM(duration_minutes)/60 as hours
         FROM learning_sessions
         WHERE user_id = :userId AND end_time IS NOT NULL
         GROUP BY date
       ),
       streak_data AS (
         SELECT date, hours,
                date - (ROW_NUMBER() OVER (ORDER BY date))::integer AS grp
         FROM daily_hours
         WHERE hours >= :requiredHours
       )
       SELECT COUNT(*) as streak_length, MIN(date) as streak_start, MAX(date) as streak_end
       FROM streak_data
       WHERE grp = (SELECT MAX(grp) FROM streak_data)
       GROUP BY grp`,
        {
          replacements: {
            userId: req.user.id,
            requiredHours: parseInt(process.env.REQUIRED_LEARNING_HOURS || "6"),
          },
          type: QueryTypes.SELECT,
        },
      );

      const streak = result[0] || {
        streak_length: 0,
        streak_start: null,
        streak_end: null,
      };

      res.json({
        current_streak: parseInt(streak.streak_length || 0),
        streak_start: streak.streak_start,
        streak_end: streak.streak_end,
      });
    } catch (error) {
      console.error("Streak calculation error:", error);
      res.status(500).json({ error: "Failed to calculate streak" });
    }
  },
);

// Supervisor: Get team learning summary
router.get(
  "/team-summary",
  authenticateToken,
  authorize("supervisor", "admin"),
  async (req, res) => {
    try {
      const supervisorId = req.user.role === "admin" ? null : req.user.id;

      let query = `
      SELECT u.id, u.full_name, u.email, u.archetype,
             COUNT(DISTINCT ls.date) as days_logged_this_month,
             SUM(ls.duration_minutes) as total_minutes_this_month,
             MAX(ls.date) as last_active_date
      FROM users u
      LEFT JOIN learning_sessions ls ON u.id = ls.user_id 
        AND ls.end_time IS NOT NULL
        AND ls.date >= DATE_TRUNC('month', CURRENT_DATE)
      WHERE u.role = 'learner' AND u.is_active = true
    `;

      const replacements = {};
      if (supervisorId) {
        query += " AND u.supervisor_id = :supervisorId";
        replacements.supervisorId = supervisorId;
      }

      query +=
        " GROUP BY u.id, u.full_name, u.email, u.archetype ORDER BY u.full_name";

      const result = await sequelize.query(query, {
        replacements,
        type: QueryTypes.SELECT,
      });

      const requiredHours = parseInt(
        process.env.REQUIRED_LEARNING_HOURS || "6",
      );
      const workDaysThisMonth = 20;

      const teamSummary = result.map((row) => {
        const totalHours = (row.total_minutes_this_month || 0) / 60;
        const expectedHours = workDaysThisMonth * requiredHours;
        const compliancePercentage = (
          (totalHours / expectedHours) *
          100
        ).toFixed(1);

        return {
          id: row.id,
          full_name: row.full_name,
          email: row.email,
          archetype: row.archetype,
          days_logged: parseInt(row.days_logged_this_month || 0),
          total_hours: totalHours.toFixed(2),
          compliance_percentage: compliancePercentage,
          last_active: row.last_active_date,
          is_idle:
            !row.last_active_date ||
            new Date() - new Date(row.last_active_date) >
              3 * 24 * 60 * 60 * 1000,
        };
      });

      res.json({ team_summary: teamSummary });
    } catch (error) {
      console.error("Team summary error:", error);
      res.status(500).json({ error: "Failed to fetch team summary" });
    }
  },
);

module.exports = router;
