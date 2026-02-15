const express = require("express");
const { sequelize } = require("../models");
const { authenticateToken, authorize } = require("../middleware/auth");
const { QueryTypes } = require("sequelize");

const router = express.Router();

// Individual learner dashboard
router.get(
  "/learner",
  authenticateToken,
  authorize("learner"),
  async (req, res) => {
    try {
      const userId = req.user.id;

      const [coursesResult] = await sequelize
        .query(
          `SELECT 
         COUNT(*) as total_enrolled,
         COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) as completed,
         AVG(progress_percentage) as avg_progress
       FROM enrollments
       WHERE user_id = :userId`,
          { replacements: { userId }, type: QueryTypes.SELECT },
        )
        .then((r) => [
          r[0] || { total_enrolled: 0, completed: 0, avg_progress: 0 },
        ]);

      const [hoursResult] = await sequelize
        .query(
          `SELECT 
         SUM(duration_minutes)/60 as total_hours,
         COUNT(DISTINCT date) as days_logged
       FROM learning_sessions
       WHERE user_id = :userId 
         AND end_time IS NOT NULL
         AND date >= DATE_TRUNC('month', CURRENT_DATE)`,
          { replacements: { userId }, type: QueryTypes.SELECT },
        )
        .then((r) => [r[0] || { total_hours: 0, days_logged: 0 }]);

      const streakResult = await sequelize.query(
        `WITH daily_hours AS (
         SELECT date, SUM(duration_minutes)/60 as hours
         FROM learning_sessions
         WHERE user_id = :userId AND end_time IS NOT NULL
         GROUP BY date
       ),
       streak_data AS (
         SELECT date,
                date - (ROW_NUMBER() OVER (ORDER BY date))::integer AS grp
         FROM daily_hours
         WHERE hours >= :requiredHours
       )
       SELECT COUNT(*) as streak_length
       FROM streak_data
       WHERE grp = (SELECT MAX(grp) FROM streak_data)
       GROUP BY grp`,
        {
          replacements: {
            userId,
            requiredHours: parseInt(process.env.REQUIRED_LEARNING_HOURS || "6"),
          },
          type: QueryTypes.SELECT,
        },
      );

      const testsResult = await sequelize.query(
        `SELECT t.title, ta.score, ta.graded_at
       FROM test_attempts ta
       JOIN tests t ON ta.test_id = t.id
       WHERE ta.user_id = :userId AND ta.status = 'graded'
       ORDER BY ta.graded_at DESC
       LIMIT 5`,
        { replacements: { userId }, type: QueryTypes.SELECT },
      );

      const [kudosResult] = await sequelize
        .query(
          "SELECT SUM(points) as total FROM kudos WHERE to_user_id = :userId",
          { replacements: { userId }, type: QueryTypes.SELECT },
        )
        .then((r) => [r[0] || { total: 0 }]);

      const skillsResult = await sequelize.query(
        `SELECT s.name, us.level
       FROM user_skills us
       JOIN skills s ON us.skill_id = s.id
       WHERE us.user_id = :userId
       ORDER BY us.level DESC
       LIMIT 5`,
        { replacements: { userId }, type: QueryTypes.SELECT },
      );

      const totalEnrolled = parseInt(coursesResult.total_enrolled || 0);
      const completed = parseInt(coursesResult.completed || 0);
      const progressPercentage =
        totalEnrolled > 0 ? ((completed / totalEnrolled) * 100).toFixed(1) : 0;

      res.json({
        overview: {
          courses_enrolled: totalEnrolled,
          courses_completed: completed,
          progress_percentage: progressPercentage,
          avg_course_progress: parseFloat(
            coursesResult.avg_progress || 0,
          ).toFixed(1),
        },
        learning_hours: {
          total_hours_this_month: parseFloat(
            hoursResult.total_hours || 0,
          ).toFixed(2),
          days_logged_this_month: parseInt(hoursResult.days_logged || 0),
          current_streak: parseInt(streakResult[0]?.streak_length || 0),
        },
        recent_tests: testsResult,
        kudos_points: parseInt(kudosResult.total || 0),
        top_skills: skillsResult.map((s) => ({
          name: s.name,
          level: parseFloat(s.level),
        })),
      });
    } catch (error) {
      console.error("Learner dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch dashboard data" });
    }
  },
);

// Supervisor dashboard
router.get(
  "/supervisor",
  authenticateToken,
  authorize("supervisor"),
  async (req, res) => {
    try {
      const supervisorId = req.user.id;

      const [teamResult] = await sequelize
        .query(
          "SELECT COUNT(*) as count FROM users WHERE supervisor_id = :supervisorId AND is_active = true",
          { replacements: { supervisorId }, type: QueryTypes.SELECT },
        )
        .then((r) => [r[0] || { count: 0 }]);

      const complianceResult = await sequelize.query(
        `SELECT 
         u.id, u.full_name,
         COUNT(DISTINCT ls.date) as days_logged,
         SUM(ls.duration_minutes)/60 as total_hours,
         MAX(ls.date) as last_active
       FROM users u
       LEFT JOIN learning_sessions ls ON u.id = ls.user_id 
         AND ls.end_time IS NOT NULL
         AND ls.date >= DATE_TRUNC('month', CURRENT_DATE)
       WHERE u.supervisor_id = :supervisorId AND u.is_active = true
       GROUP BY u.id, u.full_name`,
        { replacements: { supervisorId }, type: QueryTypes.SELECT },
      );

      const requiredHours = parseInt(
        process.env.REQUIRED_LEARNING_HOURS || "6",
      );
      const workDays = 20;
      const requiredMonthlyHours = requiredHours * workDays;

      const teamMembers = complianceResult.map((member) => {
        const totalHours = parseFloat(member.total_hours || 0);
        const compliance = ((totalHours / requiredMonthlyHours) * 100).toFixed(
          1,
        );
        const isIdle =
          !member.last_active ||
          new Date() - new Date(member.last_active) > 3 * 24 * 60 * 60 * 1000;

        return {
          id: member.id,
          name: member.full_name,
          days_logged: parseInt(member.days_logged || 0),
          total_hours: totalHours.toFixed(2),
          compliance_percentage: parseFloat(compliance),
          last_active: member.last_active,
          is_idle: isIdle,
        };
      });

      const [pendingResult] = await sequelize
        .query(
          `SELECT COUNT(*) as count
       FROM test_attempts ta
       JOIN tests t ON ta.test_id = t.id
       JOIN users u ON ta.user_id = u.id
       WHERE u.supervisor_id = :supervisorId 
         AND ta.status = 'submitted'
         AND t.test_type != 'multiple_choice'`,
          { replacements: { supervisorId }, type: QueryTypes.SELECT },
        )
        .then((r) => [r[0] || { count: 0 }]);

      const avgCompliance =
        teamMembers.length > 0
          ? teamMembers.reduce((sum, m) => sum + m.compliance_percentage, 0) /
            teamMembers.length
          : 0;
      const idleCount = teamMembers.filter((m) => m.is_idle).length;

      res.json({
        team_overview: {
          total_members: parseInt(teamResult.count),
          avg_compliance: avgCompliance.toFixed(1),
          idle_members: idleCount,
          pending_test_grades: parseInt(pendingResult.count),
        },
        team_members: teamMembers.sort(
          (a, b) => b.compliance_percentage - a.compliance_percentage,
        ),
      });
    } catch (error) {
      console.error("Supervisor dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch supervisor dashboard" });
    }
  },
);

// Admin dashboard
router.get(
  "/admin",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const [usersResult] = await sequelize.query(
        `SELECT 
         COUNT(*) as total,
         COUNT(CASE WHEN role = 'learner' THEN 1 END) as learners,
         COUNT(CASE WHEN role = 'supervisor' THEN 1 END) as supervisors,
         COUNT(CASE WHEN role = 'candidate' THEN 1 END) as candidates,
         COUNT(CASE WHEN is_active = true THEN 1 END) as active
       FROM users`,
        { type: QueryTypes.SELECT },
      );

      const [coursesResult] = await sequelize.query(
        `SELECT 
         COUNT(*) as total,
         COUNT(CASE WHEN is_published = true THEN 1 END) as published,
         AVG(estimated_hours) as avg_hours
       FROM courses`,
        { type: QueryTypes.SELECT },
      );

      const [enrollmentsResult] = await sequelize.query(
        `SELECT 
         COUNT(*) as total,
         COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) as completed,
         AVG(progress_percentage) as avg_progress
       FROM enrollments`,
        { type: QueryTypes.SELECT },
      );

      const [hoursResult] = await sequelize.query(
        `SELECT 
         SUM(duration_minutes)/60 as total_hours,
         COUNT(DISTINCT user_id) as active_learners,
         COUNT(DISTINCT date) as active_days
       FROM learning_sessions
       WHERE end_time IS NOT NULL
         AND date >= DATE_TRUNC('month', CURRENT_DATE)`,
        { type: QueryTypes.SELECT },
      );

      const [testsResult] = await sequelize.query(
        `SELECT 
         COUNT(*) as total_attempts,
         AVG(score) as avg_score,
         COUNT(CASE WHEN status = 'submitted' THEN 1 END) as pending_grading
       FROM test_attempts
       WHERE status IN ('graded', 'submitted')`,
        { type: QueryTypes.SELECT },
      );

      const archetypesResult = await sequelize.query(
        `SELECT archetype, COUNT(*) as count
       FROM users
       WHERE archetype IS NOT NULL AND is_active = true
       GROUP BY archetype
       ORDER BY count DESC`,
        { type: QueryTypes.SELECT },
      );

      const topLearnersResult = await sequelize.query(
        `SELECT u.id, u.full_name, u.archetype,
              COUNT(DISTINCT e.course_id) as courses_completed,
              AVG(ta.score) as avg_test_score
       FROM users u
       LEFT JOIN enrollments e ON u.id = e.user_id AND e.completed_at IS NOT NULL
       LEFT JOIN test_attempts ta ON u.id = ta.user_id AND ta.status = 'graded'
       WHERE u.role = 'learner' AND u.is_active = true
       GROUP BY u.id, u.full_name, u.archetype
       HAVING COUNT(DISTINCT e.course_id) > 0
       ORDER BY courses_completed DESC, avg_test_score DESC
       LIMIT 10`,
        { type: QueryTypes.SELECT },
      );

      res.json({
        users: usersResult,
        courses: {
          total: parseInt(coursesResult.total),
          published: parseInt(coursesResult.published),
          avg_estimated_hours: parseFloat(coursesResult.avg_hours || 0).toFixed(
            1,
          ),
        },
        enrollments: {
          total: parseInt(enrollmentsResult.total),
          completed: parseInt(enrollmentsResult.completed),
          avg_progress: parseFloat(enrollmentsResult.avg_progress || 0).toFixed(
            1,
          ),
        },
        learning_this_month: {
          total_hours: parseFloat(hoursResult.total_hours || 0).toFixed(2),
          active_learners: parseInt(hoursResult.active_learners || 0),
          active_days: parseInt(hoursResult.active_days || 0),
        },
        tests: {
          total_attempts: parseInt(testsResult.total_attempts || 0),
          avg_score: parseFloat(testsResult.avg_score || 0).toFixed(2),
          pending_grading: parseInt(testsResult.pending_grading || 0),
        },
        archetype_distribution: archetypesResult,
        top_performers: topLearnersResult,
      });
    } catch (error) {
      console.error("Admin dashboard error:", error);
      res.status(500).json({ error: "Failed to fetch admin dashboard" });
    }
  },
);

// Export data (Admin only)
router.get(
  "/export/:type",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const { type } = req.params;
      let data;

      switch (type) {
        case "users":
          data = await sequelize.query(
            `SELECT id, email, full_name, role, archetype, created_at, is_active
           FROM users
           ORDER BY created_at DESC`,
            { type: QueryTypes.SELECT },
          );
          break;

        case "learning-hours":
          data = await sequelize.query(
            `SELECT u.full_name, u.email, 
                  ls.date, SUM(ls.duration_minutes)/60 as hours
           FROM learning_sessions ls
           JOIN users u ON ls.user_id = u.id
           WHERE ls.end_time IS NOT NULL
           GROUP BY u.id, u.full_name, u.email, ls.date
           ORDER BY ls.date DESC, u.full_name`,
            { type: QueryTypes.SELECT },
          );
          break;

        case "courses":
          data = await sequelize.query(
            `SELECT c.id, c.title, c.difficulty, c.archetype, c.is_published,
                  COUNT(e.id) as enrollments,
                  c.created_at
           FROM courses c
           LEFT JOIN enrollments e ON c.id = e.course_id
           GROUP BY c.id
           ORDER BY c.created_at DESC`,
            { type: QueryTypes.SELECT },
          );
          break;

        case "test-results":
          data = await sequelize.query(
            `SELECT u.full_name, u.email, t.title as test_title,
                  ta.score, ta.graded_at, ta.attempt_number
           FROM test_attempts ta
           JOIN users u ON ta.user_id = u.id
           JOIN tests t ON ta.test_id = t.id
           WHERE ta.status = 'graded'
           ORDER BY ta.graded_at DESC`,
            { type: QueryTypes.SELECT },
          );
          break;

        default:
          return res.status(400).json({ error: "Invalid export type" });
      }

      res.json({
        export_type: type,
        data,
        exported_at: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Export error:", error);
      res.status(500).json({ error: "Failed to export data" });
    }
  },
);

module.exports = router;
