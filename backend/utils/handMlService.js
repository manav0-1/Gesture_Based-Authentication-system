const fs = require('fs');
const path = require('path');
const { RandomForestClassifier } = require('ml-random-forest');
const logger = require('./logger');
const {
  FEATURE_VERSION,
  extractAveragedHandFeatureVector,
  extractHandFeatureVectorFromSample,
} = require('./handFeatureService');
const { decompressHandLandmarks } = require('./gestureService');

const MODEL_DIRECTORY = path.join(__dirname, '..', 'data');
const MODEL_PATH = path.join(MODEL_DIRECTORY, 'hand-gesture-rf.json');
const MODEL_VERSION = 'rf-hand-v1';
const DEFAULT_MATCH_THRESHOLD = 0.45;
const MIN_SAMPLES_PER_USER = 2;
const MIN_USERS_FOR_MODEL = 1;

let cachedClassifier = null;
let cachedMetadata = null;
let loadAttempted = false;

function ensureModelDirectory() {
  fs.mkdirSync(MODEL_DIRECTORY, { recursive: true });
}

function safeReadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getStoredHandSamples(user) {
  const sampleBuffers = Array.isArray(user?.handGestureSamples)
    ? user.handGestureSamples
    : [];

  const parsedSamples = sampleBuffers
    .map((buffer) => decompressHandLandmarks(buffer))
    .filter((sample) => Array.isArray(sample) && sample.length >= 21);

  const referenceSample = decompressHandLandmarks(user?.handGestureLandmarks);
  if (Array.isArray(referenceSample) && referenceSample.length >= 21) {
    parsedSamples.push(referenceSample);
  }

  return parsedSamples;
}

function buildTrainingDataset(users) {
  const labelMap = [];
  const trainingSet = [];
  const labels = [];
  const userSummaries = [];

  users.forEach((user) => {
    const userId = String(user._id);
    const featureVectors = getStoredHandSamples(user)
      .map((sample) => extractHandFeatureVectorFromSample(sample))
      .filter((vector) => vector.length > 0);

    if (featureVectors.length < MIN_SAMPLES_PER_USER) {
      return;
    }

    const labelIndex = labelMap.push(userId) - 1;
    featureVectors.forEach((vector) => {
      trainingSet.push(vector);
      labels.push(labelIndex);
    });

    userSummaries.push({
      userId,
      username: user.username,
      sampleCount: featureVectors.length,
    });
  });

  if (trainingSet.length === 0) {
    return {
      labelMap,
      labels,
      trainingSet,
      userSummaries,
    };
  }

  const anomalyLabelIndex = labelMap.push('anomaly') - 1;
  const currentLength = trainingSet.length;
  let seed = 99991;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < currentLength; i++) {
    const baseVector = trainingSet[i];
    for (let j = 0; j < 2; j++) {
      trainingSet.push(baseVector.map(val => val + (random() - 0.5) * 2.0));
      labels.push(anomalyLabelIndex);
    }
  }

  return {
    labelMap,
    labels,
    trainingSet,
    userSummaries,
  };
}

function buildArtifact(classifier, metadata) {
  return {
    metadata,
    model: classifier.toJSON(),
  };
}

function loadModelFromArtifact(artifact) {
  if (!artifact?.metadata || !artifact?.model) {
    return null;
  }

  return {
    classifier: RandomForestClassifier.load(artifact.model),
    metadata: artifact.metadata,
  };
}

function calculateAccuracy(expected, predicted) {
  if (!expected.length || expected.length !== predicted.length) return 0;

  let correct = 0;
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] === predicted[index]) {
      correct += 1;
    }
  }

  return correct / expected.length;
}

function cacheModel(classifier, metadata) {
  cachedClassifier = classifier;
  cachedMetadata = metadata;
  loadAttempted = true;
}

function clearModelCache() {
  cachedClassifier = null;
  cachedMetadata = null;
  loadAttempted = true;
}

function initializeHandGestureModel() {
  loadAttempted = true;

  if (!fs.existsSync(MODEL_PATH)) {
    clearModelCache();
    logger.info('Hand ML model not found on disk. Model training required before authentication.');
    return null;
  }

  const artifact = safeReadJson(MODEL_PATH);
  const loaded = loadModelFromArtifact(artifact);

  if (!loaded) {
    clearModelCache();
    logger.warn('Hand ML model artifact was unreadable. Model retraining required.');
    return null;
  }

  cacheModel(loaded.classifier, loaded.metadata);
  logger.info(
    `Hand ML model loaded (${loaded.metadata.modelVersion}) with ${loaded.metadata.classCount} enrolled classes`
  );

  return loaded.metadata;
}

async function retrainHandGestureModel() {
  const User = require('../models/User');
  const users = await User.find({}, '_id username handGestureLandmarks handGestureSamples').lean();

  const dataset = buildTrainingDataset(users);
  if (
    dataset.labelMap.length < MIN_USERS_FOR_MODEL ||
    dataset.trainingSet.length < dataset.labelMap.length * MIN_SAMPLES_PER_USER
  ) {
    logger.info(
      `Hand ML training skipped: need at least ${MIN_USERS_FOR_MODEL} users with ${MIN_SAMPLES_PER_USER}+ samples`
    );
    return {
      available: false,
      reason: 'insufficient-training-data',
      eligibleUsers: dataset.labelMap.length,
      sampleCount: dataset.trainingSet.length,
    };
  }

  const classifier = new RandomForestClassifier({
    seed: 42,
    maxFeatures: 0.8,
    replacement: true,
    nEstimators: 100,
    useSampleBagging: true,
    treeOptions: {
      maxDepth: 16,
      minNumSamples: 2,
    },
  });

  classifier.train(dataset.trainingSet, dataset.labels);
  const predictions = classifier.predict(dataset.trainingSet);
  const trainingAccuracy = calculateAccuracy(dataset.labels, predictions);

  const metadata = {
    createdAt: new Date().toISOString(),
    classCount: dataset.labelMap.length,
    sampleCount: dataset.trainingSet.length,
    featureCount: dataset.trainingSet[0]?.length || 0,
    featureVersion: FEATURE_VERSION,
    modelVersion: MODEL_VERSION,
    matchThreshold: DEFAULT_MATCH_THRESHOLD,
    labelMap: dataset.labelMap,
    trainingAccuracy,
    eligibleUsers: dataset.userSummaries,
  };

  ensureModelDirectory();
  fs.writeFileSync(
    MODEL_PATH,
    JSON.stringify(buildArtifact(classifier, metadata), null, 2),
    'utf8'
  );

  cacheModel(classifier, metadata);

  logger.info(
    `Hand ML model retrained with ${metadata.classCount} users and ${metadata.sampleCount} samples`
  );

  return {
    available: true,
    ...metadata,
  };
}

function getHandGestureModelStatus() {
  if (!loadAttempted) {
    initializeHandGestureModel();
  }

  if (!cachedClassifier || !cachedMetadata) {
    return {
      available: false,
      reason: 'not-loaded',
    };
  }

  return {
    available: true,
    ...cachedMetadata,
  };
}

function verifyHandGestureWithModel(userId, handGestureInput) {
  if (!loadAttempted) {
    initializeHandGestureModel();
  }

  if (!cachedClassifier || !cachedMetadata) {
    return {
      available: false,
      reason: 'model-unavailable',
    };
  }

  const expectedLabelIndex = cachedMetadata.labelMap.indexOf(String(userId));
  if (expectedLabelIndex === -1) {
    return {
      available: false,
      reason: 'user-not-enrolled-in-model',
    };
  }

  const featureVector = extractAveragedHandFeatureVector(handGestureInput);
  if (!featureVector.length) {
    return {
      available: true,
      match: false,
      similarity: 0,
      confidence: 0,
      reason: 'feature-extraction-failed',
    };
  }

  const [predictedLabelIndex] = cachedClassifier.predict([featureVector]);
  const [confidence = 0] = cachedClassifier.predictProbability(
    [featureVector],
    expectedLabelIndex
  );
  const [predictedConfidence = 0] = cachedClassifier.predictProbability(
    [featureVector],
    predictedLabelIndex
  );

  const predictedUserId = cachedMetadata.labelMap[predictedLabelIndex] || null;
  const match =
    predictedLabelIndex === expectedLabelIndex &&
    confidence >= cachedMetadata.matchThreshold;

  return {
    available: true,
    match,
    similarity: confidence,
    confidence,
    predictedConfidence,
    predictedUserId,
    threshold: cachedMetadata.matchThreshold,
    modelVersion: cachedMetadata.modelVersion,
  };
}

module.exports = {
  getHandGestureModelStatus,
  initializeHandGestureModel,
  retrainHandGestureModel,
  verifyHandGestureWithModel,
};
