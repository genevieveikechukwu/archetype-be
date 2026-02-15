const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { body, validationResult } = require("express-validator");
const { User, Enrollment, sequelize } = require("../models");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Register new user
router.post(
  "/register",
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

      // Check if user already exists
      const existingUser = await User.findOne({
        where: { email },
        attributes: ["id"],
      });
      if (existingUser) {
        return res.status(409).json({ error: "Email already registered" });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const password_hash = await bcrypt.hash(password, salt);

      // Insert user
      const user = await User.create({
        email,
        password_hash,
        full_name,
        role,
        archetype: archetype || null,
        supervisor_id: supervisor_id || null,
      });

      res.status(201).json({
        message: "User registered successfully",
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
      console.error("Registration error:", error);
      res.status(500).json({ error: "Registration failed" });
    }
  },
);

// Login
router.post(
  "/login",
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      // Get user
      const user = await User.findOne({
        where: { email },
        attributes: [
          "id",
          "email",
          "password_hash",
          "full_name",
          "role",
          "archetype",
          "is_active",
        ],
      });

      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (!user.is_active) {
        return res.status(403).json({ error: "Account is inactive" });
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password_hash);
      if (!validPassword) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user.id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN },
      );

      res.json({
        message: "Login successful",
        token,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
          archetype: user.archetype,
        },
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: "Login failed" });
    }
  },
);

// Get current user profile
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: [
        "id",
        "email",
        "full_name",
        "role",
        "archetype",
        "created_at",
      ],
      include: [
        {
          model: User,
          as: "Supervisor",
          attributes: ["full_name"],
        },
      ],
    });

    const enrollments = await Enrollment.findAll({
      where: { user_id: req.user.id },
      attributes: ["id", "completed_at"],
    });

    const enrolled_courses = enrollments.length;
    const completed_courses = enrollments.filter(
      (e) => e.completed_at !== null,
    ).length;

    const result = user.get({ plain: true });
    result.supervisor_name = result.Supervisor
      ? result.Supervisor.full_name
      : null;
    delete result.Supervisor;
    result.enrolled_courses = enrolled_courses;
    result.completed_courses = completed_courses;

    res.json(result);
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Change password
router.post(
  "/change-password",
  authenticateToken,
  [
    body("current_password").notEmpty(),
    body("new_password").isLength({ min: 8 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { current_password, new_password } = req.body;

      // Get current password hash
      const user = await User.findByPk(req.user.id, {
        attributes: ["id", "password_hash"],
      });

      // Verify current password
      const validPassword = await bcrypt.compare(
        current_password,
        user.password_hash,
      );
      if (!validPassword) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      const new_hash = await bcrypt.hash(new_password, salt);

      // Update password
      await user.update({ password_hash: new_hash });

      res.json({ message: "Password changed successfully" });
    } catch (error) {
      console.error("Password change error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  },
);

module.exports = router;
