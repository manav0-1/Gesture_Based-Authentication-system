const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const crypto = require('crypto');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { protect } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');
const { getCorrelationId } = require('../utils/correlationId');
const { sendEmergencyOTP } = require('../utils/mailer');
const Otp = require('../models/Otp');
const {
  assessMouseGesture,
  assessHandGesture,
  compressMouseGesture,
  compressHandLandmarks,
} = require('../utils/gestureService');
const {
  FEATURE_VERSION: HAND_FEATURE_VERSION,
  extractHandSamples
} = require('../utils/handFeatureService');
const {
  FEATURE_VERSION: MOUSE_FEATURE_VERSION,
  extractMouseSamples
} = require('../utils/mouseFeatureService');
const {
  retrainHandGestureModel,
  verifyHandGestureWithModel
} = require('../utils/handMlService');
const {
  retrainMouseGestureModel,
  verifyMouseGestureWithModel
} = require('../utils/mouseMlService');

// Environment validation
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || JWT_SECRET;
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const NONCE_TTL_MS = 60 * 1000;

// ==================== VALIDATION SCHEMAS ====================

const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  mouseGestureData: z.any().optional(),
  handGestureLandmarks: z.any().optional()
});

const verifyCredentialsSchema = z.union([
  z.object({ 
    username: z.string().min(1), 
    email: z.undefined().or(z.literal('')).or(z.literal(null)), 
    password: z.string().min(6) 
  }),
  z.object({ 
    username: z.undefined().or(z.literal('')).or(z.literal(null)), 
    email: z.string().email(), 
    password: z.string().min(6) 
  }),
  z.object({ 
    username: z.string().min(1), 
    email: z.string().email(), 
    password: z.string().min(6) 
  })
]);

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

const backupCodeSchema = z.object({
  username: z.string(),
  backupCode: z.string().length(8).regex(/^[A-F0-9]+$/, 'Invalid backup code format')
});

const loginIdentifierSchema = z.object({
  username: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(1),
  mouseGestureData: z.any().optional(),
  handGestureLandmarks: z.any().optional(),
  nonce: z.string().optional()
}).refine(
  (value) => Boolean(value.username || value.email || value.nonce),
  { message: 'Username, email, or session nonce is required' }
);

function getZodIssues(err) {
  return Array.isArray(err?.issues)
    ? err.issues
    : Array.isArray(err?.errors)
      ? err.errors
      : [];
}

function summarizeRegisterBody(body) {
  return {
    hasBody: Boolean(body),
    usernameType: typeof body?.username,
    usernameLength: typeof body?.username === 'string' ? body.username.length : null,
    emailType: typeof body?.email,
    emailLength: typeof body?.email === 'string' ? body.email.length : null,
    passwordType: typeof body?.password,
    passwordLength: typeof body?.password === 'string' ? body.password.length : null,
    mouseGestureType: Array.isArray(body?.mouseGestureData) ? 'array' : typeof body?.mouseGestureData,
    handGestureType: Array.isArray(body?.handGestureLandmarks) ? 'array' : typeof body?.handGestureLandmarks,
    handGestureLength: Array.isArray(body?.handGestureLandmarks) ? body.handGestureLandmarks.length : null
  };
}


function getGestureNonceStore(app) {
  if (!app.locals.gestureNonces) {
    app.locals.gestureNonces = new Map();
  }

  return app.locals.gestureNonces;
}

function pruneExpiredNonces(nonces) {
  const now = Date.now();

  for (const [nonce, value] of nonces.entries()) {
    if (!value || value.expires <= now) {
      nonces.delete(nonce);
    }
  }
}

// ==================== TOKEN FUNCTIONS ====================

function generateAccessToken(userId) {
  return jwt.sign({ userId, type: 'access' }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
}

function generateRefreshToken(userId) {
  return jwt.sign({ userId, type: 'refresh' }, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRY_DAYS}d` });
}

async function createRefreshTokenDocument(userId, token, req) {
  const tokenFamily = RefreshToken.generateTokenFamily();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  
  return await RefreshToken.create({
    user: userId,
    token: crypto.createHash('sha256').update(token).digest('hex'),
    tokenFamily,
    expiresAt,
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip || req.connection.remoteAddress
  });
}

// ==================== SECURITY CONSTANTS ====================

const BANNED_EMAILS = ['manav.sharma17032003@gmail.com'];

function isBanned(email, username) {
  const normEmail = email?.toLowerCase();
  const normUser = username?.toLowerCase();
  return BANNED_EMAILS.includes(normEmail) || BANNED_EMAILS.includes(normUser);
}

// ==================== ROUTES ====================

// Register
router.post('/register', async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    const data = registerSchema.parse(req.body);
    const { username, email, password, mouseGestureData, handGestureLandmarks } = data;

    if (isBanned(email, username)) {
      logger.warn(`Registration attempt from banned user: ${email || username}`, { correlationId });
      return res.status(403).json({ message: "This account cannot be used" });
    }

    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res.status(409).json({ message: 'User already exists' });
    }

    // Basic validation - just check data exists
    const mouseAssessment = assessMouseGesture(mouseGestureData);
    if (!mouseAssessment.valid) {
      return res.status(400).json({ message: mouseAssessment.reason });
    }

    const handAssessment = assessHandGesture(handGestureLandmarks);
    if (!handAssessment.valid) {
      return res.status(400).json({ message: handAssessment.reason });
    }

    const mouseSamples = extractMouseSamples(mouseGestureData);
    if (!mouseSamples.length) {
      return res.status(400).json({ message: 'Mouse gesture samples are missing or incomplete' });
    }

    const handSamples = extractHandSamples(handGestureLandmarks);
    if (!handSamples.length) {
      return res.status(400).json({ message: 'Hand gesture samples are missing or incomplete' });
    }

    // Compress gesture data for storage
    const compressedMouse = compressMouseGesture(mouseSamples[0]);
    const compressedMouseSamples = mouseSamples
      .map((sample) => compressMouseGesture(sample))
      .filter(Boolean);
    const compressedHand = compressHandLandmarks(handGestureLandmarks);
    const compressedHandSamples = handSamples
      .map((sample) => compressHandLandmarks(sample))
      .filter(Boolean);

    // Create user
    const user = await User.create({
      username,
      email,
      password,
      mouseGestureData: compressedMouse,
      mouseGestureSamples: compressedMouseSamples,
      mouseGestureFeatureVersion: MOUSE_FEATURE_VERSION,
      mouseGestureModelEnrolledAt: new Date(),
      handGestureLandmarks: compressedHand,
      handGestureSamples: compressedHandSamples,
      handGestureFeatureVersion: HAND_FEATURE_VERSION,
      handGestureModelEnrolledAt: new Date()
    });

    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 8; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      backupCodes.push(code);
    }
    user.backupCodes = backupCodes.map(code => ({ codeHash: require('bcryptjs').hashSync(code, 10) }));
    await user.save();

    const modelRetrainingResults = await Promise.allSettled([
      retrainHandGestureModel(),
      retrainMouseGestureModel()
    ]);

    if (modelRetrainingResults[0].status === 'rejected') {
      logger.warn(`Hand ML retraining skipped after registration: ${modelRetrainingResults[0].reason?.message || modelRetrainingResults[0].reason}`, {
        correlationId,
        userId: user._id
      });
    }

    if (modelRetrainingResults[1].status === 'rejected') {
      logger.warn(`Mouse ML retraining skipped after registration: ${modelRetrainingResults[1].reason?.message || modelRetrainingResults[1].reason}`, {
        correlationId,
        userId: user._id
      });
    }

    // Create tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    await createRefreshTokenDocument(user._id, refreshToken, req);

    logger.info(`New user registered: ${username}`, { correlationId, userId: user._id });
    
    res.status(201).json({
      message: 'Registration successful',
      accessToken,
      refreshToken,
      backupCodes, // Show once!
      expiresIn: 900 // 15 minutes
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = getZodIssues(err);
      logger.warn(`Registration validation failed: ${JSON.stringify({ issues, body: summarizeRegisterBody(req.body) })}`, { correlationId });
      return res.status(400).json({
        message: issues[0]?.message || 'Validation failed',
        errors: issues
      });
    }
    logger.error(`Registration error: ${err.message}`, { correlationId, stack: err.stack });
    res.status(500).json({ message: 'Server error' });
  }
});

// Verify Credentials (Pre-Gesture Step)
router.post('/verify-credentials', async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    const data = verifyCredentialsSchema.parse(req.body);
    const { username, email, password } = data;

    if (isBanned(email, username)) {
      return res.status(403).json({ message: "This account cannot be used" });
    }

    const normalizedUsername = username?.toLowerCase();
    const normalizedEmail = email?.toLowerCase();

    const user = await User.findOne({
      $or: [
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
        ...(normalizedUsername ? [{ email: normalizedUsername }, { username }] : [])
      ]
    }).select('+password');

    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate nonce for gesture anti-replay
    const nonce = crypto.randomBytes(16).toString('hex');
    
    // Store nonce temporarily (in production, use Redis)
    const nonces = getGestureNonceStore(req.app);
    pruneExpiredNonces(nonces);
    nonces.set(nonce, { userId: user._id, expires: Date.now() + NONCE_TTL_MS });

    logger.info(`Credentials verified for: ${user.username}`, { correlationId, userId: user._id });
    res.json({ message: 'Credentials verified', nonce, requiresGesture: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = getZodIssues(err);
      return res.status(400).json({ message: issues[0]?.message || 'Validation failed', errors: issues });
    }
    logger.error(`Verify credentials error: ${err.message}`, { correlationId });
    res.status(500).json({ message: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    const data = loginIdentifierSchema.parse(req.body);
    const { username, email, password, mouseGestureData, handGestureLandmarks, nonce } = data;

    // Verify nonce (anti-replay)
    const nonces = getGestureNonceStore(req.app);
    pruneExpiredNonces(nonces);
    const nonceData = nonces.get(nonce);
    if (!nonceData || nonceData.expires < Date.now()) {
      return res.status(401).json({ message: 'Invalid or expired session. Please verify credentials again.' });
    }
    nonces.delete(nonce);

    const normalizedUsername = username?.toLowerCase();
    const normalizedEmail = email?.toLowerCase();
    const loginIdentifier = username || email || '';

    if (isBanned(normalizedEmail, normalizedUsername)) {
      return res.status(403).json({ message: "This account cannot be used" });
    }

    const user = await User.findById(nonceData.userId).select('+password +backupCodes');

    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    let gestureResult = null;
    let verification = null;
    const hasHandGesture = Array.isArray(handGestureLandmarks) ? handGestureLandmarks.length > 0 : Boolean(handGestureLandmarks);
    const hasMouseGesture = Array.isArray(mouseGestureData) ? mouseGestureData.length > 0 : Boolean(mouseGestureData);
    const method = hasHandGesture ? 'hand' : 'mouse';

    if (hasHandGesture) {
      logger.info(`Hand gesture data received: type=${typeof handGestureLandmarks}, isArray=${Array.isArray(handGestureLandmarks)}, keys=${handGestureLandmarks ? Object.keys(handGestureLandmarks) : 'null'}`, { correlationId });

      const mlResult = verifyHandGestureWithModel(user._id.toString(), handGestureLandmarks);
      if (!mlResult.available) {
        logger.warn(
          `Hand ML model unavailable for ${loginIdentifier || user.username} (${mlResult.reason}). Authentication denied.`,
          { correlationId, userId: user._id }
        );
        return res.status(503).json({
          message: 'Hand gesture ML model is not ready. Please try again shortly or contact support.',
          reason: mlResult.reason,
          verification: 'hand-ml-unavailable'
        });
      }

      gestureResult = mlResult;
      verification = 'hand-ml';

      if (!gestureResult.match) {
        logger.warn(
          `Hand gesture mismatch: ${loginIdentifier || user.username} (${verification}, similarity: ${gestureResult.similarity.toFixed(4)})`,
          { correlationId }
        );
        return res.status(401).json({
          message: 'Hand gesture does not match',
          similarity: gestureResult.similarity,
          verification
        });
      }
    } else if (hasMouseGesture) {
      logger.info(`Mouse gesture data received: type=${typeof mouseGestureData}, isArray=${Array.isArray(mouseGestureData)}, keys=${mouseGestureData ? Object.keys(mouseGestureData) : 'null'}`, { correlationId });

      const mlResult = verifyMouseGestureWithModel(user._id.toString(), mouseGestureData);
      if (!mlResult.available) {
        logger.warn(
          `Mouse ML model unavailable for ${loginIdentifier || user.username} (${mlResult.reason}). Authentication denied.`,
          { correlationId, userId: user._id }
        );
        return res.status(503).json({
          message: 'Mouse gesture ML model is not ready. Please try again shortly or contact support.',
          reason: mlResult.reason,
          verification: 'mouse-ml-unavailable'
        });
      }

      gestureResult = mlResult;
      verification = 'mouse-ml';

      if (!gestureResult.match) {
        logger.warn(`Mouse gesture mismatch: ${loginIdentifier || user.username} (${verification}, similarity: ${gestureResult.similarity.toFixed(4)})`, { correlationId });
        return res.status(401).json({
          message: 'Mouse gesture does not match',
          similarity: gestureResult.similarity,
          verification
        });
      }
    } else {
      return res.status(400).json({ message: 'No gesture data provided' });
    }

    // Update last auth info
    user.lastAuth = {
      timestamp: new Date(),
      ipAddress: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      method
    };
    await user.save();

    // Generate tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    await createRefreshTokenDocument(user._id, refreshToken, req);

    logger.info(`Login successful: ${loginIdentifier || user.username} (method: ${method})`, { correlationId, userId: user._id });
    res.json({
      message: 'Login successful',
      accessToken,
      refreshToken,
      expiresIn: 900,
      method,
      similarity: gestureResult.similarity,
      verification
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = getZodIssues(err);
      return res.status(400).json({ message: issues[0]?.message || 'Validation failed', errors: issues });
    }
    logger.error(`Login error: ${err.message}`, { correlationId, stack: err.stack });
    res.status(500).json({ message: 'Server error' });
  }
});

// Refresh Token
router.post('/refresh', async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    
    // Verify JWT
    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    if (payload.type !== 'refresh') {
      return res.status(401).json({ message: 'Invalid token type' });
    }

    // Check if token exists in DB and not used
    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const storedToken = await RefreshToken.findOne({ token: tokenHash });

    if (!storedToken) {
      // Potential token reuse! Invalidate all tokens in family
      logger.warn(`Token reuse detected for user: ${payload.userId}`, { correlationId });
      
      // Decode without verification to get family
      const decoded = jwt.decode(refreshToken);
      if (decoded?.userId) {
        // Find any token from this user and get family
        const anyToken = await RefreshToken.findOne({ user: decoded.userId }).sort({ createdAt: -1 });
        if (anyToken) {
          await RefreshToken.updateMany(
            { tokenFamily: anyToken.tokenFamily },
            { used: true }
          );
        }
      }
      return res.status(401).json({ message: 'Token reuse detected. Please login again.' });
    }

    if (storedToken.used) {
      logger.warn(`Used token replay detected: ${storedToken._id}`, { correlationId });
      return res.status(401).json({ message: 'Token already used. Please login again.' });
    }

    if (storedToken.expiresAt < new Date()) {
      return res.status(401).json({ message: 'Refresh token expired' });
    }

    // Mark current token as used
    storedToken.used = true;
    await storedToken.save();

    // Generate new tokens (rotation)
    const newAccessToken = generateAccessToken(storedToken.user);
    const newRefreshToken = generateRefreshToken(storedToken.user);
    
    // Create new refresh token document with same family
    const newTokenDoc = await RefreshToken.create({
      user: storedToken.user,
      token: crypto.createHash('sha256').update(newRefreshToken).digest('hex'),
      tokenFamily: storedToken.tokenFamily,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip || req.connection.remoteAddress,
      replacedBy: storedToken._id
    });

    logger.info(`Token refreshed for user: ${storedToken.user}`, { correlationId });
    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      expiresIn: 900
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = getZodIssues(err);
      return res.status(400).json({ message: issues[0]?.message || 'Validation failed', errors: issues });
    }
    // Handle duplicate key error from concurrent refresh attempts
    if (err.code === 11000 || err.message?.includes('E11000')) {
      logger.warn(`Concurrent refresh token collision detected. Client should retry.`, { correlationId });
      return res.status(401).json({ message: 'Token refresh conflict. Please try again.' });
    }
    logger.error(`Refresh error: ${err.message}`, { correlationId });
    res.status(500).json({ message: 'Server error' });
  }
});

// Use Backup Code
router.post('/backup-code', async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    const { username, backupCode } = backupCodeSchema.parse(req.body);

    const user = await User.findOne({
      $or: [{ email: username.toLowerCase() }, { username }]
    }).select('+backupCodes');

    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const isValid = await user.verifyBackupCode(backupCode);
    if (!isValid) {
      return res.status(401).json({ message: 'Invalid backup code' });
    }

    // Generate tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);
    await createRefreshTokenDocument(user._id, refreshToken, req);

    const remainingCodes = user.backupCodes.filter(c => !c.used).length;
    logger.info(`Backup code login: ${username}`, { correlationId, userId: user._id });
    
    res.json({
      message: 'Login successful (backup code)',
      accessToken,
      refreshToken,
      expiresIn: 900,
      remainingBackupCodes: remainingCodes
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = getZodIssues(err);
      return res.status(400).json({ message: issues[0]?.message || 'Validation failed', errors: issues });
    }
    logger.error(`Backup code error: ${err.message}`, { correlationId });
    res.status(500).json({ message: 'Server error' });
  }
});

// Request OTP (Email verification)
router.post('/request-otp', async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    if (isBanned(email)) {
      return res.status(403).json({ message: 'This account is permanently banned.' });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    await Otp.findOneAndDelete({ email: email.toLowerCase() });
    await Otp.create({ email: email.toLowerCase(), otp: otpCode });

    const previewUrl = await sendEmergencyOTP(email, otpCode);
    logger.info(`OTP sent to: ${email}`, { correlationId });
    res.json({ message: 'OTP sent successfully', debugPreviewUrl: previewUrl });
  } catch (error) {
    logger.error(`OTP request error: ${error.message}`, { correlationId });
    res.status(500).json({ message: 'Failed to generate OTP' });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required' });

    const existingOtp = await Otp.findOne({ email: email.toLowerCase() });
    if (!existingOtp || existingOtp.otp !== otp) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    await Otp.deleteOne({ _id: existingOtp._id });
    logger.info(`Email verification successful: ${email}`, { correlationId });
    res.json({ message: 'Email verification successful' });
  } catch (error) {
    logger.error(`OTP verification error: ${error.message}`, { correlationId });
    res.status(500).json({ message: 'Server error' });
  }
});

// Logout (revoke refresh token)
router.post('/logout', async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
      await RefreshToken.deleteOne({ token: tokenHash });
    }
    logger.info('Logout successful', { correlationId });
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error(`Logout error: ${err.message}`, { correlationId });
    res.status(500).json({ message: 'Server error' });
  }
});

// Logout all sessions (revoke all refresh tokens for user)
router.post('/logout-all', protect, async (req, res) => {
  const correlationId = getCorrelationId();
  
  try {
    await RefreshToken.deleteMany({ user: req.user._id });
    logger.info(`All sessions revoked for user: ${req.user._id}`, { correlationId });
    res.json({ message: 'All sessions logged out' });
  } catch (err) {
    logger.error(`Logout all error: ${err.message}`, { correlationId });
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
