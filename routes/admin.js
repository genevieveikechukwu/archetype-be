const express = require("express");
const bcrypt = require("bcrypt");
const { body, validationResult } = require("express-validator");
const {
  User,
  Enrollment,
  LearningSession,
  CourseContent,
  TestAttempt,
  Test,
  Notification,
  sequelize,
} = require("../models");
const { Op } = require("sequelize");
const { authenticateToken, authorize } = require("../middleware/auth");
const { notifyCandidateStatus } = require("../config/notifications");
const multer = require("multer");
const path = require("path");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 },
});

// ========== USER MANAGEMENT ==========

// Get all users
router.get(
  "/users",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const [users] = await sequelize.query(`
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

      res.json({ users });
    } catch (error) {
      console.error("Fetch users error:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  },
);

// Create user (any role)
router.post(
  "/users",
  authenticateToken,
  authorize("admin"),
  [
    body("email").isEmail().normalizeEmail(),
    body("password").isLength({ min: 8 }),
    body("full_name").trim().notEmpty(),
    body("role").isIn(["candidate", "learner", "supervisor", "admin"]),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password, full_name, role, archetype, supervisor_id } =
        req.body;

      const existingUser = await User.findOne({
        where: { email },
        attributes: ["id"],
      });
      if (existingUser) {
        return res.status(409).json({ error: "Email already exists" });
      }

      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);

      const user = await User.create({
        email,
        password_hash,
        full_name,
        role,
        archetype: archetype || null,
        supervisor_id: supervisor_id || null,
      });

      res.status(201).json({
        message: "User created successfully",
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          archetype: user.archetype,
          created_at: user.created_at,
        },
      });
    } catch (error) {
      console.error("Create user error:", error);
      res.status(500).json({ error: "Failed to create user" });
    }
  },
);

// Update user details
router.put(
  "/users/:userId",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { full_name, email, role, archetype, supervisor_id } = req.body;

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await user.update({
        full_name: full_name || user.full_name,
        email: email || user.email,
        role: role || user.role,
        archetype: archetype || user.archetype,
        supervisor_id: supervisor_id,
      });

      res.json({
        message: "User updated successfully",
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          archetype: user.archetype,
          is_active: user.is_active,
        },
      });
    } catch (error) {
      console.error("Update user error:", error);
      res.status(500).json({ error: "Failed to update user" });
    }
  },
);

// Change username (email)
router.put(
  "/users/:userId/username",
  authenticateToken,
  authorize("admin"),
  [body("new_email").isEmail().normalizeEmail()],
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { new_email } = req.body;

      const existing = await User.findOne({
        where: { email: new_email, id: { [Op.ne]: userId } },
        attributes: ["id"],
      });
      if (existing) {
        return res.status(409).json({ error: "Email already in use" });
      }

      await User.update({ email: new_email }, { where: { id: userId } });
      res.json({ message: "Username updated successfully" });
    } catch (error) {
      console.error("Update username error:", error);
      res.status(500).json({ error: "Failed to update username" });
    }
  },
);

// Change user password
router.put(
  "/users/:userId/password",
  authenticateToken,
  authorize("admin"),
  [body("new_password").isLength({ min: 8 })],
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { new_password } = req.body;

      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(new_password, salt);

      await User.update({ password_hash }, { where: { id: userId } });
      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Change password error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  },
);

// Suspend/Activate user
router.put(
  "/users/:userId/toggle-status",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findByPk(userId);
      await user.update({ is_active: !user.is_active });
      res.json({
        message: user.is_active ? "User activated" : "User suspended",
        is_active: user.is_active,
      });
    } catch (error) {
      console.error("Toggle status error:", error);
      res.status(500).json({ error: "Failed to toggle status" });
    }
  },
);

// Delete user
router.delete(
  "/users/:userId",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const { userId } = req.params;
      await User.destroy({ where: { id: userId } });
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Delete user error:", error);
      res.status(500).json({ error: "Failed to delete user" });
    }
  },
);

// Migrate candidate to learner
router.post(
  "/candidates/:candidateId/migrate",
  authenticateToken,
  authorize("admin"),
  [
    body("new_role").isIn(["learner"]),
    body("supervisor_id").optional().isInt(),
    body("archetype").optional().isString(),
  ],
  async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { candidateId } = req.params;
      const { new_role, supervisor_id, archetype } = req.body;

      // Verify candidate exists and has passing test
      const [candidates] = await sequelize.query(
        `SELECT u.*, ta.score, t.passing_score
         FROM users u
         LEFT JOIN test_attempts ta ON u.id = ta.user_id AND ta.status = 'graded'
         LEFT JOIN tests t ON ta.test_id = t.id
         WHERE u.id = :candidateId AND u.role = 'candidate'
         ORDER BY ta.score DESC NULLS LAST
         LIMIT 1`,
        { replacements: { candidateId }, transaction: t },
      );

      if (candidates.length === 0) {
        await t.rollback();
        return res.status(404).json({ error: "Candidate not found" });
      }

      const candidate = candidates[0];
      const score = candidate.score;
      const passingScore = candidate.passing_score || 70;

      if (!score || score < passingScore) {
        await t.rollback();
        return res.status(400).json({
          error: "Candidate has not passed the assessment",
          score,
          required: passingScore,
        });
      }

      // Update user role
      await User.update(
        {
          role: new_role,
          supervisor_id: supervisor_id || null,
          archetype: archetype || candidate.archetype,
        },
        { where: { id: candidateId }, transaction: t },
      );

      // Log the migration
      await Notification.create(
        {
          user_id: candidateId,
          title: "Account Activated!",
          message: `Congratulations! Your account has been upgraded to ${new_role}. You now have full access to the platform.`,
          notification_type: "account_migration",
        },
        { transaction: t },
      );

      await t.commit();

      // Send acceptance notification
      await notifyCandidateStatus(candidate, "accepted");

      res.json({
        message: "Candidate migrated successfully",
        user: { id: candidateId, new_role, supervisor_id, archetype },
      });
    } catch (error) {
      await t.rollback();
      console.error("Migration error:", error);
      res.status(500).json({ error: "Failed to migrate candidate" });
    }
  },
);

// Get candidates eligible for migration
router.get(
  "/candidates/eligible",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const [candidates] = await sequelize.query(
        `SELECT u.id, u.email, u.full_name, u.created_at,
              ta.score, ta.graded_at, t.passing_score, t.title as test_title
       FROM users u
       JOIN test_attempts ta ON u.id = ta.user_id AND ta.status = 'graded'
       JOIN tests t ON ta.test_id = t.id
       WHERE u.role = 'candidate' 
         AND ta.score >= t.passing_score
       ORDER BY ta.graded_at DESC`,
      );

      res.json({ candidates });
    } catch (error) {
      console.error("Fetch eligible candidates error:", error);
      res.status(500).json({ error: "Failed to fetch eligible candidates" });
    }
  },
);

// Get supervisor list for assignment
router.get(
  "/supervisors",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const supervisors = await User.findAll({
        where: { role: "supervisor", is_active: true },
        attributes: ["id", "full_name", "email"],
        order: [["full_name", "ASC"]],
      });

      res.json({ supervisors });
    } catch (error) {
      console.error("Fetch supervisors error:", error);
      res.status(500).json({ error: "Failed to fetch supervisors" });
    }
  },
);

// Upload course material
router.post(
  "/courses/:courseId/upload",
  authenticateToken,
  authorize("admin"),
  upload.single("file"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { title, content_type } = req.body;
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const content_url = `/uploads/${file.filename}`;

      const maxOrder = await CourseContent.max("order_index", {
        where: { course_id: courseId },
      });
      const nextOrder = (maxOrder ?? -1) + 1;

      const content = await CourseContent.create({
        course_id: courseId,
        title,
        content_type,
        content_url,
        order_index: nextOrder,
      });

      res
        .status(201)
        .json({ message: "Material uploaded successfully", content });
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({ error: "Failed to upload material" });
    }
  },
);

// Add course content (link-based)
router.post(
  "/courses/:courseId/content",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const { courseId } = req.params;
      const { title, content_type, content_url } = req.body;

      const maxOrder = await CourseContent.max("order_index", {
        where: { course_id: courseId },
      });
      const nextOrder = (maxOrder ?? -1) + 1;

      const content = await CourseContent.create({
        course_id: courseId,
        title,
        content_type,
        content_url,
        order_index: nextOrder,
      });

      res.status(201).json({ message: "Content added successfully", content });
    } catch (error) {
      console.error("Add content error:", error);
      res.status(500).json({ error: "Failed to add content" });
    }
  },
);

// Update course content
router.put(
  "/content/:contentId",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const { contentId } = req.params;
      const { title, content_url } = req.body;

      const content = await CourseContent.findByPk(contentId);
      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }

      await content.update({
        title: title || content.title,
        content_url: content_url || content.content_url,
      });

      res.json({ message: "Content updated successfully", content });
    } catch (error) {
      console.error("Update content error:", error);
      res.status(500).json({ error: "Failed to update content" });
    }
  },
);

// Delete course content
router.delete(
  "/content/:contentId",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const { contentId } = req.params;
      await CourseContent.destroy({ where: { id: contentId } });
      res.json({ message: "Content deleted successfully" });
    } catch (error) {
      console.error("Delete content error:", error);
      res.status(500).json({ error: "Failed to delete content" });
    }
  },
);

module.exports = router;
