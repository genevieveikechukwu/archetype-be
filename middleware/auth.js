const jwt = require("jsonwebtoken");
const { User } = require("../models");

// Verify JWT Token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database to ensure they still exist and are active
    const user = await User.findByPk(decoded.userId, {
      attributes: [
        "id",
        "email",
        "full_name",
        "role",
        "archetype",
        "supervisor_id",
        "is_active",
      ],
    });

    if (!user || !user.is_active) {
      return res.status(403).json({ error: "User not found or inactive" });
    }

    req.user = user.get({ plain: true });
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(403).json({ error: "Invalid token" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(403).json({ error: "Token expired" });
    }
    return res.status(500).json({ error: "Authentication failed" });
  }
};

// Role-based authorization
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    next();
  };
};

// Check if user is supervisor of target user
const isSupervisorOf = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.body.userId;

    if (req.user.role === "admin") {
      return next(); // Admins can access everything
    }

    if (req.user.id === parseInt(targetUserId)) {
      return next(); // Users can access their own data
    }

    if (req.user.role === "supervisor") {
      const targetUser = await User.findOne({
        where: { id: targetUserId, supervisor_id: req.user.id },
        attributes: ["id"],
      });

      if (targetUser) {
        return next();
      }
    }

    return res
      .status(403)
      .json({ error: "Not authorized to access this resource" });
  } catch (error) {
    console.error("Authorization error:", error);
    return res.status(500).json({ error: "Authorization check failed" });
  }
};

module.exports = {
  authenticateToken,
  authorize,
  isSupervisorOf,
};
