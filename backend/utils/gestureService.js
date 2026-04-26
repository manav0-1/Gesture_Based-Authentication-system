

const HAND_LANDMARK_COUNT = 21;

// ==================== UTILITY FUNCTIONS ====================

function parseInput(input) {
  if (Array.isArray(input)) {
    if (input.length >= 3 && input.every((value) => typeof value === 'number')) {
      const points = [];
      for (let index = 0; index + 2 < input.length; index += 3) {
        points.push({
          x: toNumber(input[index]),
          y: toNumber(input[index + 1]),
          z: toNumber(input[index + 2])
        });
      }
      return points;
    }
    return input;
  }
  if (input && typeof input === 'object') {
    if (Array.isArray(input.points)) return input.points;
    if (Array.isArray(input.landmarks)) return input.landmarks;
  }
  if (Buffer.isBuffer(input)) {
    try { return parseInput(JSON.parse(input.toString())); } catch { return []; }
  }
  if (typeof input === 'string') {
    try { return parseInput(JSON.parse(input)); } catch { return []; }
  }
  return [];
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

// ==================== BINARY COMPRESSION ====================

function compressMouseGesture(points) {
  const parsed = parseInput(points);
  if (!Array.isArray(parsed) || !parsed.length) return null;
  const buffer = Buffer.allocUnsafe(parsed.length * 12);
  parsed.forEach((p, i) => {
    buffer.writeFloatLE(toNumber(p.x), i * 12);
    buffer.writeFloatLE(toNumber(p.y), i * 12 + 4);
    buffer.writeFloatLE(toNumber(p.t, Date.now()), i * 12 + 8);
  });
  return buffer;
}

function toBinaryBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  // Handle MongoDB Binary objects (have a .buffer property that IS a Buffer)
  if (input && typeof input === 'object' && Buffer.isBuffer(input.buffer)) {
    return input.buffer;
  }
  return null;
}

function decompressMouseGesture(buffer) {
  const buf = toBinaryBuffer(buffer);
  if (!buf) return parseInput(buffer);
  const points = [];
  for (let i = 0; i < buf.length; i += 12) {
    points.push({
      x: buf.readFloatLE(i),
      y: buf.readFloatLE(i + 4),
      t: buf.readFloatLE(i + 8)
    });
  }
  return points;
}

function compressHandLandmarks(landmarks) {
  const parsed = parseInput(landmarks);
  if (!Array.isArray(parsed) || !parsed.length) return null;
  const clean = parsed.slice(0, HAND_LANDMARK_COUNT).map(p => ({
    x: toNumber(Array.isArray(p) ? p[0] : p?.x),
    y: toNumber(Array.isArray(p) ? p[1] : p?.y),
    z: toNumber(Array.isArray(p) ? p[2] : p?.z)
  }));
  const buffer = Buffer.allocUnsafe(clean.length * 12);
  clean.forEach((p, i) => {
    buffer.writeFloatLE(p.x, i * 12);
    buffer.writeFloatLE(p.y, i * 12 + 4);
    buffer.writeFloatLE(p.z, i * 12 + 8);
  });
  return buffer;
}

function decompressHandLandmarks(buffer) {
  const buf = toBinaryBuffer(buffer);
  if (!buf) return parseInput(buffer);
  const points = [];
  for (let i = 0; i < buf.length; i += 12) {
    points.push({
      x: buf.readFloatLE(i),
      y: buf.readFloatLE(i + 4),
      z: buf.readFloatLE(i + 8)
    });
  }
  return points;
}

// ==================== SIMPLE ASSESSMENT (Quality Gates) ====================

function assessMouseGesture(gesture) {
  const points = parseInput(gesture);
  if (!Array.isArray(points) || points.length < 10) {
    return { valid: false, reason: 'Mouse gesture data is invalid or too short' };
  }
  return { valid: true };
}

function assessHandGesture(landmarks) {
  const points = parseInput(landmarks);
  if (!Array.isArray(points) || points.length < 21) {
    return { valid: false, reason: 'Hand gesture data is invalid or incomplete (need 21 landmarks)' };
  }
  return { valid: true };
}

module.exports = {
  assessMouseGesture,
  assessHandGesture,
  compressMouseGesture,
  decompressMouseGesture,
  compressHandLandmarks,
  decompressHandLandmarks
};

