const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');
const { notifyCandidateStatus } = require('../config/notifications');

const router = express.Router();

// Get available tests for candidate
router.get('/available', authenticateToken, authorize('candidate'), async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get candidate's enrolled course
    const enrollment = await db.query(
      'SELECT course_id FROM enrollments WHERE user_id = $1 LIMIT 1',
      [userId]
    );

    if (enrollment.rows.length === 0) {
      return res.json({ tests: [] });
    }

    const courseId = enrollment.rows[0].course_id;

    // Get tests for that course
    const tests = await db.query(
      `SELECT t.id, t.title, t.description, t.test_type, t.passing_score, 
              t.time_limit_minutes, t.max_attempts,
              COUNT(ta.id) as attempts_made
       FROM tests t
       LEFT JOIN test_attempts ta ON t.id = ta.test_id AND ta.user_id = $1
       WHERE t.course_id = $2
       GROUP BY t.id
       HAVING COUNT(ta.id) < t.max_attempts OR t.max_attempts IS NULL`,
      [userId, courseId]
    );

    res.json({ tests: tests.rows });
  } catch (error) {
    console.error('Fetch available tests error:', error);
    res.status(500).json({ error: 'Failed to fetch tests' });
  }
});

// Start test attempt
router.post('/:testId/start', authenticateToken, authorize('candidate'), async (req, res) => {
  try {
    const { testId } = req.params;
    const userId = req.user.id;

    // Check if test exists
    const test = await db.query(
      'SELECT id, max_attempts, test_type FROM tests WHERE id = $1',
      [testId]
    );

    if (test.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    // Check attempts
    const attempts = await db.query(
      'SELECT COUNT(*) as count FROM test_attempts WHERE test_id = $1 AND user_id = $2',
      [testId, userId]
    );

    const maxAttempts = test.rows[0].max_attempts || 3;
    if (parseInt(attempts.rows[0].count) >= maxAttempts) {
      return res.status(400).json({ error: 'Maximum attempts reached' });
    }

    // Create attempt with timestamp
    const attemptNumber = parseInt(attempts.rows[0].count) + 1;
    const attempt = await db.query(
      `INSERT INTO test_attempts (test_id, user_id, status, attempt_number, started_at)
       VALUES ($1, $2, 'in_progress', $3, CURRENT_TIMESTAMP)
       RETURNING *`,
      [testId, userId, attemptNumber]
    );

    // Get test questions
    const questions = await db.query(
      `SELECT q.id, q.question_text, q.question_type, q.points, q.order_index
       FROM test_questions q
       WHERE q.test_id = $1
       ORDER BY q.order_index`,
      [testId]
    );

    // Get options for MCQ questions
    const questionsWithOptions = await Promise.all(
      questions.rows.map(async (q) => {
        if (q.question_type === 'multiple_choice') {
          const options = await db.query(
            `SELECT id, option_text, order_index 
             FROM question_options 
             WHERE question_id = $1 
             ORDER BY order_index`,
            [q.id]
          );
          q.options = options.rows;
        }
        return q;
      })
    );

    res.json({
      attempt: attempt.rows[0],
      questions: questionsWithOptions,
      test_info: test.rows[0]
    });
  } catch (error) {
    console.error('Start test error:', error);
    res.status(500).json({ error: 'Failed to start test' });
  }
});

// Submit test answers
router.post('/:testId/submit', 
  authenticateToken, 
  authorize('candidate'),
  [body('attempt_id').isInt(), body('answers').isArray({ min: 1 })],
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { testId } = req.params;
      const { attempt_id, answers } = req.body;
      const userId = req.user.id;

      // Verify attempt
      const attempt = await client.query(
        'SELECT id, test_id, status FROM test_attempts WHERE id = $1 AND user_id = $2',
        [attempt_id, userId]
      );

      if (attempt.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Test attempt not found' });
      }

      if (attempt.rows[0].status !== 'in_progress') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Test already submitted' });
      }

      // Get test details
      const test = await client.query(
        'SELECT test_type, passing_score FROM tests WHERE id = $1',
        [testId]
      );

      const testType = test.rows[0].test_type;
      const passingScore = test.rows[0].passing_score || 70;

      // Process answers and calculate score
      let totalPoints = 0;
      let earnedPoints = 0;
      let autoGradable = true;

      for (const answer of answers) {
        const question = await client.query(
          'SELECT points, question_type FROM test_questions WHERE id = $1',
          [answer.question_id]
        );

        if (question.rows.length === 0) continue;

        const questionPoints = question.rows[0].points;
        const questionType = question.rows[0].question_type;
        totalPoints += questionPoints;

        let pointsAwarded = null;

        // Auto-grade MCQ
        if (questionType === 'multiple_choice' && answer.selected_option_id) {
          const option = await client.query(
            'SELECT is_correct FROM question_options WHERE id = $1',
            [answer.selected_option_id]
          );

          if (option.rows.length > 0 && option.rows[0].is_correct) {
            pointsAwarded = questionPoints;
            earnedPoints += pointsAwarded;
          } else {
            pointsAwarded = 0;
          }
        } else {
          // Non-MCQ questions need manual grading
          autoGradable = false;
        }

        // Save answer
        await client.query(
          `INSERT INTO test_answers (attempt_id, question_id, answer_text, selected_option_id, points_awarded)
           VALUES ($1, $2, $3, $4, $5)`,
          [attempt_id, answer.question_id, answer.answer_text || null, answer.selected_option_id || null, pointsAwarded]
        );
      }

      // Calculate score and status
      let score = null;
      let status = 'submitted';
      let feedback = null;

      if (autoGradable && totalPoints > 0) {
        score = Math.round((earnedPoints / totalPoints) * 100);
        status = 'graded';
        
        // Generate feedback
        if (score >= passingScore) {
          feedback = `Excellent work! You scored ${score}% and passed the assessment. Your strong performance demonstrates your understanding of the material.`;
        } else {
          feedback = `You scored ${score}%. While you didn't reach the passing score of ${passingScore}%, this is a learning opportunity. Review the materials and consider the areas where you can improve.`;
        }
      } else {
        feedback = 'Your responses have been submitted and are awaiting manual review by our team. You will be notified once grading is complete.';
      }

      // Update attempt
      await client.query(
        `UPDATE test_attempts 
         SET status = $1, 
             submitted_at = CURRENT_TIMESTAMP,
             score = $2,
             graded_at = CASE WHEN $1 = 'graded' THEN CURRENT_TIMESTAMP ELSE NULL END,
             feedback = $3
         WHERE id = $4`,
        [status, score, feedback, attempt_id]
      );

      // Get user info for notifications
      const user = await client.query(
        'SELECT email, full_name, phone_number FROM users WHERE id = $1',
        [userId]
      );

      await client.query('COMMIT');

      // Send notifications
      if (status === 'graded') {
        const notificationStatus = score >= passingScore ? 'passed' : 'failed';
        await notifyCandidateStatus(user.rows[0], notificationStatus, score);
        
        // Create in-app notification
        await db.query(
          `INSERT INTO notifications (user_id, title, message, notification_type)
           VALUES ($1, $2, $3, $4)`,
          [
            userId,
            score >= passingScore ? '🎉 Assessment Passed!' : 'Assessment Results',
            feedback,
            'test_result'
          ]
        );
      } else {
        await notifyCandidateStatus(user.rows[0], 'pending');
        
        await db.query(
          `INSERT INTO notifications (user_id, title, message, notification_type)
           VALUES ($1, $2, $3, $4)`,
          [userId, 'Assessment Submitted', feedback, 'test_submitted']
        );
      }

      res.json({
        message: autoGradable ? 'Test graded successfully' : 'Test submitted for review',
        score,
        status,
        feedback,
        passed: score !== null && score >= passingScore
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Submit test error:', error);
      res.status(500).json({ error: 'Failed to submit test' });
    } finally {
      client.release();
    }
  }
);

// Get test results
router.get('/results', authenticateToken, authorize('candidate'), async (req, res) => {
  try {
    const userId = req.user.id;

    const results = await db.query(
      `SELECT ta.*, t.title as test_title, t.passing_score, t.test_type
       FROM test_attempts ta
       JOIN tests t ON ta.test_id = t.id
       WHERE ta.user_id = $1
       ORDER BY ta.submitted_at DESC`,
      [userId]
    );

    res.json({ results: results.rows });
  } catch (error) {
    console.error('Fetch results error:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

module.exports = router;