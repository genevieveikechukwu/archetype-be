const express = require("express");
const { body, validationResult } = require("express-validator");
const {
  Assignment,
  Enrollment,
  User,
  Course,
  Notification,
} = require("../models");
const { authenticateToken, authorize } = require("../middleware/auth");
const multer = require("multer");
const path = require("path");

const router = express.Router();

// Configure multer for assignment file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/assignments/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "assignment-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10485760 }, // 10MB
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|txt|zip|rar/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Allowed: images, PDFs, docs, text, archives",
        ),
      );
    }
  },
});

// ========== LEARNER ASSIGNMENT SUBMISSIONS ==========

// Submit new assignment
router.post(
  "/submit",
  authenticateToken,
  authorize("learner", "candidate"),
  upload.single("file"),
  [
    body("course_id").isInt(),
    body("title").trim().notEmpty(),
    body("description").optional().trim(),
    body("submission_type").isIn(["link", "file", "text"]),
    body("submission_url").optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { course_id, title, description, submission_type, submission_url } =
        req.body;
      const file = req.file;

      // Verify user is enrolled in the course
      const enrollment = await Enrollment.findOne({
        where: { user_id: req.user.id, course_id },
        attributes: ["id"],
      });

      if (!enrollment) {
        return res
          .status(403)
          .json({ error: "You are not enrolled in this course" });
      }

      let finalSubmissionUrl = submission_url;

      // If file upload, set the URL to the uploaded file path
      if (submission_type === "file" && file) {
        finalSubmissionUrl = `/uploads/assignments/${file.filename}`;
      }

      // Insert assignment submission
      const assignment = await Assignment.create({
        user_id: req.user.id,
        course_id,
        title,
        description: description || null,
        submission_type,
        submission_url: finalSubmissionUrl,
        status: "pending",
      });

      // Get supervisor to notify
      const student = await User.findByPk(req.user.id, {
        attributes: ["supervisor_id"],
      });

      if (student?.supervisor_id) {
        await Notification.create({
          user_id: student.supervisor_id,
          title: "New Assignment Submitted",
          message: `${req.user.full_name} submitted "${title}"`,
          notification_type: "assignment",
        });
      }

      res.status(201).json({
        message: "Assignment submitted successfully",
        assignment,
      });
    } catch (error) {
      console.error("Assignment submission error:", error);
      res.status(500).json({ error: "Failed to submit assignment" });
    }
  },
);

// Get my assignments (learner view)
router.get(
  "/my-assignments",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const assignments = await Assignment.findAll({
        where: { user_id: req.user.id },
        include: [
          { model: Course, attributes: ["title"] },
          { model: User, as: "Reviewer", attributes: ["full_name"] },
        ],
        order: [["submitted_at", "DESC"]],
      });

      const result = assignments.map((a) => {
        const plain = a.get({ plain: true });
        plain.course_title = plain.Course ? plain.Course.title : null;
        plain.reviewer_name = plain.Reviewer ? plain.Reviewer.full_name : null;
        delete plain.Course;
        delete plain.Reviewer;
        return plain;
      });

      res.json({ assignments: result });
    } catch (error) {
      console.error("Fetch assignments error:", error);
      res.status(500).json({ error: "Failed to fetch assignments" });
    }
  },
);

// Get single assignment details
router.get("/:assignmentId", authenticateToken, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await Assignment.findByPk(assignmentId, {
      include: [
        { model: Course, attributes: ["title"] },
        {
          model: User,
          as: "Student",
          attributes: ["full_name", "email", "supervisor_id"],
        },
        { model: User, as: "Reviewer", attributes: ["full_name"] },
      ],
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    const plain = assignment.get({ plain: true });

    // Check permissions: owner, supervisor, or admin
    const isSupervisor =
      plain.Student && plain.Student.supervisor_id === req.user.id;

    if (
      plain.user_id !== req.user.id &&
      !isSupervisor &&
      req.user.role !== "admin"
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    plain.course_title = plain.Course ? plain.Course.title : null;
    plain.student_name = plain.Student ? plain.Student.full_name : null;
    plain.student_email = plain.Student ? plain.Student.email : null;
    plain.reviewer_name = plain.Reviewer ? plain.Reviewer.full_name : null;
    delete plain.Course;
    delete plain.Student;
    delete plain.Reviewer;

    res.json(plain);
  } catch (error) {
    console.error("Fetch assignment error:", error);
    res.status(500).json({ error: "Failed to fetch assignment" });
  }
});

// ========== SUPERVISOR ASSIGNMENT REVIEW ==========

// Get assignments to review (supervisor view)
router.get(
  "/to-review/all",
  authenticateToken,
  authorize("supervisor", "admin"),
  async (req, res) => {
    try {
      const { status } = req.query;

      const where = {};
      if (status) where.status = status;

      const includeUser = {
        model: User,
        as: "Student",
        attributes: ["full_name", "email", "supervisor_id"],
      };

      // Supervisors only see their learners' assignments
      if (req.user.role === "supervisor") {
        includeUser.where = { supervisor_id: req.user.id };
      }

      const assignments = await Assignment.findAll({
        where,
        include: [{ model: Course, attributes: ["title"] }, includeUser],
        order: [["submitted_at", "DESC"]],
      });

      const result = assignments.map((a) => {
        const plain = a.get({ plain: true });
        plain.course_title = plain.Course ? plain.Course.title : null;
        plain.student_name = plain.Student ? plain.Student.full_name : null;
        plain.student_email = plain.Student ? plain.Student.email : null;
        delete plain.Course;
        delete plain.Student;
        return plain;
      });

      res.json({ assignments: result });
    } catch (error) {
      console.error("Fetch assignments error:", error);
      res.status(500).json({ error: "Failed to fetch assignments" });
    }
  },
);

// Review/Grade assignment
router.put(
  "/:assignmentId/review",
  authenticateToken,
  authorize("supervisor", "admin"),
  [
    body("feedback").optional().trim(),
    body("grade").optional().isFloat({ min: 0, max: 100 }),
    body("status").optional().isIn(["pending", "reviewed", "needs_revision"]),
  ],
  async (req, res) => {
    try {
      const { assignmentId } = req.params;
      const { feedback, grade, status } = req.body;

      // Verify this is the learner's supervisor or admin
      const assignment = await Assignment.findByPk(assignmentId, {
        include: [
          { model: User, as: "Student", attributes: ["id", "supervisor_id"] },
        ],
      });

      if (!assignment) {
        return res.status(404).json({ error: "Assignment not found" });
      }

      const isSupervisor =
        assignment.Student && assignment.Student.supervisor_id === req.user.id;
      const isAdmin = req.user.role === "admin";

      if (!isSupervisor && !isAdmin) {
        return res
          .status(403)
          .json({ error: "Not authorized to review this assignment" });
      }

      await assignment.update({
        feedback: feedback ?? assignment.feedback,
        grade: grade ?? assignment.grade,
        status: status || "reviewed",
        reviewed_by: req.user.id,
        reviewed_at: new Date(),
      });

      // Notify the learner
      await Notification.create({
        user_id: assignment.user_id,
        title: "Assignment Reviewed",
        message: `Your assignment has been reviewed by ${req.user.full_name}`,
        notification_type: "assignment",
      });

      res.json({
        message: "Assignment reviewed successfully",
        assignment,
      });
    } catch (error) {
      console.error("Review assignment error:", error);
      res.status(500).json({ error: "Failed to review assignment" });
    }
  },
);

// Delete assignment (learner can delete their own pending submissions)
router.delete("/:assignmentId", authenticateToken, async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await Assignment.findByPk(assignmentId, {
      attributes: ["id", "user_id", "status"],
    });

    if (!assignment) {
      return res.status(404).json({ error: "Assignment not found" });
    }

    // Only owner can delete, and only if pending
    if (assignment.user_id !== req.user.id) {
      return res.status(403).json({ error: "Not authorized" });
    }

    if (assignment.status !== "pending") {
      return res
        .status(400)
        .json({ error: "Can only delete pending assignments" });
    }

    await assignment.destroy();

    res.json({ message: "Assignment deleted successfully" });
  } catch (error) {
    console.error("Delete assignment error:", error);
    res.status(500).json({ error: "Failed to delete assignment" });
  }
});

module.exports = router;
