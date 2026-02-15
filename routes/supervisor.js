const express = require("express");
const { sequelize, Notification, User } = require("../models");
const { authenticateToken, authorize } = require("../middleware/auth");
const { QueryTypes } = require("sequelize");

const router = express.Router();

// Get learner time analytics
router.get(
  "/learners/:learnerId/time-analytics",
  authenticateToken,
  authorize("supervisor", "admin"),
  async (req, res) => {
    try {
      const { learnerId } = req.params;
      const { period } = req.query;

      let dateFilter = "";
      let groupBy = "";

      switch (period) {
        case "daily":
          dateFilter = "AND ls.date >= CURRENT_DATE - INTERVAL '30 days'";
          groupBy = "ls.date";
          break;
        case "weekly":
          dateFilter = "AND ls.date >= CURRENT_DATE - INTERVAL '12 weeks'";
          groupBy = "DATE_TRUNC('week', ls.date)";
          break;
        case "monthly":
          dateFilter = "AND ls.date >= CURRENT_DATE - INTERVAL '12 months'";
          groupBy = "DATE_TRUNC('month', ls.date)";
          break;
        case "yearly":
          groupBy = "DATE_TRUNC('year', ls.date)";
          break;
        default:
          dateFilter = "AND ls.date >= CURRENT_DATE - INTERVAL '30 days'";
          groupBy = "ls.date";
      }

      const analytics = await sequelize.query(
        `
      SELECT ${groupBy} as period,
             SUM(ls.duration_minutes)/60 as total_hours,
             COUNT(DISTINCT ls.date) as days_active,
             COUNT(*) as session_count
      FROM learning_sessions ls
      WHERE ls.user_id = :learnerId AND ls.end_time IS NOT NULL ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY period DESC
    `,
        { replacements: { learnerId }, type: QueryTypes.SELECT },
      );

      res.json({ analytics });
    } catch (error) {
      console.error("Time analytics error:", error);
      res.status(500).json({ error: "Failed to fetch time analytics" });
    }
  },
);

// Get learner compliance rating
router.get(
  "/learners/:learnerId/compliance",
  authenticateToken,
  authorize("supervisor", "admin"),
  async (req, res) => {
    try {
      const { learnerId } = req.params;

      const [stats] = await sequelize.query(
        `
      SELECT 
        COUNT(DISTINCT date) as days_logged,
        SUM(duration_minutes)/60 as total_hours,
        AVG(duration_minutes)/60 as avg_hours_per_day,
        COUNT(DISTINCT CASE WHEN duration_minutes >= 360 THEN date END) as days_met_goal
      FROM learning_sessions
      WHERE user_id = :learnerId AND end_time IS NOT NULL
        AND date >= CURRENT_DATE - INTERVAL '30 days'
    `,
        { replacements: { learnerId }, type: QueryTypes.SELECT },
      );

      const workDays = 20;
      const requiredHours = 6;
      const expectedHours = workDays * requiredHours;

      const complianceRate = (
        (parseInt(stats.days_met_goal) / workDays) *
        100
      ).toFixed(1);
      const diligenceScore = (
        (parseFloat(stats.total_hours) / expectedHours) *
        100
      ).toFixed(1);

      res.json({
        compliance: {
          days_logged: parseInt(stats.days_logged),
          days_met_goal: parseInt(stats.days_met_goal),
          total_hours: parseFloat(stats.total_hours).toFixed(2),
          avg_hours_per_day: parseFloat(stats.avg_hours_per_day).toFixed(2),
          compliance_rate: parseFloat(complianceRate),
          diligence_score: parseFloat(diligenceScore),
          status:
            diligenceScore >= 80
              ? "excellent"
              : diligenceScore >= 60
                ? "good"
                : diligenceScore >= 40
                  ? "needs_improvement"
                  : "critical",
        },
      });
    } catch (error) {
      console.error("Compliance check error:", error);
      res.status(500).json({ error: "Failed to check compliance" });
    }
  },
);

// Flag a learner
router.post(
  "/learners/:learnerId/flag",
  authenticateToken,
  authorize("supervisor", "admin"),
  async (req, res) => {
    try {
      const { learnerId } = req.params;
      const { reason, severity } = req.body;

      await Notification.create({
        user_id: learnerId,
        title: "⚠️ Performance Alert",
        message: `You have been flagged by your supervisor. Reason: ${reason}`,
        notification_type: "warning",
      });

      // Also notify admins
      const admins = await User.findAll({
        where: { role: "admin" },
        attributes: ["id"],
      });

      for (const admin of admins) {
        await Notification.create({
          user_id: admin.id,
          title: `Learner Flagged - ${severity}`,
          message: `Learner ID ${learnerId} has been flagged. Reason: ${reason}`,
          notification_type: "flag",
        });
      }

      res.json({ message: "Learner flagged successfully" });
    } catch (error) {
      console.error("Flag learner error:", error);
      res.status(500).json({ error: "Failed to flag learner" });
    }
  },
);

// Get all learners under supervisor
router.get(
  "/my-learners",
  authenticateToken,
  authorize("supervisor"),
  async (req, res) => {
    try {
      const learners = await sequelize.query(
        `
      SELECT u.id, u.full_name, u.email, u.archetype,
             COUNT(DISTINCT ls.date) as days_logged_this_month,
             SUM(ls.duration_minutes)/60 as total_hours_this_month,
             MAX(ls.date) as last_active_date
      FROM users u
      LEFT JOIN learning_sessions ls ON u.id = ls.user_id 
        AND ls.end_time IS NOT NULL
        AND ls.date >= DATE_TRUNC('month', CURRENT_DATE)
      WHERE u.supervisor_id = :supervisorId AND u.role = 'learner' AND u.is_active = true
      GROUP BY u.id, u.full_name, u.email, u.archetype
      ORDER BY u.full_name
    `,
        {
          replacements: { supervisorId: req.user.id },
          type: QueryTypes.SELECT,
        },
      );

      res.json({ learners });
    } catch (error) {
      console.error("Fetch learners error:", error);
      res.status(500).json({ error: "Failed to fetch learners" });
    }
  },
);

module.exports = router;
