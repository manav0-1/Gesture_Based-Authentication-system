const HAND_LANDMARK_COUNT = 21;
const FEATURE_VERSION = 'hand-features-v1';

const TIP_INDICES = [4, 8, 12, 16, 20];
const ADJACENT_TIP_PAIRS = [
  [4, 8],
  [8, 12],
  [12, 16],
  [16, 20],
];
const ALL_TIP_DISTANCE_PAIRS = [
  [4, 8],
  [4, 12],
  [4, 16],
  [4, 20],
  [8, 12],
  [8, 16],
  [8, 20],
  [12, 16],
  [12, 20],
  [16, 20],
];
const JOINT_ANGLE_TRIPLETS = [
  [0, 1, 2],
  [1, 2, 3],
  [2, 3, 4],
  [0, 5, 6],
  [5, 6, 7],
  [6, 7, 8],
  [0, 9, 10],
  [9, 10, 11],
  [10, 11, 12],
  [0, 13, 14],
  [13, 14, 15],
  [14, 15, 16],
  [0, 17, 18],
  [17, 18, 19],
  [18, 19, 20],
];
const FINGER_EXTENSION_PAIRS = [
  [1, 4],
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
];

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalizeVector(vector) {
  const length = magnitude(vector);
  if (!length) return null;

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function distance3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseJsonString(input) {
  if (typeof input !== 'string') return null;

  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function coercePoint(point) {
  if (Array.isArray(point)) {
    return {
      x: toNumber(point[0]),
      y: toNumber(point[1]),
      z: toNumber(point[2]),
    };
  }

  if (point && typeof point === 'object') {
    return {
      x: toNumber(point.x),
      y: toNumber(point.y),
      z: toNumber(point.z),
    };
  }

  return null;
}

function isFlatNumericArray(points) {
  return (
    Array.isArray(points) &&
    points.length >= 3 &&
    points.every((value) => typeof value === 'number')
  );
}

function parseHandLandmarks(input) {
  if (!input) return [];

  if (Buffer.isBuffer(input)) {
    return parseHandLandmarks(parseJsonString(input.toString()));
  }

  if (typeof input === 'string') {
    return parseHandLandmarks(parseJsonString(input));
  }

  if (Array.isArray(input)) {
    if (isFlatNumericArray(input)) {
      const points = [];
      for (let index = 0; index + 2 < input.length; index += 3) {
        points.push({
          x: toNumber(input[index]),
          y: toNumber(input[index + 1]),
          z: toNumber(input[index + 2]),
        });
      }
      return points.slice(0, HAND_LANDMARK_COUNT);
    }

    return input
      .map(coercePoint)
      .filter(Boolean)
      .slice(0, HAND_LANDMARK_COUNT);
  }

  if (input && typeof input === 'object') {
    if (Array.isArray(input.landmarks)) {
      return parseHandLandmarks(input.landmarks);
    }

    if (Array.isArray(input.points)) {
      return parseHandLandmarks(input.points);
    }
  }

  return [];
}

function extractHandSamples(input) {
  if (!input) return [];

  if (input && typeof input === 'object' && Array.isArray(input.samples)) {
    const samples = input.samples
      .map((sample) => parseHandLandmarks(sample))
      .filter((sample) => sample.length >= HAND_LANDMARK_COUNT);

    if (samples.length) return samples;
  }

  const direct = parseHandLandmarks(input);
  return direct.length >= HAND_LANDMARK_COUNT ? [direct] : [];
}

function normalizeHandSample(points) {
  if (!Array.isArray(points) || points.length < HAND_LANDMARK_COUNT) {
    return null;
  }

  const wrist = points[0];
  const indexMcp = points[5];
  const middleMcp = points[9];
  const pinkyMcp = points[17];

  const across = normalizeVector(subtract(indexMcp, pinkyMcp));
  const upSeed = normalizeVector(subtract(middleMcp, wrist));
  if (!across || !upSeed) return null;

  let forward = normalizeVector(cross(across, upSeed));
  if (!forward) {
    forward = { x: 0, y: 0, z: 1 };
  }

  let up = normalizeVector(cross(forward, across));
  if (!up) {
    up = upSeed;
  }

  const palmWidth = distance3D(indexMcp, pinkyMcp);
  const palmScale = average([
    palmWidth,
    distance3D(wrist, indexMcp),
    distance3D(wrist, middleMcp),
    distance3D(wrist, pinkyMcp),
  ]);
  const scale = palmScale || 1;

  const normalized = points.map((point) => {
    const relative = subtract(point, wrist);
    return {
      x: dot(relative, across) / scale,
      y: dot(relative, up) / scale,
      z: dot(relative, forward) / scale,
    };
  });

  const thumbTip = normalized[4];
  const pinkyTip = normalized[20];

  if (thumbTip && pinkyTip && thumbTip.x > pinkyTip.x) {
    return normalized.map((point) => ({
      x: -point.x,
      y: point.y,
      z: -point.z,
    }));
  }

  return normalized;
}

function angleAtPoint(a, pivot, c) {
  const vectorA = subtract(a, pivot);
  const vectorB = subtract(c, pivot);
  const magnitudeProduct = magnitude(vectorA) * magnitude(vectorB);
  if (!magnitudeProduct) return 0;

  const cosine = clamp(dot(vectorA, vectorB) / magnitudeProduct, -1, 1);
  return Math.acos(cosine) / Math.PI;
}

function averageFeatureVectors(vectors) {
  if (!Array.isArray(vectors) || vectors.length === 0) return [];

  const expectedLength = vectors[0].length;
  if (!expectedLength) return [];

  if (vectors.some((vector) => vector.length !== expectedLength)) {
    return [];
  }

  return Array.from({ length: expectedLength }, (_, featureIndex) =>
    average(vectors.map((vector) => vector[featureIndex]))
  );
}

function extractHandFeatureVectorFromSample(sample) {
  const points = parseHandLandmarks(sample);
  if (points.length < HAND_LANDMARK_COUNT) return [];

  const normalized = normalizeHandSample(points);
  if (!normalized) return [];

  const palmWidth = Math.max(distance3D(normalized[5], normalized[17]), 1e-6);

  const normalizedCoordinates = normalized.flatMap((point) => [
    point.x,
    point.y,
    point.z,
  ]);

  const fingertipDistances = ALL_TIP_DISTANCE_PAIRS.map(([from, to]) =>
    distance3D(normalized[from], normalized[to]) / palmWidth
  );

  const fingertipSpreads = ADJACENT_TIP_PAIRS.map(([from, to]) =>
    angleAtPoint(normalized[from], normalized[0], normalized[to])
  );

  const wristToTipDistances = TIP_INDICES.map(
    (tipIndex) => distance3D(normalized[0], normalized[tipIndex]) / palmWidth
  );

  const fingerExtensions = FINGER_EXTENSION_PAIRS.map(([from, to]) =>
    distance3D(normalized[from], normalized[to]) / palmWidth
  );

  const jointAngles = JOINT_ANGLE_TRIPLETS.map(([from, pivot, to]) =>
    angleAtPoint(normalized[from], normalized[pivot], normalized[to])
  );

  const features = [
    ...normalizedCoordinates,
    ...fingertipDistances,
    ...fingertipSpreads,
    ...wristToTipDistances,
    ...fingerExtensions,
    palmWidth,
    ...jointAngles,
  ];

  return features.every(Number.isFinite) ? features : [];
}

function extractHandFeatureVectors(input) {
  return extractHandSamples(input)
    .map((sample) => extractHandFeatureVectorFromSample(sample))
    .filter((vector) => vector.length > 0);
}

function extractAveragedHandFeatureVector(input) {
  return averageFeatureVectors(extractHandFeatureVectors(input));
}

module.exports = {
  FEATURE_VERSION,
  HAND_LANDMARK_COUNT,
  averageFeatureVectors,
  extractAveragedHandFeatureVector,
  extractHandFeatureVectorFromSample,
  extractHandFeatureVectors,
  extractHandSamples,
  normalizeHandSample,
  parseHandLandmarks,
};
