import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSound from '../hooks/useSound';

const QUALITY_PRESETS = {
  enroll: {
    minPointCount: 14,
    minPathLength: 60,
    minCoverage: 18,
    minScore: 65,
    previewPointHint: 8,
    previewPathHint: 24,
    previewCoverageHint: 12,
  },
  verify: {
    minPointCount: 12,
    minPathLength: 48,
    minCoverage: 15,
    minScore: 55,
    previewPointHint: 7,
    previewPathHint: 20,
    previewCoverageHint: 10,
  },
};

function getStrokeMetrics(points) {
  if (!points.length) {
    return {
      pathLength: 0,
      coverage: 0,
      avgSpeed: 0,
      straightness: 0,
      pointCount: 0,
    };
  }

  let pathLength = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let totalSpeed = 0;

  points.forEach((point, index) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);

    if (index > 0) {
      const previous = points[index - 1];
      const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
      pathLength += distance;

      const delta = point.t - previous.t;
      if (delta > 0) {
        totalSpeed += distance / delta;
      }
    }
  });

  const startEndDistance =
    points.length > 1
      ? Math.hypot(
          points[points.length - 1].x - points[0].x,
          points[points.length - 1].y - points[0].y
        )
      : 0;

  return {
    pathLength,
    coverage: Math.max(maxX - minX, maxY - minY),
    avgSpeed: points.length > 1 ? totalSpeed / (points.length - 1) : 0,
    straightness: pathLength > 0 ? startEndDistance / pathLength : 0,
    pointCount: points.length,
  };
}

function assessQuality(metrics, preset, isComplete = false) {
  const issues = [];
  let score = 100;

  if (metrics.pointCount < preset.previewPointHint) {
    issues.push('Keep drawing');
    score -= 30;
  } else if (metrics.pointCount < preset.minPointCount && isComplete) {
    issues.push('Gesture is too short');
    score -= 20;
  }

  if (metrics.pathLength < preset.previewPathHint) {
    issues.push('Use more range');
    score -= 25;
  } else if (metrics.pathLength < preset.minPathLength && isComplete) {
    issues.push('Draw a larger path');
    score -= 15;
  }

  if (metrics.coverage < preset.previewCoverageHint) {
    issues.push('Spread the gesture out');
    score -= 20;
  } else if (metrics.coverage < preset.minCoverage && isComplete) {
    issues.push('Expand the coverage');
    score -= 10;
  }

  if (metrics.avgSpeed > 4) {
    issues.push('Slow down slightly');
    score -= 15;
  } else if (metrics.avgSpeed < 0.1 && metrics.pointCount > 5) {
    issues.push('Move a bit faster');
    score -= 10;
  }

  if (metrics.straightness > 0.95 && metrics.pathLength > 50) {
    issues.push('Add a curve');
    score -= 10;
  }

  return {
    score: Math.max(0, score),
    issues: issues.slice(0, 2),
    isGood:
      score >= preset.minScore &&
      metrics.pointCount >= preset.minPointCount &&
      metrics.pathLength >= preset.minPathLength &&
      metrics.coverage >= preset.minCoverage,
  };
}

const MouseGestureCanvas = React.memo(function MouseGestureCanvas({
  onComplete,
  showFeedback = true,
  qualityPreset = 'verify',
}) {
  const canvasRef = useRef(null);
  const pointsRef = useRef([]);
  const particlesRef = useRef([]);
  const animationFrameRef = useRef(null);
  const drawingRef = useRef(false);

  const [isDrawing, setIsDrawing] = useState(false);
  const [hasPoints, setHasPoints] = useState(false);
  const [pendingGesture, setPendingGesture] = useState(null);
  const [isGestureSaved, setIsGestureSaved] = useState(false);
  const [helperText, setHelperText] = useState('Draw a deliberate gesture');
  const [quality, setQuality] = useState({ score: 0, issues: [], isGood: false });
  const { playDraw, playError, playSuccess } = useSound();

  const config = QUALITY_PRESETS[qualityPreset] || QUALITY_PRESETS.verify;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    canvas.width = 320 * 2;
    canvas.height = 220 * 2;
    canvas.style.width = '320px';
    canvas.style.height = '220px';

    const context = canvas.getContext('2d');
    context.scale(2, 2);

    const render = () => {
      context.clearRect(0, 0, 320, 220);

      context.fillStyle = 'rgba(4, 9, 18, 0.9)';
      context.fillRect(0, 0, 320, 220);

      context.strokeStyle = 'rgba(132, 151, 178, 0.08)';
      context.lineWidth = 1;
      for (let x = 20; x < 320; x += 20) {
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, 220);
        context.stroke();
      }
      for (let y = 20; y < 220; y += 20) {
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(320, y);
        context.stroke();
      }

      particlesRef.current.forEach((particle, index) => {
        particle.life -= 0.02;
        particle.x += particle.vx;
        particle.y += particle.vy;

        if (particle.life <= 0) {
          particlesRef.current.splice(index, 1);
          return;
        }

        context.beginPath();
        context.arc(particle.x, particle.y, particle.size * particle.life, 0, Math.PI * 2);
        context.fillStyle = `rgba(82, 182, 255, ${particle.life * 0.45})`;
        context.fill();
      });

      const points = pointsRef.current;
      if (points.length > 0) {
        context.beginPath();
        context.moveTo(points[0].x, points[0].y);

        for (let index = 1; index < points.length; index += 1) {
          const previous = points[index - 1];
          const current = points[index];
          const midX = (previous.x + current.x) / 2;
          const midY = (previous.y + current.y) / 2;
          context.quadraticCurveTo(previous.x, previous.y, midX, midY);
        }

        context.lineTo(points[points.length - 1].x, points[points.length - 1].y);
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = 5;
        context.strokeStyle = 'rgba(56, 211, 159, 0.18)';
        context.shadowColor = 'rgba(56, 211, 159, 0.35)';
        context.shadowBlur = 18;
        context.stroke();

        context.lineWidth = 2.4;
        context.strokeStyle = 'rgba(122, 244, 214, 0.98)';
        context.shadowBlur = 8;
        context.stroke();

        context.shadowBlur = 0;
        context.beginPath();
        context.arc(points[0].x, points[0].y, 4, 0, Math.PI * 2);
        context.fillStyle = '#7af4d6';
        context.fill();

        if (drawingRef.current) {
          const last = points[points.length - 1];
          context.beginPath();
          context.arc(last.x, last.y, 3, 0, Math.PI * 2);
          context.fillStyle = '#dffaff';
          context.fill();
        }
      }

      animationFrameRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const clearCanvas = useCallback(() => {
    pointsRef.current = [];
    particlesRef.current = [];
    drawingRef.current = false;
    setPendingGesture(null);
    setIsGestureSaved(false);
    setHasPoints(false);
    setHelperText('Draw a deliberate gesture');
    setQuality({ score: 0, issues: [], isGood: false });
    onComplete(null);
  }, [onComplete]);

  const getCoordinates = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const clientX = event.clientX || event.touches?.[0]?.clientX;
    const clientY = event.clientY || event.touches?.[0]?.clientY;

    return {
      x: clientX - rect.left,
      y: clientY - rect.top,
      t: performance.now(),
    };
  };

  const spawnParticles = (x, y, speed) => {
    const count = Math.min(6, Math.floor(speed) + 1);
    for (let index = 0; index < count; index += 1) {
      particlesRef.current.push({
        x: x + (Math.random() - 0.5) * 8,
        y: y + (Math.random() - 0.5) * 8,
        vx: (Math.random() - 0.5) * speed * 0.35,
        vy: (Math.random() - 0.5) * speed * 0.35,
        size: Math.random() * 2 + 0.5,
        life: 1,
      });
    }
  };

  const startDrawing = (event) => {
    event.preventDefault();
    const point = getCoordinates(event);

    setIsDrawing(true);
    drawingRef.current = true;
    pointsRef.current = [{ ...point }];
    setPendingGesture(null);
    setIsGestureSaved(false);
    setHasPoints(true);
    setHelperText('Capture in progress');
    onComplete(null);
    spawnParticles(point.x, point.y, 5);
    playDraw();
  };

  const draw = (event) => {
    if (!isDrawing) return;
    event.preventDefault();

    const point = getCoordinates(event);
    const lastPoint = pointsRef.current[pointsRef.current.length - 1];

    if (!lastPoint) return;

    const distance = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
    if (distance < 2.5) return;

    const timeDelta = Math.max(point.t - lastPoint.t, 1);
    const speed = (distance / timeDelta) * 12;

    pointsRef.current.push(point);
    if (speed > 0.4) {
      spawnParticles(point.x, point.y, speed);
    }

    if (showFeedback && pointsRef.current.length % 5 === 0) {
      const nextMetrics = getStrokeMetrics(pointsRef.current);
      const nextQuality = assessQuality(nextMetrics, config, false);
      setQuality(nextQuality);
      setHelperText(nextQuality.issues[0] || 'Looking good so far');
    }
  };

  const stopDrawing = () => {
    if (!isDrawing) return;

    setIsDrawing(false);
    drawingRef.current = false;

    const outputPoints = pointsRef.current.map((point) => ({
      x: point.x,
      y: point.y,
      t: point.t,
    }));
    const finalMetrics = getStrokeMetrics(outputPoints);
    const finalQuality = assessQuality(finalMetrics, config, true);

    setQuality(finalQuality);

    if (finalQuality.isGood) {
      setPendingGesture(outputPoints);
      setHelperText('Gesture ready to save');
      return;
    }

    playError();
    setHelperText(finalQuality.issues[0] || 'Try a clearer gesture');

    const wrapper = canvasRef.current?.parentElement;
    if (wrapper) {
      wrapper.classList.add('error-shake', 'flash-red');
      window.setTimeout(() => {
        wrapper.classList.remove('error-shake', 'flash-red');
        clearCanvas();
      }, 720);
    } else {
      window.setTimeout(clearCanvas, 720);
    }
  };

  const saveGesture = () => {
    if (!pendingGesture) return;
    onComplete(pendingGesture);
    setIsGestureSaved(true);
    setHelperText('Gesture saved');
    playSuccess();
  };

  const qualityColor = useMemo(() => {
    if (quality.score >= 80) return 'text-emerald-200';
    if (quality.score >= 60) return 'text-amber-200';
    if (quality.score >= 40) return 'text-orange-200';
    return 'text-red-200';
  }, [quality.score]);

  const qualityBarClass = useMemo(() => {
    if (quality.score >= 80) return 'from-emerald-300 via-teal-300 to-sky-300';
    if (quality.score >= 60) return 'from-amber-300 via-yellow-300 to-orange-300';
    if (quality.score >= 40) return 'from-orange-300 via-amber-300 to-rose-300';
    return 'from-rose-300 via-red-300 to-orange-300';
  }, [quality.score]);

  return (
    <div className="gesture-shell mx-auto w-full max-w-[420px] rounded-[30px] p-4 sm:p-5">
      <div className="flex flex-col gap-5">
        <div className="surface rounded-[26px] p-4">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-slate-50">Mouse gesture</p>
              <p className="mt-1 text-sm text-slate-400">
                {qualityPreset === 'enroll'
                  ? 'Draw something distinctive.'
                  : 'Reproduce your saved gesture.'}
              </p>
            </div>
            <span className="metric-chip">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isGestureSaved
                    ? 'bg-emerald-300'
                    : isDrawing
                    ? 'bg-amber-300'
                    : 'bg-slate-500'
                }`}
              />
              {isGestureSaved ? 'Saved' : isDrawing ? 'Drawing' : 'Idle'}
            </span>
          </div>

          <div className="rounded-[24px] border border-slate-800/80 bg-slate-950/75 p-3">
            <div className="relative overflow-hidden rounded-[20px] border border-slate-800/70 bg-slate-950">
              <canvas
                ref={canvasRef}
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
                style={{ touchAction: 'none', cursor: 'crosshair' }}
                className="block w-full max-w-full"
              />

              {!isDrawing && !hasPoints && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="rounded-[22px] border border-slate-700/40 bg-slate-950/76 px-5 py-4 text-center text-sm leading-6 text-slate-400">
                    Click or touch and drag across the canvas.
                  </div>
                </div>
              )}

              {showFeedback && quality.score > 0 && (
                <div className="absolute right-3 top-3 min-w-[88px] rounded-2xl border border-slate-700/60 bg-slate-950/75 px-3 py-2">
                  <p className={`text-right text-sm font-semibold ${qualityColor}`}>
                    {quality.score}%
                  </p>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-800">
                    <div
                      className={`h-1.5 rounded-full bg-gradient-to-r ${qualityBarClass}`}
                      style={{ width: `${quality.score}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 text-center">
            <p className="text-lg font-semibold text-slate-50">{helperText}</p>
            {showFeedback && quality.issues.length > 0 && !isGestureSaved && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {quality.issues.map((issue) => (
                  <span
                    key={issue}
                    className="rounded-full border border-slate-700/70 bg-slate-950/70 px-3 py-1 text-xs text-slate-300"
                  >
                    {issue}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={clearCanvas}
                className="button-secondary rounded-full px-5 py-2.5 text-sm font-medium"
              >
                {pendingGesture ? 'Draw again' : 'Clear'}
              </button>
              {pendingGesture && !isGestureSaved && (
                <button
                  type="button"
                  onClick={saveGesture}
                  className="button-primary rounded-full px-5 py-2.5 text-sm font-semibold"
                >
                  Save gesture
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default MouseGestureCanvas;
