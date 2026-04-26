const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters long']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long'],
    select: false
  },
  // Binary storage for gesture data (compressed)
  mouseGestureData: {
    type: Buffer,
    required: [true, 'Mouse gesture data is required']
  },
  mouseGestureSamples: {
    type: [Buffer],
    default: []
  },
  mouseGestureFeatureVersion: {
    type: String,
    default: 'mouse-features-v1'
  },
  mouseGestureModelEnrolledAt: Date,
  handGestureLandmarks: {
    type: Buffer,
    required: [true, 'Hand gesture landmarks are required']
  },
  handGestureSamples: {
    type: [Buffer],
    default: []
  },
  handGestureFeatureVersion: {
    type: String,
    default: 'hand-features-v1'
  },
  handGestureModelEnrolledAt: Date,
  // Last successful authentication info
  lastAuth: {
    timestamp: Date,
    ipAddress: String,
    userAgent: String,
    method: String
  },
  // Backup codes for emergency access
  backupCodes: [{
    codeHash: { type: String, select: false },
    used: { type: Boolean, default: false },
    usedAt: Date
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  // Legacy fields (for migration)
  emergencyOTP: {
    type: String,
    select: false
  },
  otpExpiresAt: {
    type: Date,
    select: false
  }
}, { timestamps: true });

// Pre-save hook to hash password automatically
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Instance method to check password validity
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate backup codes
userSchema.methods.generateBackupCodes = function() {
  const plaintextCodes = [];
  const hashedCodes = [];

  for (let i = 0; i < 8; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    plaintextCodes.push(code);
    hashedCodes.push({ codeHash: bcrypt.hashSync(code, 10) });
  }

  this.backupCodes = hashedCodes;
  return plaintextCodes;
};

// Verify backup code
userSchema.methods.verifyBackupCode = async function(code) {
  const unusedCodes = this.backupCodes.filter(c => !c.used);
  
  for (const backup of unusedCodes) {
    if (await bcrypt.compare(code, backup.codeHash)) {
      backup.used = true;
      backup.usedAt = new Date();
      await this.save();
      return true;
    }
  }
  return false;
};

module.exports = mongoose.model('User', userSchema);
