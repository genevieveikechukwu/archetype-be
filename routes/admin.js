const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 }
});

// ========== USER MANAGEMENT ==========

// Get all users
router.get('/users', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const result = await db.query(`
      SELECT u.id, u.email, u.full_name, u.role, u.archetype, u.is_active, u.created_at,
             s.full_name as supervisor_name,
             COUNT(DISTINCT e.id) as enrolled_courses,
             COUNT(DISTINCT CASE WHEN e.completed_at IS NOT NULL THEN e.id END) as completed_courses,
             SUM(ls.duration_minutes)/60 as total_learning_hours
      FROM users u
      LEFT JOIN users s ON u.supervisor_id = s.id
      LEFT JOIN enrollments e ON u.id = e.user_id
      LEFT JOIN learning_sessions ls ON u.id = ls.user_id AND ls.end_time IS NOT NULL
      GROUP BY u.id, s.full_name
      ORDER BY u.created_at DESC
    `);
    
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Fetch users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Create user (any role)
router.post('/users', 
  authenticateToken, 
  authorize('admin'),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('full_name').trim().notEmpty(),
    body('role').isIn(['candidate', 'learner', 'supervisor', 'admin'])
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, full_name, role, archetype, supervisor_id } = req.body;

      const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        return res.status(409).json({ error: 'Email already exists' });
      }

      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);

      const result = await db.query(
        `INSERT INTO users (email, password_hash, full_name, role, archetype, supervisor_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, full_name, role, archetype, created_at`,
        [email, password_hash, full_name, role, archetype || null, supervisor_id || null]
      );

      res.status(201).json({
        message: 'User created successfully',
        user: result.rows[0]
      });
    } catch (error) {
      console.error('Create user error:', error);
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
);

// Update user details
router.put('/users/:userId', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { full_name, email, role, archetype, supervisor_id } = req.body;

    const result = await db.query(
      `UPDATE users 
       SET full_name = COALESCE($1, full_name),
           email = COALESCE($2, email),
           role = COALESCE($3, role),
           archetype = COALESCE($4, archetype),
           supervisor_id = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, email, full_name, role, archetype, is_active`,
      [full_name, email, role, archetype, supervisor_id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated successfully', user: result.rows[0] });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Change username (email)
router.put('/users/:userId/username', authenticateToken, authorize('admin'),
  [body('new_email').isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { new_email } = req.body;

      const existing = await db.query('SELECT id FROM users WHERE email = $1 AND id != $2', [new_email, userId]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }

      await db.query('UPDATE users SET email = $1 WHERE id = $2', [new_email, userId]);
      res.json({ message: 'Username updated successfully' });
    } catch (error) {
      console.error('Update username error:', error);
      res.status(500).json({ error: 'Failed to update username' });
    }
  }
);

// Change user password
router.put('/users/:userId/password', authenticateToken, authorize('admin'),
  [body('new_password').isLength({ min: 8 })],
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { new_password } = req.body;

      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(new_password, salt);

      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [password_hash, userId]);
      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      console.error('Change password error:', error);
      res.status(500).json({ error: 'Failed to change password' });
    }
  }
);

// Suspend/Activate user
router.put('/users/:userId/toggle-status', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await db.query(
      'UPDATE users SET is_active = NOT is_active WHERE id = $1 RETURNING is_active',
      [userId]
    );
    res.json({
      message: result.rows[0].is_active ? 'User activated' : 'User suspended',
      is_active: result.rows[0].is_active
    });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ error: 'Failed to toggle status' });
  }
});

// Delete user
router.delete('/users/:userId', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { userId } = req.params;
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});
// Migrate candidate to learner
router.post('/candidates/:candidateId/migrate', 
  authenticateToken, 
  authorize('admin'),
  [
    body('new_role').isIn(['learner']),
    body('supervisor_id').optional().isInt(),
    body('archetype').optional().isString()
  ],
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { candidateId } = req.params;
      const { new_role, supervisor_id, archetype } = req.body;

      // Verify candidate exists and has passing test
      const candidate = await client.query(
        `SELECT u.*, ta.score, t.passing_score
         FROM users u
         LEFT JOIN test_attempts ta ON u.id = ta.user_id AND ta.status = 'graded'
         LEFT JOIN tests t ON ta.test_id = t.id
         WHERE u.id = $1 AND u.role = 'candidate'
         ORDER BY ta.score DESC NULLS LAST
         LIMIT 1`,
        [candidateId]
      );

      if (candidate.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Candidate not found' });
      }

      const user = candidate.rows[0];
      const score = user.score;
      const passingScore = user.passing_score || 70;

      if (!score || score < passingScore) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: 'Candidate has not passed the assessment',
          score,
          required: passingScore
        });
      }

      // Update user role
      await client.query(
        `UPDATE users 
         SET role = $1, 
             supervisor_id = $2,
             archetype = COALESCE($3, archetype),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [new_role, supervisor_id || null, archetype || null, candidateId]
      );

      // Log the migration
      await client.query(
        `INSERT INTO notifications (user_id, title, message, notification_type)
         VALUES ($1, $2, $3, $4)`,
        [
          candidateId,
          'Account Activated!',
          `Congratulations! Your account has been upgraded to ${new_role}. You now have full access to the platform.`,
          'account_migration'
        ]
      );

      await client.query('COMMIT');

      // Send acceptance notification
      await notifyCandidateStatus(user, 'accepted');

      res.json({
        message: 'Candidate migrated successfully',
        user: {
          id: candidateId,
          new_role,
          supervisor_id,
          archetype
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Migration error:', error);
      res.status(500).json({ error: 'Failed to migrate candidate' });
    } finally {
      client.release();
    }
  }
);

// Get candidates eligible for migration
router.get('/candidates/eligible', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.email, u.full_name, u.created_at,
              ta.score, ta.graded_at, t.passing_score, t.title as test_title
       FROM users u
       JOIN test_attempts ta ON u.id = ta.user_id AND ta.status = 'graded'
       JOIN tests t ON ta.test_id = t.id
       WHERE u.role = 'candidate' 
         AND ta.score >= t.passing_score
       ORDER BY ta.graded_at DESC`
    );

    res.json({ candidates: result.rows });
  } catch (error) {
    console.error('Fetch eligible candidates error:', error);
    res.status(500).json({ error: 'Failed to fetch eligible candidates' });
  }
});
//Get supervisor list for assignment.
router.get('/supervisors', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, name as full_name, email FROM users WHERE role = 'supervisor' AND is_active = true ORDER BY name"
    );
    res.json({ supervisors: result.rows });
  } catch (error) {
    console.error('Fetch supervisors error:', error);
    res.status(500).json({ error: 'Failed to fetch supervisors' });
  }
});


// Upload course material
router.post('/courses/:courseId/upload', 
  authenticateToken, 
  authorize('admin'),
  upload.single('file'),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { title, content_type } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const content_url = `/uploads/${file.filename}`;

      const orderResult = await db.query(
        'SELECT COALESCE(MAX(order_index), -1) + 1 as next_order FROM course_content WHERE course_id = $1',
        [courseId]
      );

      const result = await db.query(
        `INSERT INTO course_content (course_id, title, content_type, content_url, order_index)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [courseId, title, content_type, content_url, orderResult.rows[0].next_order]
      );

      res.status(201).json({ message: 'Material uploaded successfully', content: result.rows[0] });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Failed to upload material' });
    }
  }
);

// Add course content (link-based)
router.post('/courses/:courseId/content', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { courseId } = req.params;
    const { title, content_type, content_url } = req.body;

    const orderResult = await db.query(
      'SELECT COALESCE(MAX(order_index), -1) + 1 as next_order FROM course_content WHERE course_id = $1',
      [courseId]
    );

    const result = await db.query(
      `INSERT INTO course_content (course_id, title, content_type, content_url, order_index)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [courseId, title, content_type, content_url, orderResult.rows[0].next_order]
    );

    res.status(201).json({ message: 'Content added successfully', content: result.rows[0] });
  } catch (error) {
    console.error('Add content error:', error);
    res.status(500).json({ error: 'Failed to add content' });
  }
});

// Update course content
router.put('/content/:contentId', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { contentId } = req.params;
    const { title, content_url } = req.body;

    const result = await db.query(
      'UPDATE course_content SET title = COALESCE($1, title), content_url = COALESCE($2, content_url) WHERE id = $3 RETURNING *',
      [title, content_url, contentId]
    );

    res.json({ message: 'Content updated successfully', content: result.rows[0] });
  } catch (error) {
    console.error('Update content error:', error);
    res.status(500).json({ error: 'Failed to update content' });
  }
});

// Delete course content
router.delete('/content/:contentId', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const { contentId } = req.params;
    await db.query('DELETE FROM course_content WHERE id = $1', [contentId]);
    res.json({ message: 'Content deleted successfully' });
  } catch (error) {
    console.error('Delete content error:', error);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

// Get supervisors list (for assigning)
router.get('/supervisors', authenticateToken, authorize('admin'), async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, full_name, email FROM users WHERE role = 'supervisor' AND is_active = true ORDER BY full_name"
    );
    res.json({ supervisors: result.rows });
  } catch (error) {
    console.error('Fetch supervisors error:', error);
    res.status(500).json({ error: 'Failed to fetch supervisors' });
  }
});

module.exports = router;