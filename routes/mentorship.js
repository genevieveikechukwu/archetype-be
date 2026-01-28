const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Send mentorship message
router.post('/messages',
  authenticateToken,
  [
    body('receiver_id').isInt(),
    body('message_text').trim().notEmpty(),
    body('course_id').optional().isInt()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { receiver_id, message_text, course_id } = req.body;

      // Verify receiver exists
      const receiverResult = await db.query(
        'SELECT id, full_name FROM users WHERE id = $1',
        [receiver_id]
      );

      if (receiverResult.rows.length === 0) {
        return res.status(404).json({ error: 'Receiver not found' });
      }

      // Insert message
      const result = await db.query(
        `INSERT INTO mentorship_messages (sender_id, receiver_id, message_text, course_id)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [req.user.id, receiver_id, message_text, course_id || null]
      );

      // Create notification for receiver
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type)
         VALUES ($1, $2, $3, $4)`,
        [receiver_id, 'New Message', `You have a new message from ${req.user.full_name}`, 'new_message']
      );

      res.status(201).json({
        message: 'Message sent successfully',
        data: result.rows[0]
      });
    } catch (error) {
      console.error('Message send error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  }
);

// Get messages (conversation)
router.get('/messages', authenticateToken, async (req, res) => {
  try {
    const { other_user_id, course_id } = req.query;

    let query = `
      SELECT m.*, 
             us.full_name as sender_name,
             ur.full_name as receiver_name
      FROM mentorship_messages m
      JOIN users us ON m.sender_id = us.id
      JOIN users ur ON m.receiver_id = ur.id
      WHERE (m.sender_id = $1 OR m.receiver_id = $1)
    `;

    const params = [req.user.id];
    let paramIndex = 2;

    if (other_user_id) {
      query += ` AND (m.sender_id = $${paramIndex} OR m.receiver_id = $${paramIndex})`;
      params.push(other_user_id);
      paramIndex++;
    }

    if (course_id) {
      query += ` AND m.course_id = $${paramIndex}`;
      params.push(course_id);
      paramIndex++;
    }

    query += ' ORDER BY m.created_at DESC LIMIT 100';

    const result = await db.query(query, params);

    // Mark messages as read
    if (other_user_id) {
      await db.query(
        'UPDATE mentorship_messages SET is_read = true WHERE receiver_id = $1 AND sender_id = $2',
        [req.user.id, other_user_id]
      );
    }

    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Messages fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Get unread message count
router.get('/messages/unread/count', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) as count FROM mentorship_messages WHERE receiver_id = $1 AND is_read = false',
      [req.user.id]
    );

    res.json({ unread_count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('Unread count error:', error);
    res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

// Send kudos
router.post('/kudos',
  authenticateToken,
  [
    body('to_user_id').isInt(),
    body('points').isInt({ min: 1, max: 5 }),
    body('message').trim().notEmpty()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { to_user_id, points, message } = req.body;

      if (to_user_id === req.user.id) {
        return res.status(400).json({ error: 'Cannot send kudos to yourself' });
      }

      const result = await db.query(
        `INSERT INTO kudos (from_user_id, to_user_id, points, message)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [req.user.id, to_user_id, points, message]
      );

      // Create notification
      await db.query(
        `INSERT INTO notifications (user_id, title, message, notification_type)
         VALUES ($1, $2, $3, $4)`,
        [to_user_id, 'Kudos Received!', `${req.user.full_name} sent you ${points} kudos points!`, 'kudos']
      );

      res.status(201).json({
        message: 'Kudos sent successfully',
        kudos: result.rows[0]
      });
    } catch (error) {
      console.error('Kudos send error:', error);
      res.status(500).json({ error: 'Failed to send kudos' });
    }
  }
);

// Get kudos received
router.get('/kudos/received', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT k.*, u.full_name as from_user_name
       FROM kudos k
       JOIN users u ON k.from_user_id = u.id
       WHERE k.to_user_id = $1
       ORDER BY k.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    const totalPoints = await db.query(
      'SELECT SUM(points) as total FROM kudos WHERE to_user_id = $1',
      [req.user.id]
    );

    res.json({
      kudos: result.rows,
      total_points: parseInt(totalPoints.rows[0].total || 0)
    });
  } catch (error) {
    console.error('Kudos fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch kudos' });
  }
});

// Get kudos given
router.get('/kudos/given', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT k.*, u.full_name as to_user_name
       FROM kudos k
       JOIN users u ON k.to_user_id = u.id
       WHERE k.from_user_id = $1
       ORDER BY k.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );

    res.json({ kudos: result.rows });
  } catch (error) {
    console.error('Kudos fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch kudos' });
  }
});

// Create/Update journal entry
router.post('/journal',
  authenticateToken,
  authorize('learner'),
  [
    body('entry_text').trim().notEmpty(),
    body('entry_date').optional().isDate()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { entry_text, entry_date } = req.body;
      const date = entry_date || new Date().toISOString().split('T')[0];

      // Check if entry exists for this date
      const existing = await db.query(
        'SELECT id FROM journals WHERE user_id = $1 AND entry_date = $2',
        [req.user.id, date]
      );

      let result;
      if (existing.rows.length > 0) {
        // Update existing
        result = await db.query(
          `UPDATE journals 
           SET entry_text = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2
           RETURNING *`,
          [entry_text, existing.rows[0].id]
        );
      } else {
        // Create new
        result = await db.query(
          `INSERT INTO journals (user_id, entry_date, entry_text)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [req.user.id, date, entry_text]
        );
      }

      res.json({
        message: 'Journal entry saved successfully',
        entry: result.rows[0]
      });
    } catch (error) {
      console.error('Journal save error:', error);
      res.status(500).json({ error: 'Failed to save journal entry' });
    }
  }
);

// Get journal entries
router.get('/journal', authenticateToken, authorize('learner'), async (req, res) => {
  try {
    const { start_date, end_date, limit = 30 } = req.query;

    let query = 'SELECT * FROM journals WHERE user_id = $1';
    const params = [req.user.id];
    let paramIndex = 2;

    if (start_date) {
      query += ` AND entry_date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND entry_date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    query += ` ORDER BY entry_date DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query(query, params);

    res.json({ entries: result.rows });
  } catch (error) {
    console.error('Journal fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch journal entries' });
  }
});

// Get conversation partners
router.get('/conversations', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT
         CASE 
           WHEN m.sender_id = $1 THEN m.receiver_id
           ELSE m.sender_id
         END as user_id,
         u.full_name,
         u.role,
         MAX(m.created_at) as last_message_time,
         COUNT(CASE WHEN m.receiver_id = $1 AND m.is_read = false THEN 1 END) as unread_count
       FROM mentorship_messages m
       JOIN users u ON (
         CASE 
           WHEN m.sender_id = $1 THEN m.receiver_id
           ELSE m.sender_id
         END = u.id
       )
       WHERE m.sender_id = $1 OR m.receiver_id = $1
       GROUP BY user_id, u.full_name, u.role
       ORDER BY last_message_time DESC`,
      [req.user.id]
    );

    res.json({ conversations: result.rows });
  } catch (error) {
    console.error('Conversations fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

module.exports = router;