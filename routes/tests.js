const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../config/database');
const { authenticateToken, authorize } = require('../middleware/auth');

const router = express.Router();

// Create test (Admin only)
router.post('/',
  authenticateToken,
  authorize('admin'),
  [
    body('course_id').isInt(),
    body('title').trim().notEmpty(),
    body('test_type').isIn(['multiple_choice', 'written', 'coding']),
    body('questions').isArray({ min: 1 })
  ],
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ errors: errors.array() });
      }

      const { course_id, title, description, test_type, passing_score, time_limit_minutes, max_attempts, questions } = req.body;

      // Insert test
      const testResult = await client.query(
        `INSERT INTO tests (course_id, title, description, test_type, passing_score, time_limit_minutes, max_attempts, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [course_id, title, description || null, test_type, passing_score || 70, time_limit_minutes || null, max_attempts || 3, req.user.id]
      );

      const test = testResult.rows[0];

      // Insert questions
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const questionResult = await client.query(
          `INSERT INTO test_questions (test_id, question_text, question_type, points, order_index)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [test.id, q.question_text, q.question_type || test_type, q.points || 1, i]
        );

        const questionId = questionResult.rows[0].id;

        // Insert options for MCQ
        if ((q.question_type || test_type) === 'multiple_choice' && q.options) {
          for (let j = 0; j < q.options.length; j++) {
            const opt = q.options[j];
            await client.query(
              `INSERT INTO question_options (question_id, option_text, is_correct, order_index)
               VALUES ($1, $2, $3, $4)`,
              [questionId, opt.option_text, opt.is_correct || false, j]
            );
          }
        }
      }

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Test created successfully',
        test
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Test creation error:', error);
      res.status(500).json({ error: 'Failed to create test' });
    } finally {
      client.release();
    }
  }
);

// Get test details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const testId = req.params.id;

    const testResult = await db.query(
      `SELECT t.*, c.title as course_title
       FROM tests t
       JOIN courses c ON t.course_id = c.id
       WHERE t.id = $1`,
      [testId]
    );

    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const test = testResult.rows[0];

    // Get questions
    const questionsResult = await db.query(
      'SELECT * FROM test_questions WHERE test_id = $1 ORDER BY order_index',
      [testId]
    );

    // Get options for each question
    const questions = await Promise.all(questionsResult.rows.map(async (q) => {
      if (q.question_type === 'multiple_choice') {
        const optionsResult = await db.query(
          'SELECT id, option_text, order_index FROM question_options WHERE question_id = $1 ORDER BY order_index',
          [q.id]
        );
        q.options = optionsResult.rows;
      }
      return q;
    }));

    // Get user's attempts
    const attemptsResult = await db.query(
      'SELECT id, status, started_at, submitted_at, score, attempt_number FROM test_attempts WHERE test_id = $1 AND user_id = $2 ORDER BY attempt_number DESC',
      [testId, req.user.id]
    );

    res.json({
      test,
      questions,
      attempts: attemptsResult.rows,
      attempts_remaining: Math.max(0, (test.max_attempts || 3) - attemptsResult.rows.length)
    });
  } catch (error) {
    console.error('Test fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch test' });
  }
});

// Start test attempt
router.post('/:id/start', authenticateToken, authorize('learner', 'candidate'), async (req, res) => {
  try {
    const testId = req.params.id;

    // Get test info
    const testResult = await db.query('SELECT max_attempts FROM tests WHERE id = $1', [testId]);
    if (testResult.rows.length === 0) {
      return res.status(404).json({ error: 'Test not found' });
    }

    const maxAttempts = testResult.rows[0].max_attempts || 3;

    // Check attempts count
    const attemptsResult = await db.query(
      'SELECT COUNT(*) as count FROM test_attempts WHERE test_id = $1 AND user_id = $2',
      [testId, req.user.id]
    );

    if (parseInt(attemptsResult.rows[0].count) >= maxAttempts) {
      return res.status(400).json({ error: 'Maximum attempts reached' });
    }

    // Create attempt
    const attemptNumber = parseInt(attemptsResult.rows[0].count) + 1;
    const result = await db.query(
      `INSERT INTO test_attempts (test_id, user_id, status, attempt_number)
       VALUES ($1, $2, 'in_progress', $3)
       RETURNING *`,
      [testId, req.user.id, attemptNumber]
    );

    res.status(201).json({
      message: 'Test attempt started',
      attempt: result.rows[0]
    });
  } catch (error) {
    console.error('Test start error:', error);
    res.status(500).json({ error: 'Failed to start test' });
  }
});

// Submit test answers
router.post('/attempts/:attemptId/submit',
  authenticateToken,
  authorize('learner', 'candidate'),
  [body('answers').isArray({ min: 1 })],
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const attemptId = req.params.attemptId;
      const { answers } = req.body;

      // Verify attempt belongs to user
      const attemptResult = await client.query(
        'SELECT id, test_id, status FROM test_attempts WHERE id = $1 AND user_id = $2',
        [attemptId, req.user.id]
      );

      if (attemptResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Attempt not found' });
      }

      if (attemptResult.rows[0].status !== 'in_progress') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Test already submitted' });
      }

      const testId = attemptResult.rows[0].test_id;

      // Get test type
      const testResult = await client.query('SELECT test_type FROM tests WHERE id = $1', [testId]);
      const testType = testResult.rows[0].test_type;

      // Insert answers and auto-grade MCQs
      let totalPoints = 0;
      let earnedPoints = 0;

      for (const answer of answers) {
        const questionResult = await client.query(
          'SELECT points, question_type FROM test_questions WHERE id = $1',
          [answer.question_id]
        );

        const question = questionResult.rows[0];
        totalPoints += question.points;

        let pointsAwarded = null;

        // Auto-grade MCQ
        if (question.question_type === 'multiple_choice' && answer.selected_option_id) {
          const optionResult = await client.query(
            'SELECT is_correct FROM question_options WHERE id = $1',
            [answer.selected_option_id]
          );

          if (optionResult.rows.length > 0 && optionResult.rows[0].is_correct) {
            pointsAwarded = question.points;
            earnedPoints += pointsAwarded;
          } else {
            pointsAwarded = 0;
          }
        }

        await client.query(
          `INSERT INTO test_answers (attempt_id, question_id, answer_text, selected_option_id, points_awarded)
           VALUES ($1, $2, $3, $4, $5)`,
          [attemptId, answer.question_id, answer.answer_text || null, answer.selected_option_id || null, pointsAwarded]
        );
      }

      // Update attempt
      const score = testType === 'multiple_choice' ? (earnedPoints / totalPoints * 100).toFixed(2) : null;

      await client.query(
        `UPDATE test_attempts 
         SET status = 'submitted', 
             submitted_at = CURRENT_TIMESTAMP,
             score = $1,
             graded_at = CASE WHEN $2 = 'multiple_choice' THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = $3`,
        [score, testType, attemptId]
      );

      await client.query('COMMIT');

      res.json({
        message: testType === 'multiple_choice' ? 'Test submitted and graded' : 'Test submitted, awaiting manual grading',
        score: score ? parseFloat(score) : null,
        needs_grading: testType !== 'multiple_choice'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Test submission error:', error);
      res.status(500).json({ error: 'Failed to submit test' });
    } finally {
      client.release();
    }
  }
);

// Grade test manually (Supervisor/Admin)
router.post('/attempts/:attemptId/grade',
  authenticateToken,
  authorize('supervisor', 'admin'),
  [
    body('answers').isArray({ min: 1 }),
    body('feedback').optional().trim()
  ],
  async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const attemptId = req.params.attemptId;
      const { answers, feedback } = req.body;

      // Verify attempt exists
      const attemptResult = await client.query(
        'SELECT id, status FROM test_attempts WHERE id = $1',
        [attemptId]
      );

      if (attemptResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Attempt not found' });
      }

      if (attemptResult.rows[0].status !== 'submitted') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Test not in submitted state' });
      }

      // Update answer scores
      let totalPoints = 0;
      let earnedPoints = 0;

      for (const answer of answers) {
        const questionResult = await client.query(
          'SELECT points FROM test_questions WHERE id = $1',
          [answer.question_id]
        );

        totalPoints += questionResult.rows[0].points;
        earnedPoints += answer.points_awarded || 0;

        await client.query(
          `UPDATE test_answers 
           SET points_awarded = $1, feedback = $2
           WHERE attempt_id = $3 AND question_id = $4`,
          [answer.points_awarded, answer.feedback || null, attemptId, answer.question_id]
        );
      }

      const score = (earnedPoints / totalPoints * 100).toFixed(2);

      // Update attempt
      await client.query(
        `UPDATE test_attempts 
         SET status = 'graded',
             score = $1,
             graded_at = CURRENT_TIMESTAMP,
             graded_by = $2,
             feedback = $3
         WHERE id = $4`,
        [score, req.user.id, feedback || null, attemptId]
      );

      await client.query('COMMIT');

      res.json({
        message: 'Test graded successfully',
        score: parseFloat(score)
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Grading error:', error);
      res.status(500).json({ error: 'Failed to grade test' });
    } finally {
      client.release();
    }
  }
);

// Get tests needing grading (Supervisor/Admin)
router.get('/pending/grading', authenticateToken, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT ta.id as attempt_id, ta.test_id, ta.user_id, ta.submitted_at,
              t.title as test_title, t.course_id,
              u.full_name as student_name,
              c.title as course_title
       FROM test_attempts ta
       JOIN tests t ON ta.test_id = t.id
       JOIN users u ON ta.user_id = u.id
       JOIN courses c ON t.course_id = c.id
       WHERE ta.status = 'submitted' AND t.test_type != 'multiple_choice'
       ORDER BY ta.submitted_at ASC`
    );

    res.json({ pending_tests: result.rows });
  } catch (error) {
    console.error('Pending tests error:', error);
    res.status(500).json({ error: 'Failed to fetch pending tests' });
  }
});

module.exports = router;