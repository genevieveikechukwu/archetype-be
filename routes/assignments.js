const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

const router = express.Router();

// Configure multer for assignment file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/assignments/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'assignment-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 }, // 10MB
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|txt|zip|rar/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: images, PDFs, docs, text, archives'));
    }
  }
});

// ========== LEARNER ASSIGNMENT SUBMISSIONS ==========

// Submit new assignment
router.post('/submit',
  authenticateToken,
  authorize('learner', 'candidate'),
  upload.single('file'),
  [
    body('course_id').isInt(),
    body('title').trim().notEmpty(),
    body('description').optional().trim(),
    body('submission_type').isIn(['link', 'file', 'text']),
    body('submission_url').optional().trim()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { course_id, title, description, submission_type, submission_url } = req.body;
      const file = req.file;

      // Verify user is enrolled in the course
      const enrollment = await db.query(
        'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
        [req.user.id, course_id]
      );

      if (enrollment.rows.length === 0) {
        return res.status(403).json({ error: 'You are not enrolled in this course' });
      }

      let finalSubmissionUrl = submission_url;
      
      // If file upload, set the URL to the uploaded file path
      if (submission_type === 'file' && file) {
        finalSubmissionUrl = `/uploads/assignments/${file.filename}`;
      }

      // Insert assignment submission
      const result = await db.query(
        `INSERT INTO assignments 
         (user_id, course_id, title, description, submission_type, submission_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         RETURNING *`,
        [req.user.id, course_id, title, description || null, submission_type, finalSubmissionUrl]
      );

      // Get supervisor to notify
      const supervisorResult = await db.query(
        'SELECT supervisor_id FROM users WHERE id = $1',
        [req.user.id]
      );

      if (supervisorResult.rows[0]?.supervisor_id) {
        await db.query(
          `INSERT INTO notifications (user_id, title, message, notification_type)
           VALUES ($1, $2, $3, $4)`,
          [
            supervisorResult.rows[0].supervisor_id,
            'New Assignment Submitted',
            `${req.user.full_name} submitted "${title}"`,
            'assignment'
          ]
        );
      }

      res.status(201).json({
        message: 'Assignment submitted successfully',
        assignment: result.rows[0]
      });
    } catch (error) {
      console.error('Assignment submission error:', error);
      res.status(500).json({ error: 'Failed to submit assignment' });
    }
  }
);

// Get my assignments (learner view)
router.get('/my-assignments', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*, c.title as course_title, u.full_name as reviewer_name
       FROM assignments a
       JOIN courses c ON a.course_id = c.id
       LEFT JOIN users u ON a.reviewed_by = u.id
       WHERE a.user_id = $1
       ORDER BY a.submitted_at DESC`,
      [req.user.id]
    );

    res.json({ assignments: result.rows });
  } catch (error) {
    console.error('Fetch assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Get single assignment details
router.get('/:assignmentId', authenticateToken, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const result = await db.query(
      `SELECT a.*, c.title as course_title, 
              u.full_name as student_name, u.email as student_email,
              r.full_name as reviewer_name
       FROM assignments a
       JOIN courses c ON a.course_id = c.id
       JOIN users u ON a.user_id = u.id
       LEFT JOIN users r ON a.reviewed_by = r.id
       WHERE a.id = $1`,
      [assignmentId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const assignment = result.rows[0];

    // Check permissions: owner, supervisor, or admin
    const isSupervisor = await db.query(
      'SELECT id FROM users WHERE id = $1 AND supervisor_id = $2',
      [assignment.user_id, req.user.id]
    );

    if (assignment.user_id !== req.user.id && 
        isSupervisor.rows.length === 0 && 
        req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(assignment);
  } catch (error) {
    console.error('Fetch assignment error:', error);
    res.status(500).json({ error: 'Failed to fetch assignment' });
  }
});

// ========== SUPERVISOR ASSIGNMENT REVIEW ==========

// Get assignments to review (supervisor view)
router.get('/to-review/all', authenticateToken, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT a.*, c.title as course_title, u.full_name as student_name, u.email as student_email
      FROM assignments a
      JOIN courses c ON a.course_id = c.id
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // Supervisors only see their learners' assignments
    if (req.user.role === 'supervisor') {
      query += ` AND u.supervisor_id = $${paramIndex}`;
      params.push(req.user.id);
      paramIndex++;
    }

    if (status) {
      query += ` AND a.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ' ORDER BY a.submitted_at DESC';

    const result = await db.query(query, params);

    res.json({ assignments: result.rows });
  } catch (error) {
    console.error('Fetch assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Review/Grade assignment
router.put('/:assignmentId/review',
  authenticateToken,
  authorize('supervisor', 'admin'),
  [
    body('feedback').optional().trim(),
    body('grade').optional().isFloat({ min: 0, max: 100 }),
    body('status').optional().isIn(['pending', 'reviewed', 'needs_revision'])
  ],
  async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const { feedback, grade, status } = req.body;

      // Verify this is the learner's supervisor or admin
      const assignment = await db.query(
        `SELECT a.user_id, u.supervisor_id 
         FROM assignments a 
         JOIN users u ON a.user_id = u.id 
         WHERE a.id = $1`,
        [assignmentId]
      );

      if (assignment.rows.length === 0) {
        return res.status(404).json({ error: 'Assignment not found' });
      }

      const isSupervisor = assignment.rows[0].supervisor_id === req.user.id;
      const isAdmin = req.user.role === 'admin';

      if (!isSupervisor && !isAdmin) {
        return res.status(403).json({ error: 'Not authorized to review this assignment' });
      }

      const result = await db.query(
        `UPDATE assignments 
         SET feedback = COALESCE($1, feedback),
             grade = COALESCE($2, grade),
             status = COALESCE($3, status),
             reviewed_by = $4,
             reviewed_at = CURRENT_TIMESTAMP
         WHERE id = $5
         RETURNING *`,
        [feedback, grade, status || 'reviewed', req.user.id, assignmentId]
      );

      // Notify the learner
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type)
         VALUES ($1, $2, $3, $4)`,
        [
          assignment.rows[0].user_id,
          'Assignment Reviewed',
          `Your assignment has been reviewed by ${req.user.full_name}`,
          'assignment'
        ]
      );

      res.json({
        message: 'Assignment reviewed successfully',
        assignment: result.rows[0]
      });
    } catch (error) {
      console.error('Review assignment error:', error);
      res.status(500).json({ error: 'Failed to review assignment' });
    }
  }
);

// Delete assignment (learner can delete their own pending submissions)
router.delete('/:assignmentId', authenticateToken, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await db.query(
      'SELECT user_id, status FROM assignments WHERE id = $1',
      [assignmentId]
    );

    if (assignment.rows.length === 0) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    // Only owner can delete, and only if pending
    if (assignment.rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (assignment.rows[0].status !== 'pending') {
      return res.status(400).json({ error: 'Can only delete pending assignments' });
    }

    await db.query('DELETE FROM assignments WHERE id = $1', [assignmentId]);

    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    console.error('Delete assignment error:', error);
    res.status(500).json({ error: 'Failed to delete assignment' });
  }
});

module.exports = router;