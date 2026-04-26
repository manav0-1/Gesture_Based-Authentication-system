const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const User = require('../models/User');
const { getCorrelationId } = require('../utils/correlationId');

const JWT_SECRET = process.env.JWT_SECRET;

const protect = async (req, res, next) => {
  const correlationId = getCorrelationId();
  let token;

  // Check headers
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } 
  // Fallback to query param (useful for <img src="..."> streams)
  else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    logger.warn('No token provided', { correlationId, path: req.path });
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Check token type
    if (decoded.type !== 'access') {
      logger.warn('Invalid token type used', { correlationId, type: decoded.type });
      return res.status(401).json({ message: 'Invalid token type' });
    }

    req.user = await User.findById(decoded.userId).select('-password');
    
    if (!req.user) {
      logger.warn('User not found for valid token', { correlationId, userId: decoded.userId });
      return res.status(401).json({ message: 'Not authorized, user not found' });
    }

    if (!req.user.isActive) {
      logger.warn('Inactive user attempted access', { correlationId, userId: req.user._id });
      return res.status(403).json({ message: 'Account is disabled' });
    }
    
    // Attach user info to logger context
    req.userId = req.user._id;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      logger.warn('Expired token used', { correlationId });
      return res.status(401).json({ message: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    logger.warn('JWT verification failed:', error.message, { correlationId });
    return res.status(401).json({ message: 'Not authorized, invalid token' });
  }
};

// Optional auth - doesn't fail if no token, but attaches user if present
const optionalAuth = async (req, res, next) => {
  const correlationId = getCorrelationId();
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.type === 'access') {
        req.user = await User.findById(decoded.userId).select('-password');
      }
    } catch (error) {
      // Silent fail for optional auth
      logger.debug('Optional auth token invalid', { correlationId });
    }
  }

  next();
};

module.exports = { protect, optionalAuth };
