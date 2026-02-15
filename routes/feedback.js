const express = require("express");
const { MentorshipMessage, Notification, User } = require("../models");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

// Send feedback
router.post("/send", authenticateToken, async (req, res) => {
  try {
    const { receiver_id, subject, message } = req.body;

    const msg = await MentorshipMessage.create({
      sender_id: req.user.id,
      receiver_id,
      message_text: `Subject: ${subject}\n\n${message}`,
      course_id: null,
    });

    await Notification.create({
      user_id: receiver_id,
      title: `New Feedback from ${req.user.full_name}`,
      message: subject,
      notification_type: "feedback",
    });

    res.status(201).json({ message: "Feedback sent successfully", data: msg });
  } catch (error) {
    console.error("Send feedback error:", error);
    res.status(500).json({ error: "Failed to send feedback" });
  }
});

// Get all feedback/messages
router.get("/all", authenticateToken, async (req, res) => {
  try {
    const { Op } = require("sequelize");

    const messages = await MentorshipMessage.findAll({
      where: {
        [Op.or]: [{ sender_id: req.user.id }, { receiver_id: req.user.id }],
      },
      include: [
        { model: User, as: "Sender", attributes: ["full_name", "role"] },
        { model: User, as: "Receiver", attributes: ["full_name", "role"] },
      ],
      order: [["created_at", "DESC"]],
      limit: 100,
    });

    const result = messages.map((m) => {
      const plain = m.get({ plain: true });
      plain.sender_name = plain.Sender ? plain.Sender.full_name : null;
      plain.sender_role = plain.Sender ? plain.Sender.role : null;
      plain.receiver_name = plain.Receiver ? plain.Receiver.full_name : null;
      plain.receiver_role = plain.Receiver ? plain.Receiver.role : null;
      delete plain.Sender;
      delete plain.Receiver;
      return plain;
    });

    res.json({ messages: result });
  } catch (error) {
    console.error("Fetch feedback error:", error);
    res.status(500).json({ error: "Failed to fetch feedback" });
  }
});

// Get notifications
router.get("/notifications", authenticateToken, async (req, res) => {
  try {
    const notifications = await Notification.findAll({
      where: { user_id: req.user.id },
      order: [["created_at", "DESC"]],
      limit: 50,
    });

    res.json({ notifications });
  } catch (error) {
    console.error("Fetch notifications error:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// Mark notification as read
router.put(
  "/notifications/:notificationId/read",
  authenticateToken,
  async (req, res) => {
    try {
      await Notification.update(
        { is_read: true },
        { where: { id: req.params.notificationId } },
      );
      res.json({ message: "Notification marked as read" });
    } catch (error) {
      console.error("Mark read error:", error);
      res.status(500).json({ error: "Failed to mark notification" });
    }
  },
);

module.exports = router;
