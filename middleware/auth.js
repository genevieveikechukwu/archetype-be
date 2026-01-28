const jwt = require('jsonwebtoken');
const db = require('../config/database');

// Verify JWT Token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database to ensure they still exist and are active
    const result = await db.query(
      'SELECT id, email, full_name, role, archetype, supervisor_id, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return res.status(403).json({ error: 'User not found or inactive' });
    }

    req.user = result.rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Token expired' });
    }
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Role-based authorization
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

// Check if user is supervisor of target user
const isSupervisorOf = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.body.userId;
    
    if (req.user.role === 'admin') {
      return next(); // Admins can access everything
    }

    if (req.user.id === parseInt(targetUserId)) {
      return next(); // Users can access their own data
    }

    if (req.user.role === 'supervisor') {
      const result = await db.query(
        'SELECT id FROM users WHERE id = $1 AND supervisor_id = $2',
        [targetUserId, req.user.id]
      );

      if (result.rows.length > 0) {
        return next();
      }
    }

    return res.status(403).json({ error: 'Not authorized to access this resource' });
  } catch (error) {
    console.error('Authorization error:', error);
    return res.status(500).json({ error: 'Authorization check failed' });
  }
};

module.exports = {
  authenticateToken,
  authorize,
  isSupervisorOf
};