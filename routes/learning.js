const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Clock-in (Start learning session)
router.post('/clock-in', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
  try {
    // Check if there's an ongoing session
    const ongoing = await db.query(
      'SELECT id FROM learning_sessions WHERE user_id = $1 AND end_time IS NULL',
      [req.user.id]
    );

    if (ongoing.rows.length > 0) {
      return res.status(400).json({ error: 'Already clocked in. Please clock out first.' });
    }

    const result = await db.query(
      'INSERT INTO learning_sessions (user_id, start_time) VALUES ($1, CURRENT_TIMESTAMP) RETURNING *',
      [req.user.id]
    );

    res.status(201).json({
      message: 'Clocked in successfully',
      session: result.rows[0]
    });
  } catch (error) {
    console.error('Clock-in error:', error);
    res.status(500).json({ error: 'Failed to clock in' });
  }
});

// Clock-out (End learning session)
router.post('/clock-out', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
    try {
      const { reflection_text } = req.body;

      // Get ongoing session
      const session = await db.query(
        'SELECT id, start_time FROM learning_sessions WHERE user_id = $1 AND end_time IS NULL',
        [req.user.id]
      );

      if (session.rows.length === 0) {
        return res.status(400).json({ error: 'No active session found. Please clock in first.' });
      }

      const sessionId = session.rows[0].id;

      // Update session
      const result = await db.query(
        `UPDATE learning_sessions 
         SET end_time = CURRENT_TIMESTAMP, reflection_text = $1
         WHERE id = $2
         RETURNING *`,
        [reflection_text || null, sessionId]
      );

      const updatedSession = result.rows[0];
      const hours = updatedSession.duration_minutes / 60;
      const requiredHours = parseInt(process.env.REQUIRED_LEARNING_HOURS || '6');

      res.json({
        message: 'Clocked out successfully',
        session: updatedSession,
        hours_completed: hours.toFixed(2),
        meets_requirement: hours >= requiredHours,
        needs_reflection: !reflection_text
      });
    } catch (error) {
      console.error('Clock-out error:', error);
      res.status(500).json({ error: 'Failed to clock out' });
    }
  }
);

// Get today's learning sessions
router.get('/today', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, start_time, end_time, duration_minutes, reflection_text, date
       FROM learning_sessions
       WHERE user_id = $1 AND date = CURRENT_DATE
       ORDER BY start_time DESC`,
      [req.user.id]
    );

    const totalMinutes = result.rows.reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
    const requiredHours = parseInt(process.env.REQUIRED_LEARNING_HOURS || '6');

    res.json({
      sessions: result.rows,
      total_hours: (totalMinutes / 60).toFixed(2),
      required_hours: requiredHours,
      meets_requirement: (totalMinutes / 60) >= requiredHours,
      has_active_session: result.rows.some(s => !s.end_time)
    });
  } catch (error) {
    console.error('Today sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch today\'s sessions' });
  }
});

// Get learning history (with date range)
router.get('/history', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
  try {
    const { start_date, end_date, limit = 30 } = req.query;

    let query = `
      SELECT date, 
             COUNT(*) as session_count,
             SUM(duration_minutes) as total_minutes,
             STRING_AGG(reflection_text, ' | ') as reflections
      FROM learning_sessions
      WHERE user_id = $1 AND end_time IS NOT NULL
    `;

    const params = [req.user.id];
    let paramIndex = 2;

    if (start_date) {
      query += ` AND date >= $${paramIndex}`;
      params.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      query += ` AND date <= $${paramIndex}`;
      params.push(end_date);
      paramIndex++;
    }

    query += ` GROUP BY date ORDER BY date DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await db.query(query, params);

    const history = result.rows.map(row => ({
      date: row.date,
      session_count: parseInt(row.session_count),
      hours: (row.total_minutes / 60).toFixed(2),
      meets_requirement: (row.total_minutes / 60) >= parseInt(process.env.REQUIRED_LEARNING_HOURS || '6'),
      reflections: row.reflections ? row.reflections.split(' | ').filter(r => r) : []
    }));

    res.json({ history });
  } catch (error) {
    console.error('Learning history error:', error);
    res.status(500).json({ error: 'Failed to fetch learning history' });
  }
});

// Get weekly report
router.get('/weekly-report', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
         DATE_TRUNC('week', date) as week_start,
         COUNT(DISTINCT date) as days_logged,
         SUM(duration_minutes) as total_minutes,
         AVG(duration_minutes) as avg_minutes_per_session
       FROM learning_sessions
       WHERE user_id = $1 
         AND end_time IS NOT NULL
         AND date >= CURRENT_DATE - INTERVAL '8 weeks'
       GROUP BY week_start
       ORDER BY week_start DESC`,
      [req.user.id]
    );

    const requiredHours = parseInt(process.env.REQUIRED_LEARNING_HOURS || '6');
    const weeklyReport = result.rows.map(row => ({
      week_start: row.week_start,
      days_logged: parseInt(row.days_logged),
      total_hours: (row.total_minutes / 60).toFixed(2),
      avg_hours_per_session: (row.avg_minutes_per_session / 60).toFixed(2),
      compliance_percentage: ((row.total_minutes / 60) / (requiredHours * 5) * 100).toFixed(1) // Assuming 5 work days
    }));

    res.json({ weekly_report: weeklyReport });
  } catch (error) {
    console.error('Weekly report error:', error);
    res.status(500).json({ error: 'Failed to generate weekly report' });
  }
});

// Get learning streak
router.get('/streak', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
  try {
    const result = await db.query(
      `WITH daily_hours AS (
         SELECT date, SUM(duration_minutes)/60 as hours
         FROM learning_sessions
         WHERE user_id = $1 AND end_time IS NOT NULL
         GROUP BY date
       ),
       streak_data AS (
         SELECT date, hours,
                date - (ROW_NUMBER() OVER (ORDER BY date))::integer AS grp
         FROM daily_hours
         WHERE hours >= $2
       )
       SELECT COUNT(*) as streak_length, MIN(date) as streak_start, MAX(date) as streak_end
       FROM streak_data
       WHERE grp = (SELECT MAX(grp) FROM streak_data)
       GROUP BY grp`,
      [req.user.id, parseInt(process.env.REQUIRED_LEARNING_HOURS || '6')]
    );

    const streak = result.rows[0] || { streak_length: 0, streak_start: null, streak_end: null };

    res.json({
      current_streak: parseInt(streak.streak_length || 0),
      streak_start: streak.streak_start,
      streak_end: streak.streak_end
    });
  } catch (error) {
    console.error('Streak calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate streak' });
  }
});

// Supervisor: Get team learning summary
router.get('/team-summary', authenticateToken, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const supervisorId = req.user.role === 'admin' ? null : req.user.id;

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

    const params = [];
    if (supervisorId) {
      query += ' AND u.supervisor_id = $1';
      params.push(supervisorId);
    }

    query += ' GROUP BY u.id, u.full_name, u.email, u.archetype ORDER BY u.full_name';

    const result = await db.query(query, params);

    const requiredHours = parseInt(process.env.REQUIRED_LEARNING_HOURS || '6');
    const workDaysThisMonth = 20; // Approximate

    const teamSummary = result.rows.map(row => {
      const totalHours = (row.total_minutes_this_month || 0) / 60;
      const expectedHours = workDaysThisMonth * requiredHours;
      const compliancePercentage = (totalHours / expectedHours * 100).toFixed(1);

      return {
        id: row.id,
        full_name: row.full_name,
        email: row.email,
        archetype: row.archetype,
        days_logged: parseInt(row.days_logged_this_month || 0),
        total_hours: totalHours.toFixed(2),
        compliance_percentage: compliancePercentage,
        last_active: row.last_active_date,
        is_idle: !row.last_active_date || (new Date() - new Date(row.last_active_date)) > 3 * 24 * 60 * 60 * 1000
      };
    });

    res.json({ team_summary: teamSummary });
  } catch (error) {
    console.error('Team summary error:', error);
    res.status(500).json({ error: 'Failed to fetch team summary' });
  }
});

module.exports = router;