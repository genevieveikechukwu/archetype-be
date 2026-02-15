const express = require("express");
const { body, validationResult } = require("express-validator");
const {
  sequelize,
  MentorshipMessage,
  Notification,
  User,
  Kudos,
  Journal,
} = require("../models");
const { authenticateToken, authorize } = require("../middleware/auth");
const { Op, QueryTypes } = require("sequelize");

const router = express.Router();

// Send mentorship message
router.post(
  "/messages",
  authenticateToken,
  [
    body("receiver_id").isInt(),
    body("message_text").trim().notEmpty(),
    body("course_id").optional().isInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { receiver_id, message_text, course_id } = req.body;

      const receiver = await User.findByPk(receiver_id, {
        attributes: ["id", "full_name"],
      });
      if (!receiver) {
        return res.status(404).json({ error: "Receiver not found" });
      }

      const msg = await MentorshipMessage.create({
        sender_id: req.user.id,
        receiver_id,
        message_text,
        course_id: course_id || null,
      });

      await Notification.create({
        user_id: receiver_id,
        title: "New Message",
        message: `You have a new message from ${req.user.full_name}`,
        notification_type: "new_message",
      });

      res.status(201).json({
        message: "Message sent successfully",
        data: msg,
      });
    } catch (error) {
      console.error("Message send error:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  },
);

// Get messages (conversation)
router.get("/messages", authenticateToken, async (req, res) => {
  try {
    const { other_user_id, course_id } = req.query;

    const where = {
      [Op.or]: [{ sender_id: req.user.id }, { receiver_id: req.user.id }],
    };

    if (other_user_id) {
      where[Op.and] = [
        where[Op.or],
        {
          [Op.or]: [
            { sender_id: other_user_id },
            { receiver_id: other_user_id },
          ],
        },
      ];
      delete where[Op.or];
    }

    if (course_id) {
      where.course_id = course_id;
    }

    const messages = await MentorshipMessage.findAll({
      where,
      include: [
        { model: User, as: "Sender", attributes: ["full_name"] },
        { model: User, as: "Receiver", attributes: ["full_name"] },
      ],
      order: [["created_at", "DESC"]],
      limit: 100,
    });

    // Mark messages as read
    if (other_user_id) {
      await MentorshipMessage.update(
        { is_read: true },
        { where: { receiver_id: req.user.id, sender_id: other_user_id } },
      );
    }

    const result = messages.map((m) => {
      const plain = m.get({ plain: true });
      plain.sender_name = plain.Sender ? plain.Sender.full_name : null;
      plain.receiver_name = plain.Receiver ? plain.Receiver.full_name : null;
      delete plain.Sender;
      delete plain.Receiver;
      return plain;
    });

    res.json({ messages: result });
  } catch (error) {
    console.error("Messages fetch error:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Get unread message count
router.get("/messages/unread/count", authenticateToken, async (req, res) => {
  try {
    const count = await MentorshipMessage.count({
      where: { receiver_id: req.user.id, is_read: false },
    });

    res.json({ unread_count: count });
  } catch (error) {
    console.error("Unread count error:", error);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// Send kudos
router.post(
  "/kudos",
  authenticateToken,
  [
    body("to_user_id").isInt(),
    body("points").isInt({ min: 1, max: 5 }),
    body("message").trim().notEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { to_user_id, points, message } = req.body;

      if (to_user_id === req.user.id) {
        return res.status(400).json({ error: "Cannot send kudos to yourself" });
      }

      const kudos = await Kudos.create({
        from_user_id: req.user.id,
        to_user_id,
        points,
        message,
      });

      await Notification.create({
        user_id: to_user_id,
        title: "Kudos Received!",
        message: `${req.user.full_name} sent you ${points} kudos points!`,
        notification_type: "kudos",
      });

      res.status(201).json({
        message: "Kudos sent successfully",
        kudos,
      });
    } catch (error) {
      console.error("Kudos send error:", error);
      res.status(500).json({ error: "Failed to send kudos" });
    }
  },
);

// Get kudos received
router.get("/kudos/received", authenticateToken, async (req, res) => {
  try {
    const kudos = await Kudos.findAll({
      where: { to_user_id: req.user.id },
      include: [{ model: User, as: "FromUser", attributes: ["full_name"] }],
      order: [["created_at", "DESC"]],
      limit: 50,
    });

    const result = kudos.map((k) => {
      const plain = k.get({ plain: true });
      plain.from_user_name = plain.FromUser ? plain.FromUser.full_name : null;
      delete plain.FromUser;
      return plain;
    });

    const totalPoints = await Kudos.sum("points", {
      where: { to_user_id: req.user.id },
    });

    res.json({
      kudos: result,
      total_points: totalPoints || 0,
    });
  } catch (error) {
    console.error("Kudos fetch error:", error);
    res.status(500).json({ error: "Failed to fetch kudos" });
  }
});

// Get kudos given
router.get("/kudos/given", authenticateToken, async (req, res) => {
  try {
    const kudos = await Kudos.findAll({
      where: { from_user_id: req.user.id },
      include: [{ model: User, as: "ToUser", attributes: ["full_name"] }],
      order: [["created_at", "DESC"]],
      limit: 50,
    });

    const result = kudos.map((k) => {
      const plain = k.get({ plain: true });
      plain.to_user_name = plain.ToUser ? plain.ToUser.full_name : null;
      delete plain.ToUser;
      return plain;
    });

    res.json({ kudos: result });
  } catch (error) {
    console.error("Kudos fetch error:", error);
    res.status(500).json({ error: "Failed to fetch kudos" });
  }
});

// Create/Update journal entry
router.post(
  "/journal",
  authenticateToken,
  authorize("learner"),
  [
    body("entry_text").trim().notEmpty(),
    body("entry_date").optional().isDate(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { entry_text, entry_date } = req.body;
      const date = entry_date || new Date().toISOString().split("T")[0];

      const existing = await Journal.findOne({
        where: { user_id: req.user.id, entry_date: date },
      });

      let entry;
      if (existing) {
        await existing.update({ entry_text, updated_at: new Date() });
        entry = existing;
      } else {
        entry = await Journal.create({
          user_id: req.user.id,
          entry_date: date,
          entry_text,
        });
      }

      res.json({
        message: "Journal entry saved successfully",
        entry,
      });
    } catch (error) {
      console.error("Journal save error:", error);
      res.status(500).json({ error: "Failed to save journal entry" });
    }
  },
);

// Get journal entries
router.get(
  "/journal",
  authenticateToken,
  authorize("learner"),
  async (req, res) => {
    try {
      const { start_date, end_date, limit = 30 } = req.query;

      const where = { user_id: req.user.id };

      if (start_date || end_date) {
        where.entry_date = {};
        if (start_date) where.entry_date[Op.gte] = start_date;
        if (end_date) where.entry_date[Op.lte] = end_date;
      }

      const entries = await Journal.findAll({
        where,
        order: [["entry_date", "DESC"]],
        limit: parseInt(limit),
      });

      res.json({ entries });
    } catch (error) {
      console.error("Journal fetch error:", error);
      res.status(500).json({ error: "Failed to fetch journal entries" });
    }
  },
);

// Get conversation partners
router.get("/conversations", authenticateToken, async (req, res) => {
  try {
    // Complex query with CASE WHEN — use raw SQL
    const result = await sequelize.query(
      `SELECT DISTINCT
         CASE 
           WHEN m.sender_id = :userId THEN m.receiver_id
           ELSE m.sender_id
         END as user_id,
         u.full_name,
         u.role,
         MAX(m.created_at) as last_message_time,
         COUNT(CASE WHEN m.receiver_id = :userId AND m.is_read = false THEN 1 END) as unread_count
       FROM mentorship_messages m
       JOIN users u ON (
         CASE 
           WHEN m.sender_id = :userId THEN m.receiver_id
           ELSE m.sender_id
         END = u.id
       )
       WHERE m.sender_id = :userId OR m.receiver_id = :userId
       GROUP BY user_id, u.full_name, u.role
       ORDER BY last_message_time DESC`,
      { replacements: { userId: req.user.id }, type: QueryTypes.SELECT },
    );

    res.json({ conversations: result });
  } catch (error) {
    console.error("Conversations fetch error:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

module.exports = router;
