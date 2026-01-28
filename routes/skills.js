const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Create skill (Admin only)
router.post('/',
  authenticateToken,
  authorize('admin'),
  [
    body('name').trim().notEmpty(),
    body('description').optional().trim()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, description } = req.body;

      const result = await db.query(
        'INSERT INTO skills (name, description) VALUES ($1, $2) RETURNING *',
        [name, description || null]
      );

      res.status(201).json({
        message: 'Skill created successfully',
        skill: result.rows[0]
      });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Skill already exists' });
      }
      console.error('Skill creation error:', error);
      res.status(500).json({ error: 'Failed to create skill' });
    }
  }
);

// Get all skills
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT s.*, COUNT(cs.course_id) as course_count
       FROM skills s
       LEFT JOIN course_skills cs ON s.id = cs.skill_id
       GROUP BY s.id
       ORDER BY s.name`
    );

    res.json({ skills: result.rows });
  } catch (error) {
    console.error('Skills fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// Link skill to course (Admin only)
router.post('/course-link',
  authenticateToken,
  authorize('admin'),
  [
    body('course_id').isInt(),
    body('skill_id').isInt(),
    body('weight').optional().isFloat({ min: 0, max: 1 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { course_id, skill_id, weight } = req.body;

      const result = await db.query(
        'INSERT INTO course_skills (course_id, skill_id, weight) VALUES ($1, $2, $3) RETURNING *',
        [course_id, skill_id, weight || 1.0]
      );

      res.status(201).json({
        message: 'Skill linked to course successfully',
        link: result.rows[0]
      });
    } catch (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Skill already linked to this course' });
      }
      console.error('Skill link error:', error);
      res.status(500).json({ error: 'Failed to link skill to course' });
    }
  }
);

// Calculate and update user skills
router.post('/calculate/:userId',
  authenticateToken,
  authorize('supervisor', 'admin'),
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const userId = req.params.userId;

      // Get all skills from completed courses
      const skillsData = await client.query(
        `SELECT cs.skill_id, cs.weight, c.id as course_id
         FROM enrollments e
         JOIN courses c ON e.course_id = c.id
         JOIN course_skills cs ON c.id = cs.course_id
         WHERE e.user_id = $1 AND e.completed_at IS NOT NULL`,
        [userId]
      );

      // Get test averages per course
      const testAverages = await client.query(
        `SELECT t.course_id, AVG(ta.score) as avg_score
         FROM test_attempts ta
         JOIN tests t ON ta.test_id = t.id
         WHERE ta.user_id = $1 AND ta.status = 'graded'
         GROUP BY t.course_id`,
        [userId]
      );

      const testAvgMap = {};
      testAverages.rows.forEach(row => {
        testAvgMap[row.course_id] = parseFloat(row.avg_score);
      });

      // Group by skill
      const skillMap = {};
      skillsData.rows.forEach(row => {
        if (!skillMap[row.skill_id]) {
          skillMap[row.skill_id] = {
            courses: [],
            weights: []
          };
        }
        skillMap[row.skill_id].courses.push(row.course_id);
        skillMap[row.skill_id].weights.push(parseFloat(row.weight));
      });

      // Calculate level for each skill
      for (const [skillId, data] of Object.entries(skillMap)) {
        const coursesCompleted = data.courses.length;
        
        // Calculate weighted test average
        const testScores = data.courses.map(cid => testAvgMap[cid] || 0);
        const testAverage = testScores.reduce((sum, score) => sum + score, 0) / testScores.length;

        // Get supervisor rating (placeholder - would come from supervisor reviews)
        const supervisorRating = 3.5; // Default mid-range

        // Formula: (courses_completed × test_avg × supervisor_rating) / 3
        // Normalized to 0-5 scale
        const rawScore = (coursesCompleted * (testAverage / 100) * supervisorRating) / 3;
        const level = Math.min(5, rawScore * 5); // Scale to 0-5

        // Upsert user_skills
        await client.query(
          `INSERT INTO user_skills (user_id, skill_id, level, courses_completed, test_average, supervisor_rating, last_calculated)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
           ON CONFLICT (user_id, skill_id) 
           DO UPDATE SET 
             level = $3,
             courses_completed = $4,
             test_average = $5,
             supervisor_rating = $6,
             last_calculated = CURRENT_TIMESTAMP`,
          [userId, skillId, level.toFixed(2), coursesCompleted, testAverage.toFixed(2), supervisorRating]
        );
      }

      await client.query('COMMIT');

      res.json({ message: 'Skills calculated successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Skill calculation error:', error);
      res.status(500).json({ error: 'Failed to calculate skills' });
    } finally {
      client.release();
    }
  }
);

// Get user's skill profile
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await db.query(
      `SELECT us.*, s.name as skill_name, s.description as skill_description
       FROM user_skills us
       JOIN skills s ON us.skill_id = s.id
       WHERE us.user_id = $1
       ORDER BY us.level DESC`,
      [userId]
    );

    const skillProfile = result.rows.map(row => ({
      skill_id: row.skill_id,
      skill_name: row.skill_name,
      skill_description: row.skill_description,
      level: parseFloat(row.level),
      courses_completed: row.courses_completed,
      test_average: parseFloat(row.test_average),
      supervisor_rating: parseFloat(row.supervisor_rating),
      last_calculated: row.last_calculated
    }));

    res.json({ skill_profile: skillProfile });
  } catch (error) {
    console.error('Skill profile error:', error);
    res.status(500).json({ error: 'Failed to fetch skill profile' });
  }
});

// Search users by skill
router.get('/search',
  authenticateToken,
  async (req, res) => {
    try {
      const { skill_name, min_level } = req.query;

      if (!skill_name) {
        return res.status(400).json({ error: 'skill_name parameter required' });
      }

      const result = await db.query(
        `SELECT u.id, u.full_name, u.email, u.archetype, us.level, s.name as skill_name
         FROM user_skills us
         JOIN users u ON us.user_id = u.id
         JOIN skills s ON us.skill_id = s.id
         WHERE s.name ILIKE $1 AND us.level >= $2 AND u.is_active = true
         ORDER BY us.level DESC`,
        [`%${skill_name}%`, min_level || 0]
      );

      res.json({ users: result.rows });
    } catch (error) {
      console.error('Skill search error:', error);
      res.status(500).json({ error: 'Failed to search by skill' });
    }
  }
);

// Get skill graph data (for visualization)
router.get('/graph/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;

    const result = await db.query(
      `SELECT s.name, us.level
       FROM user_skills us
       JOIN skills s ON us.skill_id = s.id
       WHERE us.user_id = $1
       ORDER BY us.level DESC
       LIMIT 10`,
      [userId]
    );

    res.json({
      graph_data: result.rows.map(row => ({
        skill: row.name,
        level: parseFloat(row.level)
      }))
    });
  } catch (error) {
    console.error('Skill graph error:', error);
    res.status(500).json({ error: 'Failed to generate skill graph' });
  }
});

module.exports = router;