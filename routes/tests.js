const express = require("express");
const { body, validationResult } = require("express-validator");
const {
  sequelize,
  Test,
  TestQuestion,
  QuestionOption,
  TestAttempt,
  TestAnswer,
  Course,
} = require("../models");
const { authenticateToken, authorize } = require("../middleware/auth");
const { QueryTypes } = require("sequelize");

const router = express.Router();

// Create test (Admin only)
router.post(
  "/",
  authenticateToken,
  authorize("admin"),
  [
    body("course_id").isInt(),
    body("title").trim().notEmpty(),
    body("test_type").isIn(["multiple_choice", "written", "coding"]),
    body("questions").isArray({ min: 1 }),
  ],
  async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        await t.rollback();
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        course_id,
        title,
        description,
        test_type,
        passing_score,
        time_limit_minutes,
        max_attempts,
        questions,
      } = req.body;

      const test = await Test.create(
        {
          course_id,
          title,
          description: description || null,
          test_type,
          passing_score: passing_score || 70,
          time_limit_minutes: time_limit_minutes || null,
          max_attempts: max_attempts || 3,
          created_by: req.user.id,
        },
        { transaction: t },
      );

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const question = await TestQuestion.create(
          {
            test_id: test.id,
            question_text: q.question_text,
            question_type: q.question_type || test_type,
            points: q.points || 1,
            order_index: i,
          },
          { transaction: t },
        );

        if ((q.question_type || test_type) === "multiple_choice" && q.options) {
          for (let j = 0; j < q.options.length; j++) {
            const opt = q.options[j];
            await QuestionOption.create(
              {
                question_id: question.id,
                option_text: opt.option_text,
                is_correct: opt.is_correct || false,
                order_index: j,
              },
              { transaction: t },
            );
          }
        }
      }

      await t.commit();

      res.status(201).json({
        message: "Test created successfully",
        test,
      });
    } catch (error) {
      await t.rollback();
      console.error("Test creation error:", error);
      res.status(500).json({ error: "Failed to create test" });
    }
  },
);

// Get test details
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const testId = req.params.id;

    const test = await Test.findByPk(testId, {
      include: [{ model: Course, attributes: ["title"] }],
    });

    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const plain = test.get({ plain: true });
    plain.course_title = plain.Course ? plain.Course.title : null;
    delete plain.Course;

    // Get questions
    const questions = await TestQuestion.findAll({
      where: { test_id: testId },
      order: [["order_index", "ASC"]],
    });

    const questionsWithOptions = await Promise.all(
      questions.map(async (q) => {
        const qPlain = q.get({ plain: true });
        if (qPlain.question_type === "multiple_choice") {
          const options = await QuestionOption.findAll({
            where: { question_id: qPlain.id },
            attributes: ["id", "option_text", "order_index"],
            order: [["order_index", "ASC"]],
          });
          qPlain.options = options.map((o) => o.get({ plain: true }));
        }
        return qPlain;
      }),
    );

    // Get user's attempts
    const attempts = await TestAttempt.findAll({
      where: { test_id: testId, user_id: req.user.id },
      attributes: [
        "id",
        "status",
        "started_at",
        "submitted_at",
        "score",
        "attempt_number",
      ],
      order: [["attempt_number", "DESC"]],
    });

    res.json({
      test: plain,
      questions: questionsWithOptions,
      attempts: attempts.map((a) => a.get({ plain: true })),
      attempts_remaining: Math.max(
        0,
        (plain.max_attempts || 3) - attempts.length,
      ),
    });
  } catch (error) {
    console.error("Test fetch error:", error);
    res.status(500).json({ error: "Failed to fetch test" });
  }
});

// Start test attempt
router.post(
  "/:id/start",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const testId = req.params.id;

      const test = await Test.findByPk(testId, {
        attributes: ["id", "max_attempts"],
      });
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const maxAttempts = test.max_attempts || 3;
      const attemptCount = await TestAttempt.count({
        where: { test_id: testId, user_id: req.user.id },
      });

      if (attemptCount >= maxAttempts) {
        return res.status(400).json({ error: "Maximum attempts reached" });
      }

      const attempt = await TestAttempt.create({
        test_id: testId,
        user_id: req.user.id,
        status: "in_progress",
        attempt_number: attemptCount + 1,
      });

      res.status(201).json({
        message: "Test attempt started",
        attempt,
      });
    } catch (error) {
      console.error("Test start error:", error);
      res.status(500).json({ error: "Failed to start test" });
    }
  },
);

// Submit test answers
router.post(
  "/attempts/:attemptId/submit",
  authenticateToken,
  authorize("learner", "candidate"),
  [body("answers").isArray({ min: 1 })],
  async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const attemptId = req.params.attemptId;
      const { answers } = req.body;

      const attempt = await TestAttempt.findOne({
        where: { id: attemptId, user_id: req.user.id },
        attributes: ["id", "test_id", "status"],
        transaction: t,
      });

      if (!attempt) {
        await t.rollback();
        return res.status(404).json({ error: "Attempt not found" });
      }

      if (attempt.status !== "in_progress") {
        await t.rollback();
        return res.status(400).json({ error: "Test already submitted" });
      }

      const test = await Test.findByPk(attempt.test_id, {
        attributes: ["test_type"],
        transaction: t,
      });
      const testType = test.test_type;

      let totalPoints = 0;
      let earnedPoints = 0;

      for (const answer of answers) {
        const question = await TestQuestion.findByPk(answer.question_id, {
          attributes: ["points", "question_type"],
          transaction: t,
        });

        totalPoints += question.points;
        let pointsAwarded = null;

        if (
          question.question_type === "multiple_choice" &&
          answer.selected_option_id
        ) {
          const option = await QuestionOption.findByPk(
            answer.selected_option_id,
            {
              attributes: ["is_correct"],
              transaction: t,
            },
          );

          if (option && option.is_correct) {
            pointsAwarded = question.points;
            earnedPoints += pointsAwarded;
          } else {
            pointsAwarded = 0;
          }
        }

        await TestAnswer.create(
          {
            attempt_id: attemptId,
            question_id: answer.question_id,
            answer_text: answer.answer_text || null,
            selected_option_id: answer.selected_option_id || null,
            points_awarded: pointsAwarded,
          },
          { transaction: t },
        );
      }

      const score =
        testType === "multiple_choice"
          ? ((earnedPoints / totalPoints) * 100).toFixed(2)
          : null;

      await attempt.update(
        {
          status: "submitted",
          submitted_at: new Date(),
          score,
          graded_at: testType === "multiple_choice" ? new Date() : null,
        },
        { transaction: t },
      );

      await t.commit();

      res.json({
        message:
          testType === "multiple_choice"
            ? "Test submitted and graded"
            : "Test submitted, awaiting manual grading",
        score: score ? parseFloat(score) : null,
        needs_grading: testType !== "multiple_choice",
      });
    } catch (error) {
      await t.rollback();
      console.error("Test submission error:", error);
      res.status(500).json({ error: "Failed to submit test" });
    }
  },
);

// Grade test manually (Supervisor/Admin)
router.post(
  "/attempts/:attemptId/grade",
  authenticateToken,
  authorize("supervisor", "admin"),
  [body("answers").isArray({ min: 1 }), body("feedback").optional().trim()],
  async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const attemptId = req.params.attemptId;
      const { answers, feedback } = req.body;

      const attempt = await TestAttempt.findByPk(attemptId, {
        attributes: ["id", "status"],
        transaction: t,
      });

      if (!attempt) {
        await t.rollback();
        return res.status(404).json({ error: "Attempt not found" });
      }

      if (attempt.status !== "submitted") {
        await t.rollback();
        return res.status(400).json({ error: "Test not in submitted state" });
      }

      let totalPoints = 0;
      let earnedPoints = 0;

      for (const answer of answers) {
        const question = await TestQuestion.findByPk(answer.question_id, {
          attributes: ["points"],
          transaction: t,
        });

        totalPoints += question.points;
        earnedPoints += answer.points_awarded || 0;

        await TestAnswer.update(
          {
            points_awarded: answer.points_awarded,
            feedback: answer.feedback || null,
          },
          {
            where: { attempt_id: attemptId, question_id: answer.question_id },
            transaction: t,
          },
        );
      }

      const score = ((earnedPoints / totalPoints) * 100).toFixed(2);

      await attempt.update(
        {
          status: "graded",
          score,
          graded_at: new Date(),
          graded_by: req.user.id,
          feedback: feedback || null,
        },
        { transaction: t },
      );

      await t.commit();

      res.json({
        message: "Test graded successfully",
        score: parseFloat(score),
      });
    } catch (error) {
      await t.rollback();
      console.error("Grading error:", error);
      res.status(500).json({ error: "Failed to grade test" });
    }
  },
);

// Get tests needing grading (Supervisor/Admin)
router.get(
  "/pending/grading",
  authenticateToken,
  authorize("supervisor", "admin"),
  async (req, res) => {
    try {
      const result = await sequelize.query(
        `SELECT ta.id as attempt_id, ta.test_id, ta.user_id, ta.submitted_at,
              t.title as test_title, t.course_id,
              u.full_name as student_name,
              c.title as course_title
       FROM test_attempts ta
       JOIN tests t ON ta.test_id = t.id
       JOIN users u ON ta.user_id = u.id
       JOIN courses c ON t.course_id = c.id
       WHERE ta.status = 'submitted' AND t.test_type != 'multiple_choice'
       ORDER BY ta.submitted_at ASC`,
        { type: QueryTypes.SELECT },
      );

      res.json({ pending_tests: result });
    } catch (error) {
      console.error("Pending tests error:", error);
      res.status(500).json({ error: "Failed to fetch pending tests" });
    }
  },
);

module.exports = router;
