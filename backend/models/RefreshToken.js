const mongoose = require('mongoose');
const crypto = require('crypto');

const refreshTokenSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  tokenFamily: {
    type: String,
    required: true,
    index: true
  },
  issuedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  used: {
    type: Boolean,
    default: false
  },
  replacedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RefreshToken',
    default: null
  },
  userAgent: String,
  ipAddress: String
}, { timestamps: true });

// Auto-expire documents
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Generate secure token
refreshTokenSchema.statics.generateToken = function() {
  return crypto.randomBytes(64).toString('hex');
};

// Generate token family for rotation detection
refreshTokenSchema.statics.generateTokenFamily = function() {
  return crypto.randomBytes(32).toString('hex');
};

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);
