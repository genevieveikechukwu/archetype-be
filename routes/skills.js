const express = require("express");
const { body, validationResult } = require("express-validator");
const { sequelize, Skill, CourseSkill, UserSkill, User } = require("../models");
const { authenticateToken, authorize } = require("../middleware/auth");
const { QueryTypes, Op } = require("sequelize");

const router = express.Router();

// Create skill (Admin only)
router.post(
  "/",
  authenticateToken,
  authorize("admin"),
  [body("name").trim().notEmpty(), body("description").optional().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description } = req.body;

      const skill = await Skill.create({
        name,
        description: description || null,
      });

      res.status(201).json({
        message: "Skill created successfully",
        skill,
      });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(409).json({ error: "Skill already exists" });
      }
      console.error("Skill creation error:", error);
      res.status(500).json({ error: "Failed to create skill" });
    }
  },
);

// Get all skills
router.get("/", authenticateToken, async (req, res) => {
  try {
    const skills = await sequelize.query(
      `SELECT s.*, COUNT(cs.course_id) as course_count
       FROM skills s
       LEFT JOIN course_skills cs ON s.id = cs.skill_id
       GROUP BY s.id
       ORDER BY s.name`,
      { type: QueryTypes.SELECT },
    );

    res.json({ skills });
  } catch (error) {
    console.error("Skills fetch error:", error);
    res.status(500).json({ error: "Failed to fetch skills" });
  }
});

// Link skill to course (Admin only)
router.post(
  "/course-link",
  authenticateToken,
  authorize("admin"),
  [
    body("course_id").isInt(),
    body("skill_id").isInt(),
    body("weight").optional().isFloat({ min: 0, max: 1 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { course_id, skill_id, weight } = req.body;

      const link = await CourseSkill.create({
        course_id,
        skill_id,
        weight: weight || 1.0,
      });

      res.status(201).json({
        message: "Skill linked to course successfully",
        link,
      });
    } catch (error) {
      if (error.name === "SequelizeUniqueConstraintError") {
        return res
          .status(409)
          .json({ error: "Skill already linked to this course" });
      }
      console.error("Skill link error:", error);
      res.status(500).json({ error: "Failed to link skill to course" });
    }
  },
);

// Calculate and update user skills
router.post(
  "/calculate/:userId",
  authenticateToken,
  authorize("supervisor", "admin"),
  async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const userId = req.params.userId;

      // Get all skills from completed courses
      const skillsData = await sequelize.query(
        `SELECT cs.skill_id, cs.weight, c.id as course_id
         FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         JOIN course_skills cs ON c.id = cs.course_id
         WHERE e.user_id = :userId AND e.completed_at IS NOT NULL`,
        { replacements: { userId }, type: QueryTypes.SELECT, transaction: t },
      );

      // Get test averages per course
      const testAverages = await sequelize.query(
        `SELECT t.course_id, AVG(ta.score) as avg_score
         FROM test_attempts ta
         JOIN tests t ON ta.test_id = t.id
         WHERE ta.user_id = :userId AND ta.status = 'graded'
         GROUP BY t.course_id`,
        { replacements: { userId }, type: QueryTypes.SELECT, transaction: t },
      );

      const testAvgMap = {};
      testAverages.forEach((row) => {
        testAvgMap[row.course_id] = parseFloat(row.avg_score);
      });

      // Group by skill
      const skillMap = {};
      skillsData.forEach((row) => {
        if (!skillMap[row.skill_id]) {
          skillMap[row.skill_id] = { courses: [], weights: [] };
        }
        skillMap[row.skill_id].courses.push(row.course_id);
        skillMap[row.skill_id].weights.push(parseFloat(row.weight));
      });

      // Calculate level for each skill
      for (const [skillId, data] of Object.entries(skillMap)) {
        const coursesCompleted = data.courses.length;

        const testScores = data.courses.map((cid) => testAvgMap[cid] || 0);
        const testAverage =
          testScores.reduce((sum, score) => sum + score, 0) / testScores.length;

        const supervisorRating = 3.5; // Default mid-range

        const rawScore =
          (coursesCompleted * (testAverage / 100) * supervisorRating) / 3;
        const level = Math.min(5, rawScore * 5);

        // Upsert user_skills using raw query for ON CONFLICT
        await sequelize.query(
          `INSERT INTO user_skills (user_id, skill_id, level, courses_completed, test_average, supervisor_rating, last_calculated)
           VALUES (:userId, :skillId, :level, :coursesCompleted, :testAverage, :supervisorRating, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, skill_id) 
           DO UPDATE SET 
             level = :level,
             courses_completed = :coursesCompleted,
             test_average = :testAverage,
             supervisor_rating = :supervisorRating,
             last_calculated = CURRENT_TIMESTAMP`,
          {
            replacements: {
              userId,
              skillId,
              level: level.toFixed(2),
              coursesCompleted,
              testAverage: testAverage.toFixed(2),
              supervisorRating,
            },
            transaction: t,
          },
        );
      }

      await t.commit();

      res.json({ message: "Skills calculated successfully" });
    } catch (error) {
      await t.rollback();
      console.error("Skill calculation error:", error);
      res.status(500).json({ error: "Failed to calculate skills" });
    }
  },
);

// Get user's skill profile
router.get("/user/:userId", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await UserSkill.findAll({
      where: { user_id: userId },
      include: [{ model: Skill, attributes: ["name", "description"] }],
      order: [["level", "DESC"]],
    });

    const skillProfile = result.map((row) => {
      const plain = row.get({ plain: true });
      return {
        skill_id: plain.skill_id,
        skill_name: plain.Skill ? plain.Skill.name : null,
        skill_description: plain.Skill ? plain.Skill.description : null,
        level: parseFloat(plain.level),
        courses_completed: plain.courses_completed,
        test_average: parseFloat(plain.test_average),
        supervisor_rating: parseFloat(plain.supervisor_rating),
        last_calculated: plain.last_calculated,
      };
    });

    res.json({ skill_profile: skillProfile });
  } catch (error) {
    console.error("Skill profile error:", error);
    res.status(500).json({ error: "Failed to fetch skill profile" });
  }
});

// Search users by skill
router.get("/search", authenticateToken, async (req, res) => {
  try {
    const { skill_name, min_level } = req.query;

    if (!skill_name) {
      return res.status(400).json({ error: "skill_name parameter required" });
    }

    const result = await sequelize.query(
      `SELECT u.id, u.full_name, u.email, u.archetype, us.level, s.name as skill_name
         FROM user_skills us
         JOIN users u ON us.user_id = u.id
         JOIN skills s ON us.skill_id = s.id
         WHERE s.name ILIKE :skillName AND us.level >= :minLevel AND u.is_active = true
         ORDER BY us.level DESC`,
      {
        replacements: {
          skillName: `%${skill_name}%`,
          minLevel: min_level || 0,
        },
        type: QueryTypes.SELECT,
      },
    );

    res.json({ users: result });
  } catch (error) {
    console.error("Skill search error:", error);
    res.status(500).json({ error: "Failed to search by skill" });
  }
});

// Get skill graph data (for visualization)
router.get("/graph/:userId", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await UserSkill.findAll({
      where: { user_id: userId },
      include: [{ model: Skill, attributes: ["name"] }],
      order: [["level", "DESC"]],
      limit: 10,
    });

    res.json({
      graph_data: result.map((row) => ({
        skill: row.Skill ? row.Skill.name : null,
        level: parseFloat(row.level),
      })),
    });
  } catch (error) {
    console.error("Skill graph error:", error);
    res.status(500).json({ error: "Failed to generate skill graph" });
  }
});

module.exports = router;
