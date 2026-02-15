const express = require("express");
const { body, validationResult } = require("express-validator");
const {
  Course,
  CourseContent,
  Enrollment,
  Test,
  User,
  sequelize,
} = require("../models");
const { Op } = require("sequelize");
const { authenticateToken, authorize } = require("../middleware/auth");

const router = express.Router();

// Create course (Admin only)
router.post(
  "/",
  authenticateToken,
  authorize("admin"),
  [
    body("title").trim().notEmpty(),
    body("description").optional().trim(),
    body("difficulty").isIn(["beginner", "intermediate", "advanced"]),
    body("archetype")
      .optional()
      .isIn(["maker", "architect", "strategist", "connector", "explorer"]),
    body("estimated_hours").optional().isInt({ min: 1 }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        title,
        description,
        difficulty,
        archetype,
        estimated_hours,
        version,
        content,
      } = req.body;

      // Insert course
      const course = await Course.create({
        title,
        description: description || null,
        difficulty,
        archetype: archetype || null,
        estimated_hours: estimated_hours || null,
        version: version || "1.0",
        created_by: req.user.id,
      });

      // Insert course content if provided
      if (content && Array.isArray(content)) {
        for (let i = 0; i < content.length; i++) {
          const item = content[i];
          await CourseContent.create({
            course_id: course.id,
            title: item.title,
            content_type: item.content_type,
            content_url: item.content_url,
            order_index: i,
          });
        }
      }

      res.status(201).json({
        message: "Course created successfully",
        course,
      });
    } catch (error) {
      console.error("Course creation error:", error);
      res.status(500).json({ error: "Failed to create course" });
    }
  },
);

// Get all courses (filtered by difficulty/archetype)
router.get("/:", authenticateToken, async (req, res) => {
  try {
    const { difficulty, archetype, is_published } = req.query;

    const where = {};
    if (req.user.role !== "admin") {
      where.is_published = true;
    } else if (is_published !== undefined) {
      where.is_published = is_published === "true";
    }
    if (difficulty) where.difficulty = difficulty;
    if (archetype) where.archetype = archetype;

    const courses = await Course.findAll({
      where,
      attributes: {
        include: [
          [
            sequelize.literal(
              '(SELECT COUNT(DISTINCT e.id) FROM enrollments e WHERE e.course_id = "Course".id)',
            ),
            "enrolled_count",
          ],
          [
            sequelize.literal(
              '(SELECT COUNT(DISTINCT cc.id) FROM course_content cc WHERE cc.course_id = "Course".id)',
            ),
            "content_count",
          ],
        ],
      },
      include: [{ model: User, as: "Creator", attributes: ["full_name"] }],
      order: [["created_at", "DESC"]],
    });

    const result = courses.map((c) => {
      const plain = c.get({ plain: true });
      plain.created_by_name = plain.Creator ? plain.Creator.full_name : null;
      delete plain.Creator;
      return plain;
    });

    res.json({ courses: result });
  } catch (error) {
    console.error("Courses fetch error:", error);
    res.status(500).json({ error: "Failed to fetch courses" });
  }
});

// Get single course details
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const courseId = req.params.id;

    const course = await Course.findByPk(courseId, {
      attributes: {
        include: [
          [
            sequelize.literal(
              '(SELECT COUNT(DISTINCT e.id) FROM enrollments e WHERE e.course_id = "Course".id)',
            ),
            "enrolled_count",
          ],
        ],
      },
      include: [{ model: User, as: "Creator", attributes: ["full_name"] }],
    });

    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    const plainCourse = course.get({ plain: true });
    plainCourse.created_by_name = plainCourse.Creator
      ? plainCourse.Creator.full_name
      : null;
    delete plainCourse.Creator;

    // Check if non-admin trying to access unpublished course
    if (!plainCourse.is_published && req.user.role !== "admin") {
      return res.status(403).json({ error: "Course not available" });
    }

    // Get course content
    const content = await CourseContent.findAll({
      where: { course_id: courseId },
      order: [["order_index", "ASC"]],
    });

    // Get user's enrollment status
    const enrollment = await Enrollment.findOne({
      where: { user_id: req.user.id, course_id: courseId },
    });

    // Get associated tests
    const tests = await Test.findAll({
      where: { course_id: courseId },
      attributes: [
        "id",
        "title",
        "test_type",
        "passing_score",
        "time_limit_minutes",
      ],
    });

    res.json({
      course: plainCourse,
      content,
      enrollment: enrollment || null,
      tests,
    });
  } catch (error) {
    console.error("Course detail error:", error);
    res.status(500).json({ error: "Failed to fetch course details" });
  }
});

// Update course
router.put("/:id", authenticateToken, authorize("admin"), async (req, res) => {
  try {
    const courseId = req.params.id;
    const {
      title,
      description,
      difficulty,
      archetype,
      estimated_hours,
      is_published,
      version,
    } = req.body;

    const course = await Course.findByPk(courseId);
    if (!course) {
      return res.status(404).json({ error: "Course not found" });
    }

    await course.update({
      title: title ?? course.title,
      description: description ?? course.description,
      difficulty: difficulty ?? course.difficulty,
      archetype: archetype ?? course.archetype,
      estimated_hours: estimated_hours ?? course.estimated_hours,
      is_published: is_published ?? course.is_published,
      version: version ?? course.version,
    });

    res.json({
      message: "Course updated successfully",
      course,
    });
  } catch (error) {
    console.error("Course update error:", error);
    res.status(500).json({ error: "Failed to update course" });
  }
});

// Delete course
router.delete(
  "/:id",
  authenticateToken,
  authorize("admin"),
  async (req, res) => {
    try {
      const courseId = req.params.id;

      const deleted = await Course.destroy({ where: { id: courseId } });
      if (!deleted) {
        return res.status(404).json({ error: "Course not found" });
      }

      res.json({ message: "Course deleted successfully" });
    } catch (error) {
      console.error("Course deletion error:", error);
      res.status(500).json({ error: "Failed to delete course" });
    }
  },
);

// Enroll in course
router.post(
  "/:id/enroll",
  authenticateToken,
  authorize("learner"),
  async (req, res) => {
    try {
      const courseId = req.params.id;

      // Check if course exists and is published
      const course = await Course.findByPk(courseId, {
        attributes: ["id", "is_published"],
      });
      if (!course) {
        return res.status(404).json({ error: "Course not found" });
      }

      if (!course.is_published) {
        return res
          .status(403)
          .json({ error: "Course is not available for enrollment" });
      }

      // Check if already enrolled
      const existingEnrollment = await Enrollment.findOne({
        where: { user_id: req.user.id, course_id: courseId },
      });

      if (existingEnrollment) {
        return res
          .status(400)
          .json({ error: "Already enrolled in this course" });
      }

      // Enroll user
      const enrollment = await Enrollment.create({
        user_id: req.user.id,
        course_id: courseId,
      });

      res.status(201).json({
        message: "Enrolled successfully",
        enrollment,
      });
    } catch (error) {
      console.error("Enrollment error:", error);
      res.status(500).json({ error: "Failed to enroll in course" });
    }
  },
);

// Update course progress
router.put(
  "/:id/progress",
  authenticateToken,
  authorize("learner"),
  [body("progress_percentage").isInt({ min: 0, max: 100 })],
  async (req, res) => {
    try {
      const courseId = req.params.id;
      const { progress_percentage } = req.body;

      const enrollment = await Enrollment.findOne({
        where: { user_id: req.user.id, course_id: courseId },
      });

      if (!enrollment) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      await enrollment.update({
        progress_percentage,
        completed_at: progress_percentage === 100 ? new Date() : null,
      });

      res.json({
        message: "Progress updated successfully",
        enrollment,
      });
    } catch (error) {
      console.error("Progress update error:", error);
      res.status(500).json({ error: "Failed to update progress" });
    }
  },
);

// Get user's enrolled courses
router.get(
  "/my/enrollments",
  authenticateToken,
  authorize("learner", "candidate"),
  async (req, res) => {
    try {
      const enrollments = await Enrollment.findAll({
        where: { user_id: req.user.id },
        include: [
          {
            model: Course,
            attributes: [
              "title",
              "description",
              "difficulty",
              "archetype",
              "estimated_hours",
            ],
            include: [
              {
                model: CourseContent,
                as: "Contents",
                attributes: ["id"],
              },
            ],
          },
        ],
        order: [["enrolled_at", "DESC"]],
      });

      const result = enrollments.map((e) => {
        const plain = e.get({ plain: true });
        plain.title = plain.Course.title;
        plain.description = plain.Course.description;
        plain.difficulty = plain.Course.difficulty;
        plain.archetype = plain.Course.archetype;
        plain.estimated_hours = plain.Course.estimated_hours;
        plain.content_count = plain.Course.Contents
          ? plain.Course.Contents.length
          : 0;
        plain.is_completed = plain.completed_at !== null;
        delete plain.Course;
        return plain;
      });

      res.json({ enrollments: result });
    } catch (error) {
      console.error("Enrollments fetch error:", error);
      res.status(500).json({ error: "Failed to fetch enrollments" });
    }
  },
);

module.exports = router;
