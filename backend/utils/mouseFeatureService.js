const { decompressMouseGesture } = require('./gestureService');

const FEATURE_VERSION = 'mouse-features-v1';
const MIN_MOUSE_POINT_COUNT = 6;
const RESAMPLED_POINT_COUNT = 24;
const DIRECTION_BIN_COUNT = 8;
const CURVATURE_BIN_COUNT = 6;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function average(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeAngle(angle) {
  let normalized = angle;
  while (normalized <= -Math.PI) normalized += Math.PI * 2;
  while (normalized > Math.PI) normalized -= Math.PI * 2;
  return normalized;
}

function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function parseMousePoint(point, fallbackTime = 0) {
  if (Array.isArray(point)) {
    return {
      x: toNumber(point[0]),
      y: toNumber(point[1]),
      t: toNumber(point[2], fallbackTime),
    };
  }

  if (point && typeof point === 'object') {
    return {
      x: toNumber(point.x),
      y: toNumber(point.y),
      t: toNumber(point.t, fallbackTime),
    };
  }

  return null;
}

function dedupeSequentialPoints(points) {
  const deduped = [];

  points.forEach((point) => {
    const previous = deduped[deduped.length - 1];
    if (!previous || previous.x !== point.x || previous.y !== point.y || previous.t !== point.t) {
      deduped.push(point);
    }
  });

  return deduped;
}

function normalizeTimestamps(points) {
  if (!Array.isArray(points) || points.length === 0) return [];

  const normalized = [];
  let elapsed = 0;

  points.forEach((point, index) => {
    if (index > 0) {
      const delta = point.t - points[index - 1].t;
      elapsed += delta > 0 ? delta : 1;
    }

    normalized.push({
      x: point.x,
      y: point.y,
      t: elapsed,
    });
  });

  return normalized;
}

function parseMousePoints(input) {
  const parsed = decompressMouseGesture(input);
  if (!Array.isArray(parsed)) return [];

  const sanitized = parsed
    .map((point, index) => parseMousePoint(point, index))
    .filter(Boolean)
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.t));

  return dedupeSequentialPoints(normalizeTimestamps(sanitized));
}

function extractMouseSamples(input) {
  if (!input) return [];

  if (input && typeof input === 'object' && Array.isArray(input.samples)) {
    const samples = input.samples
      .map((sample) => parseMousePoints(sample))
      .filter((sample) => sample.length >= MIN_MOUSE_POINT_COUNT);

    if (samples.length) return samples;
  }

  const direct = parseMousePoints(input);
  return direct.length >= MIN_MOUSE_POINT_COUNT ? [direct] : [];
}

function computePathLength(points) {
  if (!Array.isArray(points) || points.length < 2) return 0;

  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance2D(points[index - 1], points[index]);
  }

  return length;
}

function getBoundingBox(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
  }

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
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function normalizeMouseSample(points) {
  if (!Array.isArray(points) || points.length < MIN_MOUSE_POINT_COUNT) {
    return null;
  }

  const bounds = getBoundingBox(points);
  const scale = Math.max(bounds.width, bounds.height);
  if (!scale) return null;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return points.map((point) => ({
    x: (point.x - centerX) / scale,
    y: (point.y - centerY) / scale,
    t: point.t,
  }));
}

function resampleMouseSample(points, targetCount = RESAMPLED_POINT_COUNT) {
  if (!Array.isArray(points) || points.length === 0 || targetCount <= 0) return [];
  if (points.length === 1) {
    return Array.from({ length: targetCount }, () => ({ ...points[0] }));
  }

  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distance2D(points[index - 1], points[index]));
  }

  const totalLength = cumulative[cumulative.length - 1];
  if (!totalLength) {
    return Array.from({ length: targetCount }, () => ({ ...points[0] }));
  }

  const resampled = [];
  let segmentIndex = 1;

  for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
    const targetDistance = (targetIndex / Math.max(targetCount - 1, 1)) * totalLength;

    while (
      segmentIndex < cumulative.length - 1 &&
      cumulative[segmentIndex] < targetDistance
    ) {
      segmentIndex += 1;
    }

    const previousIndex = Math.max(segmentIndex - 1, 0);
    const nextIndex = Math.min(segmentIndex, points.length - 1);
    const segmentStartDistance = cumulative[previousIndex];
    const segmentEndDistance = cumulative[nextIndex];
    const span = segmentEndDistance - segmentStartDistance || 1;
    const ratio = clamp((targetDistance - segmentStartDistance) / span, 0, 1);
    const start = points[previousIndex];
    const end = points[nextIndex];

    resampled.push({
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
      t: start.t + (end.t - start.t) * ratio,
    });
  }

  return resampled;
}

function computeDirectionHistogram(points, binCount = DIRECTION_BIN_COUNT) {
  const histogram = Array(binCount).fill(0);
  let totalWeight = 0;

  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = distance2D(from, to);
    if (!length) continue;

    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const normalized = (angle + Math.PI) / (Math.PI * 2);
    const bucket = Math.min(binCount - 1, Math.floor(normalized * binCount));
    histogram[bucket] += length;
    totalWeight += length;
  }

  return totalWeight ? histogram.map((value) => value / totalWeight) : histogram;
}

function computeCurvatureHistogram(points, binCount = CURVATURE_BIN_COUNT) {
  const histogram = Array(binCount).fill(0);
  let turns = 0;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    const firstAngle = Math.atan2(current.y - previous.y, current.x - previous.x);
    const secondAngle = Math.atan2(next.y - current.y, next.x - current.x);
    const turnMagnitude = Math.abs(normalizeAngle(secondAngle - firstAngle)) / Math.PI;
    const bucket = Math.min(binCount - 1, Math.floor(turnMagnitude * binCount));

    histogram[bucket] += 1;
    turns += 1;
  }

  return turns ? histogram.map((value) => value / turns) : histogram;
}

function computeTemporalFeatures(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return {
      durationMs: 0,
      avgSpeed: 0,
      maxSpeed: 0,
      speedVariance: 0,
      pauseRatio: 0,
    };
  }

  const speeds = [];

  for (let index = 1; index < points.length; index += 1) {
    const distance = distance2D(points[index - 1], points[index]);
    const deltaT = Math.max(points[index].t - points[index - 1].t, 1);
    speeds.push((distance / deltaT) * 1000);
  }

  const avgSpeed = average(speeds);
  const speedVariance = average(speeds.map((speed) => (speed - avgSpeed) ** 2));
  const maxSpeed = speeds.length ? Math.max(...speeds) : 0;
  const pauseThreshold = avgSpeed > 0 ? avgSpeed * 0.45 : 0;
  const pauseRatio = speeds.length
    ? speeds.filter((speed) => speed <= pauseThreshold).length / speeds.length
    : 0;

  return {
    durationMs: Math.max(points[points.length - 1].t - points[0].t, 0),
    avgSpeed,
    maxSpeed,
    speedVariance,
    pauseRatio,
  };
}

function computeShapeFeatures(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return [];
  }

  const bounds = getBoundingBox(points);
  const pathLength = computePathLength(points);
  const start = points[0];
  const end = points[points.length - 1];
  const startEndDistance = distance2D(start, end);
  const firstSegment = {
    x: points[1].x - points[0].x,
    y: points[1].y - points[0].y,
  };
  const lastSegment = {
    x: points[points.length - 1].x - points[points.length - 2].x,
    y: points[points.length - 1].y - points[points.length - 2].y,
  };

  let signedTurn = 0;
  let absoluteTurn = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const firstAngle = Math.atan2(current.y - previous.y, current.x - previous.x);
    const secondAngle = Math.atan2(next.y - current.y, next.x - current.x);
    const turn = normalizeAngle(secondAngle - firstAngle);
    signedTurn += turn;
    absoluteTurn += Math.abs(turn);
  }

  return [
    pathLength,
    bounds.width,
    bounds.height,
    bounds.width / Math.max(bounds.height, 1e-6),
    start.x,
    start.y,
    end.x,
    end.y,
    startEndDistance,
    pathLength > 0 ? startEndDistance / pathLength : 0,
    Math.atan2(firstSegment.y, firstSegment.x) / Math.PI,
    Math.atan2(lastSegment.y, lastSegment.x) / Math.PI,
    signedTurn / Math.PI,
    absoluteTurn / Math.PI,
  ];
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

function extractMouseFeatureVectorFromSample(sample) {
  const points = parseMousePoints(sample);
  if (points.length < MIN_MOUSE_POINT_COUNT) return [];

  const normalized = normalizeMouseSample(points);
  if (!normalized) return [];

  const resampled = resampleMouseSample(normalized, RESAMPLED_POINT_COUNT);
  const coordinates = resampled.flatMap((point) => [point.x, point.y]);
  const directionHistogram = computeDirectionHistogram(resampled);
  const curvatureHistogram = computeCurvatureHistogram(resampled);
  const shapeFeatures = computeShapeFeatures(resampled);
  const temporal = computeTemporalFeatures(resampled);

  const durationSeconds = temporal.durationMs / 1000;

  const features = [
    ...coordinates,
    ...directionHistogram,
    ...curvatureHistogram,
    ...shapeFeatures,
    durationSeconds,
    temporal.avgSpeed,
    temporal.maxSpeed,
    temporal.speedVariance,
    temporal.pauseRatio,
  ];

  return features.every(Number.isFinite) ? features : [];
}

function extractMouseFeatureVectors(input) {
  return extractMouseSamples(input)
    .map((sample) => extractMouseFeatureVectorFromSample(sample))
    .filter((vector) => vector.length > 0);
}

function extractAveragedMouseFeatureVector(input) {
  return averageFeatureVectors(extractMouseFeatureVectors(input));
}

module.exports = {
  FEATURE_VERSION,
  MIN_MOUSE_POINT_COUNT,
  RESAMPLED_POINT_COUNT,
  averageFeatureVectors,
  extractAveragedMouseFeatureVector,
  extractMouseFeatureVectorFromSample,
  extractMouseFeatureVectors,
  extractMouseSamples,
  normalizeMouseSample,
  parseMousePoints,
  resampleMouseSample,
};
