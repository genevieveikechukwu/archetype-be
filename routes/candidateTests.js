const express = require("express");
const { body, validationResult } = require("express-validator");
const {
  sequelize,
  Test,
  TestAttempt,
  TestQuestion,
  QuestionOption,
  TestAnswer,
  Enrollment,
  User,
  Notification,
} = require("../models");
const { authenticateToken, authorize } = require("../middleware/auth");
const { notifyCandidateStatus } = require("../config/notifications");
const { QueryTypes } = require("sequelize");

const router = express.Router();

// Get available tests for candidate
router.get(
  "/available",
  authenticateToken,
  authorize("candidate"),
  async (req, res) => {
    try {
      const userId = req.user.id;

      // Get candidate's enrolled course
      const enrollment = await Enrollment.findOne({
        where: { user_id: userId },
        attributes: ["course_id"],
      });

      if (!enrollment) {
        return res.json({ tests: [] });
      }

      const courseId = enrollment.course_id;

      // Complex GROUP BY + HAVING — use raw query
      const tests = await sequelize.query(
        `SELECT t.id, t.title, t.description, t.test_type, t.passing_score, 
              t.time_limit_minutes, t.max_attempts,
              COUNT(ta.id) as attempts_made
       FROM tests t
       LEFT JOIN test_attempts ta ON t.id = ta.test_id AND ta.user_id = :userId
       WHERE t.course_id = :courseId
       GROUP BY t.id
       HAVING COUNT(ta.id) < t.max_attempts OR t.max_attempts IS NULL`,
        { replacements: { userId, courseId }, type: QueryTypes.SELECT },
      );

      res.json({ tests });
    } catch (error) {
      console.error("Fetch available tests error:", error);
      res.status(500).json({ error: "Failed to fetch tests" });
    }
  },
);

// Start test attempt
router.post(
  "/:testId/start",
  authenticateToken,
  authorize("candidate"),
  async (req, res) => {
    try {
      const { testId } = req.params;
      const userId = req.user.id;

      const test = await Test.findByPk(testId, {
        attributes: ["id", "max_attempts", "test_type"],
      });
      if (!test) {
        return res.status(404).json({ error: "Test not found" });
      }

      const attemptCount = await TestAttempt.count({
        where: { test_id: testId, user_id: userId },
      });
      const maxAttempts = test.max_attempts || 3;
      if (attemptCount >= maxAttempts) {
        return res.status(400).json({ error: "Maximum attempts reached" });
      }

      const attempt = await TestAttempt.create({
        test_id: testId,
        user_id: userId,
        status: "in_progress",
        attempt_number: attemptCount + 1,
        started_at: new Date(),
      });

      // Get test questions with options
      const questions = await TestQuestion.findAll({
        where: { test_id: testId },
        attributes: [
          "id",
          "question_text",
          "question_type",
          "points",
          "order_index",
        ],
        order: [["order_index", "ASC"]],
      });

      const questionsWithOptions = await Promise.all(
        questions.map(async (q) => {
          const plain = q.get({ plain: true });
          if (plain.question_type === "multiple_choice") {
            const options = await QuestionOption.findAll({
              where: { question_id: plain.id },
              attributes: ["id", "option_text", "order_index"],
              order: [["order_index", "ASC"]],
            });
            plain.options = options.map((o) => o.get({ plain: true }));
          }
          return plain;
        }),
      );

      res.json({
        attempt,
        questions: questionsWithOptions,
        test_info: test,
      });
    } catch (error) {
      console.error("Start test error:", error);
      res.status(500).json({ error: "Failed to start test" });
    }
  },
);

// Submit test answers
router.post(
  "/:testId/submit",
  authenticateToken,
  authorize("candidate"),
  [body("attempt_id").isInt(), body("answers").isArray({ min: 1 })],
  async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { testId } = req.params;
      const { attempt_id, answers } = req.body;
      const userId = req.user.id;

      // Verify attempt
      const attempt = await TestAttempt.findOne({
        where: { id: attempt_id, user_id: userId },
        attributes: ["id", "test_id", "status"],
        transaction: t,
      });

      if (!attempt) {
        await t.rollback();
        return res.status(404).json({ error: "Test attempt not found" });
      }

      if (attempt.status !== "in_progress") {
        await t.rollback();
        return res.status(400).json({ error: "Test already submitted" });
      }

      // Get test details
      const test = await Test.findByPk(testId, {
        attributes: ["test_type", "passing_score"],
        transaction: t,
      });

      const testType = test.test_type;
      const passingScore = test.passing_score || 70;

      // Process answers
      let totalPoints = 0;
      let earnedPoints = 0;
      let autoGradable = true;

      for (const answer of answers) {
        const question = await TestQuestion.findByPk(answer.question_id, {
          attributes: ["points", "question_type"],
          transaction: t,
        });

        if (!question) continue;

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
        } else {
          autoGradable = false;
        }

        await TestAnswer.create(
          {
            attempt_id,
            question_id: answer.question_id,
            answer_text: answer.answer_text || null,
            selected_option_id: answer.selected_option_id || null,
            points_awarded: pointsAwarded,
          },
          { transaction: t },
        );
      }

      let score = null;
      let status = "submitted";
      let feedback = null;

      if (autoGradable && totalPoints > 0) {
        score = Math.round((earnedPoints / totalPoints) * 100);
        status = "graded";

        if (score >= passingScore) {
          feedback = `Excellent work! You scored ${score}% and passed the assessment. Your strong performance demonstrates your understanding of the material.`;
        } else {
          feedback = `You scored ${score}%. While you didn't reach the passing score of ${passingScore}%, this is a learning opportunity. Review the materials and consider the areas where you can improve.`;
        }
      } else {
        feedback =
          "Your responses have been submitted and are awaiting manual review by our team. You will be notified once grading is complete.";
      }

      await attempt.update(
        {
          status,
          submitted_at: new Date(),
          score,
          graded_at: status === "graded" ? new Date() : null,
          feedback,
        },
        { transaction: t },
      );

      const user = await User.findByPk(userId, {
        attributes: ["email", "full_name", "phone_number"],
        transaction: t,
      });

      await t.commit();

      // Send notifications (outside transaction)
      if (status === "graded") {
        const notificationStatus = score >= passingScore ? "passed" : "failed";
        await notifyCandidateStatus(
          user.get({ plain: true }),
          notificationStatus,
          score,
        );

        await Notification.create({
          user_id: userId,
          title:
            score >= passingScore
              ? "🎉 Assessment Passed!"
              : "Assessment Results",
          message: feedback,
          notification_type: "test_result",
        });
      } else {
        await notifyCandidateStatus(user.get({ plain: true }), "pending");

        await Notification.create({
          user_id: userId,
          title: "Assessment Submitted",
          message: feedback,
          notification_type: "test_submitted",
        });
      }

      res.json({
        message: autoGradable
          ? "Test graded successfully"
          : "Test submitted for review",
        score,
        status,
        feedback,
        passed: score !== null && score >= passingScore,
      });
    } catch (error) {
      await t.rollback();
      console.error("Submit test error:", error);
      res.status(500).json({ error: "Failed to submit test" });
    }
  },
);

// Get test results
router.get(
  "/results",
  authenticateToken,
  authorize("candidate"),
  async (req, res) => {
    try {
      const userId = req.user.id;

      const results = await TestAttempt.findAll({
        where: { user_id: userId },
        include: [
          { model: Test, attributes: ["title", "passing_score", "test_type"] },
        ],
        order: [["submitted_at", "DESC"]],
      });

      const mapped = results.map((r) => {
        const plain = r.get({ plain: true });
        plain.test_title = plain.Test ? plain.Test.title : null;
        plain.passing_score = plain.Test ? plain.Test.passing_score : null;
        plain.test_type = plain.Test ? plain.Test.test_type : null;
        delete plain.Test;
        return plain;
      });

      res.json({ results: mapped });
    } catch (error) {
      console.error("Fetch results error:", error);
      res.status(500).json({ error: "Failed to fetch results" });
    }
  },
);

module.exports = router;
