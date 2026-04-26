const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const validateEnv = require('../utils/validateEnv');
const logger = require('../utils/logger');
const { retrainHandGestureModel } = require('../utils/handMlService');

validateEnv();

async function main() {
  const mongoUri = process.env.MONGO_URI;
  await mongoose.connect(mongoUri);

  try {
    const result = await retrainHandGestureModel();
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  logger.error(`Hand ML training script failed: ${error.message}`);
  console.error(error);
  process.exit(1);
});
