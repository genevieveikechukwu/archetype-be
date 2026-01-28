const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Create course (Admin only)
router.post('/',
  authenticateToken,
  authorize('admin'),
  [
    body('title').trim().notEmpty(),
    body('description').optional().trim(),
    body('difficulty').isIn(['beginner', 'intermediate', 'advanced']),
    body('archetype').optional().isIn(['maker', 'architect', 'strategist', 'connector', 'explorer']),
    body('estimated_hours').optional().isInt({ min: 1 })
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { title, description, difficulty, archetype, estimated_hours, version, content } = req.body;

      // Insert course
      const courseResult = await db.query(
        `INSERT INTO courses (title, description, difficulty, archetype, estimated_hours, version, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [title, description || null, difficulty, archetype || null, estimated_hours || null, version || '1.0', req.user.id]
      );

      const course = courseResult.rows[0];

      // Insert course content if provided
      if (content && Array.isArray(content)) {
        for (let i = 0; i < content.length; i++) {
          const item = content[i];
          await db.query(
            `INSERT INTO course_content (course_id, title, content_type, content_url, order_index)
             VALUES ($1, $2, $3, $4, $5)`,
            [course.id, item.title, item.content_type, item.content_url, i]
          );
        }
      }

      res.status(201).json({
        message: 'Course created successfully',
        course
      });
    } catch (error) {
      console.error('Course creation error:', error);
      res.status(500).json({ error: 'Failed to create course' });
    }
  }
);

// Get all courses (filtered by difficulty/archetype)
router.get('/:', authenticateToken, async (req, res) => {
  try {
    const { difficulty, archetype, is_published } = req.query;

    let query = `
      SELECT c.*, u.full_name as created_by_name,
             COUNT(DISTINCT e.id) as enrolled_count,
             COUNT(DISTINCT cc.id) as content_count
      FROM courses c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN enrollments e ON c.id = e.course_id
      LEFT JOIN course_content cc ON c.id = cc.course_id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // Only show published courses to non-admins
    if (req.user.role !== 'admin') {
      query += ' AND c.is_published = true';
    } else if (is_published !== undefined) {
      query += ` AND c.is_published = $${paramIndex}`;
      params.push(is_published === 'true');
      paramIndex++;
    }

    if (difficulty) {
      query += ` AND c.difficulty = $${paramIndex}`;
      params.push(difficulty);
      paramIndex++;
    }

    if (archetype) {
      query += ` AND c.archetype = $${paramIndex}`;
      params.push(archetype);
      paramIndex++;
    }

    query += ' GROUP BY c.id, u.full_name ORDER BY c.created_at DESC';

    const result = await db.query(query, params);

    res.json({ courses: result.rows });
  } catch (error) {
    console.error('Courses fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// Get single course details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const courseId = req.params.id;

    const courseResult = await db.query(
      `SELECT c.*, u.full_name as created_by_name,
              COUNT(DISTINCT e.id) as enrolled_count
       FROM courses c
       LEFT JOIN users u ON c.created_by = u.id
       LEFT JOIN enrollments e ON c.id = e.course_id
       WHERE c.id = $1
       GROUP BY c.id, u.full_name`,
      [courseId]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const course = courseResult.rows[0];

    // Check if non-admin trying to access unpublished course
    if (!course.is_published && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Course not available' });
    }

    // Get course content
    const contentResult = await db.query(
      'SELECT * FROM course_content WHERE course_id = $1 ORDER BY order_index',
      [courseId]
    );

    // Get user's enrollment status
    const enrollmentResult = await db.query(
      'SELECT * FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user.id, courseId]
    );

    // Get associated tests
    const testsResult = await db.query(
      'SELECT id, title, test_type, passing_score, time_limit_minutes FROM tests WHERE course_id = $1',
      [courseId]
    );

    res.json({
      course,
      content: contentResult.rows,
      enrollment: enrollmentResult.rows[0] || null,
      tests: testsResult.rows
    });
  } catch (error) {
    console.error('Course detail error:', error);
    res.status(500).json({ error: 'Failed to fetch course details' });
  }
});

// Update course
router.put('/:id',
  authenticateToken,
  authorize('admin'),
  async (req, res) => {
    try {
      const courseId = req.params.id;
      const { title, description, difficulty, archetype, estimated_hours, is_published, version } = req.body;

      const result = await db.query(
        `UPDATE courses 
         SET title = COALESCE($1, title),
             description = COALESCE($2, description),
             difficulty = COALESCE($3, difficulty),
             archetype = COALESCE($4, archetype),
             estimated_hours = COALESCE($5, estimated_hours),
             is_published = COALESCE($6, is_published),
             version = COALESCE($7, version),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $8
         RETURNING *`,
        [title, description, difficulty, archetype, estimated_hours, is_published, version, courseId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Course not found' });
      }

      res.json({
        message: 'Course updated successfully',
        course: result.rows[0]
      });
    } catch (error) {
      console.error('Course update error:', error);
      res.status(500).json({ error: 'Failed to update course' });
    }
  }
);

// Delete course
router.delete('/:id', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const courseId = req.params.id;

    const result = await db.query('DELETE FROM courses WHERE id = $1 RETURNING id', [courseId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    res.json({ message: 'Course deleted successfully' });
  } catch (error) {
    console.error('Course deletion error:', error);
    res.status(500).json({ error: 'Failed to delete course' });
  }
});

// Enroll in course
router.post('/:id/enroll', authenticateToken, authorize('learner'), async (req, res) => {
  try {
    const courseId = req.params.id;

    // Check if course exists and is published
    const courseResult = await db.query(
      'SELECT id, is_published FROM courses WHERE id = $1',
      [courseId]
    );

    if (courseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Course not found' });
    }

    if (!courseResult.rows[0].is_published) {
      return res.status(403).json({ error: 'Course is not available for enrollment' });
    }

    // Check if already enrolled
    const existingEnrollment = await db.query(
      'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
      [req.user.id, courseId]
    );

    if (existingEnrollment.rows.length > 0) {
      return res.status(400).json({ error: 'Already enrolled in this course' });
    }

    // Enroll user
    const result = await db.query(
      'INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) RETURNING *',
      [req.user.id, courseId]
    );

    res.status(201).json({
      message: 'Enrolled successfully',
      enrollment: result.rows[0]
    });
  } catch (error) {
    console.error('Enrollment error:', error);
    res.status(500).json({ error: 'Failed to enroll in course' });
  }
});

// Update course progress
router.put('/:id/progress',
  authenticateToken,
  authorize('learner'),
  [body('progress_percentage').isInt({ min: 0, max: 100 })],
  async (req, res) => {
    try {
      const courseId = req.params.id;
      const { progress_percentage } = req.body;

      const result = await db.query(
        `UPDATE enrollments 
         SET progress_percentage = $1,
             completed_at = CASE WHEN $1 = 100 THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE user_id = $2 AND course_id = $3
         RETURNING *`,
        [progress_percentage, req.user.id, courseId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Enrollment not found' });
      }

      res.json({
        message: 'Progress updated successfully',
        enrollment: result.rows[0]
      });
    } catch (error) {
      console.error('Progress update error:', error);
      res.status(500).json({ error: 'Failed to update progress' });
    }
  }
);

// Get user's enrolled courses
router.get('/my/enrollments', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT e.*, c.title, c.description, c.difficulty, c.archetype, c.estimated_hours,
              cc.content_count,
              CASE WHEN e.completed_at IS NOT NULL THEN true ELSE false END as is_completed
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       LEFT JOIN (
         SELECT course_id, COUNT(*) as content_count
         FROM course_content
         GROUP BY course_id
       ) cc ON c.id = cc.course_id
       WHERE e.user_id = $1
       ORDER BY e.enrolled_at DESC`,
      [req.user.id]
    );

    res.json({ enrollments: result.rows });
  } catch (error) {
    console.error('Enrollments fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
});

module.exports = router;