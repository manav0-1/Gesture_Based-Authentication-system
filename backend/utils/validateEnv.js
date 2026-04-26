// Environment validation - fail fast on missing critical vars
const logger = require('./logger');

const requiredEnvVars = [
  'JWT_SECRET',
  'MONGO_URI',
  'GOOGLE_EMAIL',
  'APP_PASSWORD'
];

const warnings = [
  { var: 'NODE_ENV', default: 'development', message: 'NODE_ENV not set, defaulting to development' }
];

function validateEnv() {
  const missing = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missing.length > 0) {
    logger.error(`❌ Critical environment variables missing: ${missing.join(', ')}`);
    logger.error('Application cannot start without these variables.');
    process.exit(1);
  }

  // Check for default/weak JWT_SECRET
  if (process.env.JWT_SECRET === 'gesture-auth-secret-change-me-in-production' || 
      process.env.JWT_SECRET === 'your-secret-key' ||
      process.env.JWT_SECRET.length < 32) {
    logger.error('❌ JWT_SECRET is using default or weak value. Generate a strong secret (min 32 chars).');
    logger.error('Run: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
    process.exit(1);
  }

  // Warnings for optional vars
  warnings.forEach(({ var: varName, default: defaultVal, message }) => {
    if (!process.env[varName]) {
      logger.warn(`⚠️  ${message}`);
      process.env[varName] = defaultVal;
    }
  });

  logger.info('✅ Environment validation passed');
}

module.exports = validateEnv;
