const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Send feedback
router.post('/send', authenticateToken, async (req, res) => {
  try {
    const { receiver_id, subject, message } = req.body;

    const result = await db.query(
      `INSERT INTO mentorship_messages (sender_id, receiver_id, message_text, course_id)
       VALUES ($1, $2, $3, NULL) RETURNING *`,
      [req.user.id, receiver_id, `Subject: ${subject}\n\n${message}`]
    );

    // Create notification
    await db.query(
      `INSERT INTO notifications (user_id, title, message, notification_type)
       VALUES ($1, $2, $3, $4)`,
      [receiver_id, `New Feedback from ${req.user.full_name}`, subject, 'feedback']
    );

    res.status(201).json({ message: 'Feedback sent successfully', data: result.rows[0] });
  } catch (error) {
    console.error('Send feedback error:', error);
    res.status(500).json({ error: 'Failed to send feedback' });
  }
});

// Get all feedback/messages
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT m.*, 
             us.full_name as sender_name, us.role as sender_role,
             ur.full_name as receiver_name, ur.role as receiver_role
      FROM mentorship_messages m
      JOIN users us ON m.sender_id = us.id
      JOIN users ur ON m.receiver_id = ur.id
      WHERE m.sender_id = $1 OR m.receiver_id = $1
      ORDER BY m.created_at DESC
      LIMIT 100
    `, [req.user.id]);

    res.json({ messages: result.rows });
  } catch (error) {
    console.error('Fetch feedback error:', error);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
});

// Get notifications
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ notifications: result.rows });
  } catch (error) {
    console.error('Fetch notifications error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Mark notification as read
router.put('/notifications/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    await db.query('UPDATE notifications SET is_read = true WHERE id = $1', [req.params.notificationId]);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark notification' });
  }
});

module.exports = router;