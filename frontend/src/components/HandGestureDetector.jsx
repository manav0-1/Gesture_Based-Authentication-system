import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import Webcam from 'react-webcam';

const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [0, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [0, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [5, 9],
  [9, 13],
  [13, 17],
];

const CAPTURE_PRESETS = {
  enroll: {
    minSamples: 3,
    maxSamples: 7,
    maxStabilityScore: 0.15,
    minHandDetectionConfidence: 0.65,
    minHandPresenceConfidence: 0.65,
    minTrackingConfidence: 0.65,
  },
  verify: {
    minSamples: 2,
    maxSamples: 5,
    maxStabilityScore: 0.2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.55,
  },
};

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function distance3D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
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

function normalizeVector(vector) {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!length) return null;
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function normalizeSample(points) {
  if (!Array.isArray(points) || points.length < 21) return null;

  const wrist = points[0];
  const indexMcp = points[5];
  const middleMcp = points[9];
  const pinkyMcp = points[17];

  const across = normalizeVector(subtract(indexMcp, pinkyMcp));
  const upSeed = normalizeVector(subtract(middleMcp, wrist));
  if (!across || !upSeed) return null;

  let forward = normalizeVector(cross(across, upSeed));
  if (!forward) forward = { x: 0, y: 0, z: 1 };

  let up = normalizeVector(cross(forward, across));
  if (!up) up = upSeed;

  const scale = average([
    distance3D(wrist, indexMcp),
    distance3D(wrist, middleMcp),
    distance3D(wrist, pinkyMcp),
  ]);

  if (!scale) return null;

  return points.map((point) => {
    const relative = subtract(point, wrist);
    return {
      x: dot(relative, across) / scale,
      y: dot(relative, up) / scale,
      z: dot(relative, forward) / scale,
    };
  });
}

function sampleDistance(sampleA, sampleB) {
  if (!sampleA || !sampleB || sampleA.length !== sampleB.length) {
    return Infinity;
  }

  return average(sampleA.map((point, index) => distance3D(point, sampleB[index])));
}

function averageRawSamples(samples) {
  return samples[0].map((_, index) => ({
    x: average(samples.map((sample) => sample[index].x)),
    y: average(samples.map((sample) => sample[index].y)),
    z: average(samples.map((sample) => sample[index].z)),
  }));
}

function summarizeSamples(samples, config) {
  if (samples.length < config.minSamples) {
    return {
      accepted: false,
      reason: `Capture at least ${config.minSamples} steady hand samples before saving.`,
    };
  }

  const normalizedSamples = samples.map(normalizeSample).filter(Boolean);
  if (normalizedSamples.length < config.minSamples) {
    return {
      accepted: false,
      reason: 'Hand landmarks were incomplete. Try again with your full hand visible.',
    };
  }

  const meanSample = normalizedSamples[0].map((_, index) => ({
    x: average(normalizedSamples.map((sample) => sample[index].x)),
    y: average(normalizedSamples.map((sample) => sample[index].y)),
    z: average(normalizedSamples.map((sample) => sample[index].z)),
  }));

  const stabilityScore = average(
    normalizedSamples.map((sample) => sampleDistance(sample, meanSample))
  );

  if (stabilityScore > config.maxStabilityScore) {
    return {
      accepted: false,
      reason: 'Keep your hand steadier and fully in frame, then try again.',
    };
  }

  return {
    accepted: true,
    gesture: averageRawSamples(samples),
    samples,
    sampleCount: samples.length,
    timestamp: Date.now(),
    stabilityScore,
  };
}

const HandGestureDetector = React.memo(function HandGestureDetector({
  onDetect,
  capturePreset = 'verify',
}) {
  const webcamRef = useRef(null);
  const overlayRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const animationRef = useRef(null);
  const liveSamplesRef = useRef([]);
  const config = CAPTURE_PRESETS[capturePreset] || CAPTURE_PRESETS.verify;

  const [isModelLoading, setIsModelLoading] = useState(true);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isHandDetected, setIsHandDetected] = useState(false);
  const [detectionMessage, setDetectionMessage] = useState(
    'Place your hand inside the frame'
  );
  const [sampleCount, setSampleCount] = useState(0);
  const [isGestureSaved, setIsGestureSaved] = useState(false);
  const [sampleFlash, setSampleFlash] = useState(false);

  useEffect(() => {
    const initHandLandmarker = async () => {
      try {
        setLoadingProgress(10);
        const vision = await FilesetResolver.forVisionTasks('/wasm');
        setLoadingProgress(45);

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/models/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: config.minHandDetectionConfidence,
          minHandPresenceConfidence: config.minHandPresenceConfidence,
          minTrackingConfidence: config.minTrackingConfidence,
        });

        handLandmarkerRef.current = handLandmarker;
        setLoadingProgress(100);
        setIsModelLoading(false);
      } catch (instanceError) {
        setError(`Unable to load hand tracking: ${instanceError.message || 'Unknown error'}`);
        setIsModelLoading(false);
      }
    };

    initHandLandmarker();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (handLandmarkerRef.current) handLandmarkerRef.current.close();
    };
  }, [config.minHandDetectionConfidence, config.minHandPresenceConfidence, config.minTrackingConfidence]);

  const drawLandmarks = useCallback((landmarks) => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (!landmarks?.length) return;

    const width = canvas.width;
    const height = canvas.height;

    context.strokeStyle = 'rgba(122, 244, 214, 0.95)';
    context.lineWidth = 2;
    HAND_CONNECTIONS.forEach(([fromIndex, toIndex]) => {
      const from = landmarks[fromIndex];
      const to = landmarks[toIndex];

      context.beginPath();
      context.moveTo(from.x * width, from.y * height);
      context.lineTo(to.x * width, to.y * height);
      context.stroke();
    });

    landmarks.forEach((point, index) => {
      context.beginPath();
      context.arc(point.x * width, point.y * height, index === 0 ? 6 : 4, 0, 2 * Math.PI);
      context.fillStyle = index === 0 ? '#f8fbff' : '#38d39f';
      context.fill();
      context.strokeStyle = '#06111f';
      context.lineWidth = 1;
      context.stroke();
    });
  }, []);

  useEffect(() => {
    if (isModelLoading || !isCameraReady || !handLandmarkerRef.current) {
      return undefined;
    }

    let lastTimestamp = -1;

    const detect = () => {
      const video = webcamRef.current?.video;

      if (!video || video.readyState < 4) {
        animationRef.current = requestAnimationFrame(detect);
        return;
      }

      const now = performance.now();
      if (now === lastTimestamp) {
        animationRef.current = requestAnimationFrame(detect);
        return;
      }
      lastTimestamp = now;

      try {
        const results = handLandmarkerRef.current.detectForVideo(video, now);
        const landmarks = results.landmarks?.[0] || null;
        const hasHand = Boolean(landmarks);

        setIsHandDetected(hasHand);
        drawLandmarks(landmarks);

        if (hasHand && landmarks) {
          const landmarkObjects = landmarks.map((point) => ({
            x: point.x * 300,
            y: point.y * 200,
            z: (point.z || 0) * 300,
          }));

          const nextSamples = [...liveSamplesRef.current, landmarkObjects].slice(
            -config.maxSamples
          );
          liveSamplesRef.current = nextSamples;
          setSampleCount(nextSamples.length);

          if (!isGestureSaved) {
            if (nextSamples.length < config.minSamples) {
              setDetectionMessage(
                `Capturing samples ${nextSamples.length}/${config.minSamples}`
              );
            } else {
              setDetectionMessage(
                `Ready to save with ${nextSamples.length} collected samples`
              );
            }
          }
        } else {
          liveSamplesRef.current = [];
          setSampleCount(0);
          setDetectionMessage(
            isGestureSaved ? 'Hand gesture saved' : 'Place your hand inside the frame'
          );
        }
      } catch {
        // Ignore transient frame errors and continue.
      }

      animationRef.current = requestAnimationFrame(detect);
    };

    animationRef.current = requestAnimationFrame(detect);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [config.maxSamples, config.minSamples, drawLandmarks, isCameraReady, isGestureSaved, isModelLoading]);

  const handleSaveGesture = () => {
    if (!isHandDetected) {
      setError('Show your full hand before saving a gesture.');
      return;
    }

    const result = summarizeSamples(liveSamplesRef.current, config);
    if (!result.accepted) {
      setError(result.reason);
      setDetectionMessage(`Need ${config.minSamples} to ${config.maxSamples} steady samples`);
      onDetect(null);
      setIsGestureSaved(false);
      return;
    }

    setError('');
    setIsGestureSaved(true);
    setSampleFlash(true);
    window.setTimeout(() => setSampleFlash(false), 180);
    setDetectionMessage('Hand gesture saved');
    onDetect({
      landmarks: result.gesture,
      samples: result.samples,
      sampleCount: result.sampleCount,
      timestamp: result.timestamp,
      stabilityScore: result.stabilityScore,
    });
  };

  const handleClearGesture = () => {
    setError('');
    setIsGestureSaved(false);
    setSampleCount(0);
    liveSamplesRef.current = [];
    onDetect(null);
    setDetectionMessage('Place your hand inside the frame');
  };

  const progressPercent = useMemo(() => {
    return Math.min((sampleCount / config.minSamples) * 100, 100);
  }, [config.minSamples, sampleCount]);

  return (
    <div className="gesture-shell mx-auto w-full max-w-[420px] rounded-[30px] p-4 sm:p-5">
      <div className="flex flex-col gap-5">
        <div className="surface rounded-[26px] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-50">Hand gesture</p>
              <p className="mt-1 text-sm text-slate-400">
                Keep your hand fully visible and steady.
              </p>
            </div>
            <span className="metric-chip">
              <span
                className={`h-2 w-2 rounded-full ${
                  isHandDetected ? 'bg-emerald-300' : 'bg-red-300'
                }`}
              />
              {isHandDetected ? 'Hand detected' : 'Waiting'}
            </span>
          </div>

          <div
            className={`relative overflow-hidden rounded-[24px] border bg-slate-950/80 p-3 transition-all ${
              sampleFlash
                ? 'border-emerald-300/40 shadow-[0_0_0_1px_rgba(56,211,159,0.14)]'
                : 'border-slate-800/70'
            }`}
          >
            <div className="relative overflow-hidden rounded-[20px] border border-slate-800/70 bg-slate-950">
              <Webcam
                ref={webcamRef}
                className="h-[220px] w-full object-cover"
                screenshotFormat="image/jpeg"
                videoConstraints={{ width: 300, height: 200, facingMode: 'user' }}
                onUserMedia={() => {
                  setCameraError('');
                  setIsCameraReady(true);
                }}
                onUserMediaError={() => {
                  setCameraError('Unable to access the camera.');
                  setIsCameraReady(false);
                }}
                mirrored
              />
              <canvas
                ref={overlayRef}
                width={300}
                height={200}
                className="pointer-events-none absolute inset-0 h-full w-full"
                style={{ transform: 'scaleX(-1)' }}
              />

              {isModelLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-sm">
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-700 border-t-sky-400" />
                  <p className="mt-4 text-sm font-medium text-sky-200">
                    Loading {loadingProgress}%
                  </p>
                  <div className="mt-3 h-1.5 w-48 rounded-full bg-slate-800">
                    <div
                      className="h-1.5 rounded-full bg-gradient-to-r from-sky-300 to-emerald-300"
                      style={{ width: `${loadingProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 text-center">
            <p className="text-lg font-semibold text-slate-50">
              {detectionMessage}
            </p>
            
            <div className="mt-4 mx-auto max-w-[200px]">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-400">Samples</span>
                <span className="font-medium text-slate-200">
                  {sampleCount}/{config.maxSamples}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-900">
                <div
                  className="h-1.5 rounded-full bg-gradient-to-r from-emerald-300 via-teal-300 to-sky-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={handleSaveGesture}
                disabled={!isHandDetected || sampleCount < config.minSamples}
                className="button-primary rounded-full px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save gesture
              </button>
              {isGestureSaved && (
                <button
                  type="button"
                  onClick={handleClearGesture}
                  className="button-secondary rounded-full px-5 py-2.5 text-sm font-medium"
                >
                  Clear
                </button>
              )}
            </div>

            {(error || cameraError) && (
              <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/8 px-4 py-3 text-xs text-red-200">
                {error || cameraError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

export default HandGestureDetector;
