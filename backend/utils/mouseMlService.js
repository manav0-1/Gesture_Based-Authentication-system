const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const {
  FEATURE_VERSION,
  extractAveragedMouseFeatureVector,
  extractMouseFeatureVectorFromSample,
  parseMousePoints,
} = require('./mouseFeatureService');

const MODEL_DIRECTORY = path.join(__dirname, '..', 'data');
const MODEL_PATH = path.join(MODEL_DIRECTORY, 'mouse-gesture-svm.json');
const MODEL_VERSION = 'svm-mouse-v1';
const DEFAULT_MATCH_THRESHOLD = 0.45;
const MIN_USERS_FOR_MODEL = 1;
const AUGMENTATIONS_PER_SAMPLE = 12;

// SVM hyperparameters
const SVM_COST = 8;
const SVM_GAMMA = 0.5;

let SVM = null; // loaded asynchronously
let svmReady = false;
let cachedSvm = null;
let cachedMetadata = null;
let loadAttempted = false;

// ─── WASM Initialization ──────────────────────────────────────

async function ensureSvmLoaded() {
  if (SVM) return SVM;

  try {
    SVM = await require('libsvm-js');
    svmReady = true;
    logger.info('libsvm-js WASM module loaded successfully');
    return SVM;
  } catch (error) {
    logger.error(`Failed to load libsvm-js WASM module: ${error.message}`);
    svmReady = false;
    return null;
  }
}

// ─── Utilities ────────────────────────────────────────────────

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

// ─── Feature Scaling (Min-Max Normalization) ──────────────────
// SVM is sensitive to feature scale; RF is not.
// We compute per-feature min/max from training data and store
// them in the model artifact so prediction uses the same scale.

function computeScaler(trainingSet) {
  if (!trainingSet.length) return { min: [], max: [] };

  const featureCount = trainingSet[0].length;
  const min = Array(featureCount).fill(Infinity);
  const max = Array(featureCount).fill(-Infinity);

  for (const vector of trainingSet) {
    for (let i = 0; i < featureCount; i++) {
      if (vector[i] < min[i]) min[i] = vector[i];
      if (vector[i] > max[i]) max[i] = vector[i];
    }
  }

  return { min, max };
}

function applyScaler(vector, scaler) {
  return vector.map((value, i) => {
    const range = scaler.max[i] - scaler.min[i];
    if (range === 0) return 0;
    return (value - scaler.min[i]) / range;
  });
}

function scaleDataset(trainingSet, scaler) {
  return trainingSet.map((vector) => applyScaler(vector, scaler));
}

// ─── Data Augmentation ────────────────────────────────────────

function hashStringToSeed(value) {
  const input = String(value || '');
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seed) {
  let state = (seed >>> 0) || 1;

  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function getMouseBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });

  return {
    width: maxX - minX,
    height: maxY - minY,
  };
}

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y);
  if (!length) return null;

  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function augmentMouseSample(sample, seed) {
  if (!Array.isArray(sample) || sample.length < 2) return [];

  const random = createSeededRandom(seed);
  const bounds = getMouseBounds(sample);
  const scale = Math.max(bounds.width, bounds.height) || 1;
  const jitterScale = scale * (0.008 + random() * 0.012);
  const waveScale = scale * (0.003 + random() * 0.007);
  const timeScale = 0.9 + random() * 0.2;

  const augmented = sample.map((point, index) => {
    const previous = sample[Math.max(index - 1, 0)];
    const next = sample[Math.min(index + 1, sample.length - 1)];
    const direction =
      normalizeVector({
        x: next.x - previous.x,
        y: next.y - previous.y,
      }) || { x: 1, y: 0 };
    const perpendicular = { x: -direction.y, y: direction.x };
    const progress = sample.length > 1 ? index / (sample.length - 1) : 0;
    const anchor = Math.sin(progress * Math.PI);
    const tangentialNoise = (random() - 0.5) * 2 * jitterScale * 0.45 * anchor;
    const normalNoise = (random() - 0.5) * 2 * jitterScale * anchor;
    const wave = Math.sin(progress * Math.PI * (2 + (seed % 3))) * waveScale * anchor;

    return {
      x:
        point.x +
        direction.x * tangentialNoise +
        perpendicular.x * (normalNoise + wave),
      y:
        point.y +
        direction.y * tangentialNoise +
        perpendicular.y * (normalNoise + wave),
      t: point.t,
    };
  });

  let elapsed = 0;
  const startTime = sample[0]?.t || 0;

  return augmented.map((point, index) => {
    if (index > 0) {
      const rawDelta = Math.max(sample[index].t - sample[index - 1].t, 1);
      const deltaScale = timeScale * (0.92 + random() * 0.16);
      elapsed += rawDelta * deltaScale;
    }

    return {
      x: point.x,
      y: point.y,
      t: startTime + elapsed,
    };
  });
}

// ─── Training Data Construction ───────────────────────────────

function getStoredMouseSamples(user) {
  const sampleBuffers = Array.isArray(user?.mouseGestureSamples)
    ? user.mouseGestureSamples
    : [];

  const samples = [];
  const signatures = new Set();

  const pushSample = (input) => {
    const parsed = parseMousePoints(input);
    if (parsed.length < 2) return;

    const signature = JSON.stringify(
      parsed.map((point) => [
        Number(point.x.toFixed(3)),
        Number(point.y.toFixed(3)),
        Number(point.t.toFixed(1)),
      ])
    );

    if (signatures.has(signature)) return;
    signatures.add(signature);
    samples.push(parsed);
  };

  sampleBuffers.forEach(pushSample);
  pushSample(user?.mouseGestureData);

  return samples;
}

function buildTrainingDataset(users) {
  const labelMap = [];
  const trainingSet = [];
  const labels = [];
  const userSummaries = [];
  let baseSampleCount = 0;

  users.forEach((user) => {
    const userId = String(user._id);
    const samples = getStoredMouseSamples(user);
    const featureVectors = [];

    samples.forEach((sample, sampleIndex) => {
      const baseVector = extractMouseFeatureVectorFromSample(sample);
      if (baseVector.length) {
        featureVectors.push(baseVector);
        baseSampleCount += 1;
      }

      for (let augmentIndex = 0; augmentIndex < AUGMENTATIONS_PER_SAMPLE; augmentIndex += 1) {
        const seed = hashStringToSeed(`${userId}:${sampleIndex}:${augmentIndex}`);
        const augmented = augmentMouseSample(sample, seed);
        const vector = extractMouseFeatureVectorFromSample(augmented);
        if (vector.length) {
          featureVectors.push(vector);
        }
      }
    });

    if (!featureVectors.length) {
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
      baseSampleCount: samples.length,
      trainingVectorCount: featureVectors.length,
    });
  });

  if (trainingSet.length === 0) {
    return {
      labelMap,
      labels,
      trainingSet,
      userSummaries,
      baseSampleCount,
    };
  }

  // Generate synthetic anomaly class
  const anomalyLabelIndex = labelMap.push('anomaly') - 1;
  const currentLength = trainingSet.length;
  let seed = 88881;
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
    baseSampleCount,
  };
}

// ─── Model Persistence ────────────────────────────────────────

function buildArtifact(svmModel, metadata) {
  return {
    metadata,
    model: svmModel,
  };
}

function cacheModel(svm, metadata) {
  // Free previous SVM instance if it exists (WASM memory management)
  if (cachedSvm && typeof cachedSvm.free === 'function') {
    try {
      cachedSvm.free();
    } catch {
      // Ignore errors during cleanup
    }
  }

  cachedSvm = svm;
  cachedMetadata = metadata;
  loadAttempted = true;
}

function clearModelCache() {
  if (cachedSvm && typeof cachedSvm.free === 'function') {
    try {
      cachedSvm.free();
    } catch {
      // Ignore errors during cleanup
    }
  }

  cachedSvm = null;
  cachedMetadata = null;
  loadAttempted = true;
}

// ─── Initialization ───────────────────────────────────────────

async function initializeMouseGestureModel() {
  loadAttempted = true;

  const LoadedSVM = await ensureSvmLoaded();
  if (!LoadedSVM) {
    clearModelCache();
    logger.warn('Mouse SVM: WASM module unavailable. Model cannot be loaded.');
    return null;
  }

  if (!fs.existsSync(MODEL_PATH)) {
    clearModelCache();
    logger.info('Mouse SVM model not found on disk. Model training required before authentication.');
    return null;
  }

  const artifact = safeReadJson(MODEL_PATH);
  if (!artifact?.metadata || !artifact?.model) {
    clearModelCache();
    logger.warn('Mouse SVM model artifact was unreadable. Model retraining required.');
    return null;
  }

  try {
    const svm = LoadedSVM.load(artifact.model);
    cacheModel(svm, artifact.metadata);
    logger.info(
      `Mouse SVM model loaded (${artifact.metadata.modelVersion}) with ${artifact.metadata.classCount} enrolled classes`
    );
    return artifact.metadata;
  } catch (error) {
    clearModelCache();
    logger.warn(`Mouse SVM model failed to load: ${error.message}. Retraining required.`);
    return null;
  }
}

// ─── Training ─────────────────────────────────────────────────

async function retrainMouseGestureModel() {
  const LoadedSVM = await ensureSvmLoaded();
  if (!LoadedSVM) {
    return {
      available: false,
      reason: 'svm-wasm-unavailable',
    };
  }

  const User = require('../models/User');
  const users = await User.find({}, '_id username mouseGestureData mouseGestureSamples').lean();

  const dataset = buildTrainingDataset(users);
  if (dataset.labelMap.length < MIN_USERS_FOR_MODEL || dataset.trainingSet.length === 0) {
    logger.info(
      `Mouse SVM training skipped: need at least ${MIN_USERS_FOR_MODEL} users with mouse gestures`
    );
    return {
      available: false,
      reason: 'insufficient-training-data',
      eligibleUsers: dataset.labelMap.length,
      sampleCount: dataset.baseSampleCount,
    };
  }

  // Compute feature scaler from training data
  const scaler = computeScaler(dataset.trainingSet);
  const scaledTrainingSet = scaleDataset(dataset.trainingSet, scaler);

  // Create and train SVM (C-SVC with RBF kernel)
  const svm = new LoadedSVM({
    type: LoadedSVM.SVM_TYPES.C_SVC,
    kernel: LoadedSVM.KERNEL_TYPES.RBF,
    cost: SVM_COST,
    gamma: SVM_GAMMA,
    probabilityEstimates: true,
  });

  svm.train(scaledTrainingSet, dataset.labels);

  // Evaluate training accuracy
  const predictions = scaledTrainingSet.map((vector) => svm.predictOne(vector));
  const trainingAccuracy = calculateAccuracy(dataset.labels, predictions);

  const metadata = {
    createdAt: new Date().toISOString(),
    classCount: dataset.labelMap.length,
    sampleCount: dataset.baseSampleCount,
    trainingVectorCount: dataset.trainingSet.length,
    featureCount: dataset.trainingSet[0]?.length || 0,
    featureVersion: FEATURE_VERSION,
    modelVersion: MODEL_VERSION,
    matchThreshold: DEFAULT_MATCH_THRESHOLD,
    labelMap: dataset.labelMap,
    trainingAccuracy,
    augmentationsPerSample: AUGMENTATIONS_PER_SAMPLE,
    eligibleUsers: dataset.userSummaries,
    algorithm: 'SVM',
    svmType: 'C-SVC',
    kernel: 'RBF',
    cost: SVM_COST,
    gamma: SVM_GAMMA,
    scaler,
  };

  // Serialize the SVM model
  const svmModel = svm.serializeModel();

  ensureModelDirectory();
  fs.writeFileSync(
    MODEL_PATH,
    JSON.stringify(buildArtifact(svmModel, metadata), null, 2),
    'utf8'
  );

  cacheModel(svm, metadata);

  logger.info(
    `Mouse SVM model retrained with ${metadata.classCount} users, ${metadata.trainingVectorCount} vectors, accuracy: ${(trainingAccuracy * 100).toFixed(1)}%`
  );

  return {
    available: true,
    ...metadata,
  };
}

// ─── Status ───────────────────────────────────────────────────

function getMouseGestureModelStatus() {
  if (!cachedSvm || !cachedMetadata) {
    return {
      available: false,
      reason: loadAttempted ? 'not-loaded' : 'not-initialized',
    };
  }

  return {
    available: true,
    ...cachedMetadata,
  };
}

// ─── Verification ─────────────────────────────────────────────

function verifyMouseGestureWithModel(userId, mouseGestureInput) {
  if (!cachedSvm || !cachedMetadata) {
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

  const featureVector = extractAveragedMouseFeatureVector(mouseGestureInput);
  if (!featureVector.length) {
    return {
      available: true,
      match: false,
      similarity: 0,
      confidence: 0,
      reason: 'feature-extraction-failed',
    };
  }

  // Apply the same scaler used during training
  const scaledVector = applyScaler(featureVector, cachedMetadata.scaler);

  const predictedLabelIndex = cachedSvm.predictOne(scaledVector);

  // Get probability estimates for all classes
  // predictOneProbability returns { prediction, estimates: [{label, probability}, ...] }
  const probResult = cachedSvm.predictOneProbability(scaledVector);
  const estimates = probResult?.estimates || [];

  // Find confidence for expected user and predicted user by label index
  const expectedEstimate = estimates.find((e) => e.label === expectedLabelIndex);
  const predictedEstimate = estimates.find((e) => e.label === predictedLabelIndex);
  const confidence = expectedEstimate?.probability ?? 0;
  const predictedConfidence = predictedEstimate?.probability ?? 0;

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
  getMouseGestureModelStatus,
  initializeMouseGestureModel,
  retrainMouseGestureModel,
  verifyMouseGestureWithModel,
};
