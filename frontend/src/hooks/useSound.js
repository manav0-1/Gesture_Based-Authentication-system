import { useCallback, useRef, useEffect } from 'react';

export default function useSound() {
  const audioCtxRef = useRef(null);
  const swipeOscRef = useRef(null);
  const swipeGainRef = useRef(null);
  const lastHoverAtRef = useRef(0);

  const initCtx = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const createVoice = useCallback((ctx, {
    type = 'sine',
    frequency = 440,
    gainAmount = 0.04,
    filterType = 'lowpass',
    filterFrequency = 2200,
    q = 0.8,
  } = {}) => {
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    filter.type = filterType;
    filter.frequency.setValueAtTime(filterFrequency, ctx.currentTime);
    filter.Q.setValueAtTime(q, ctx.currentTime);

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    return { osc, filter, gain, gainAmount };
  }, []);

  const shapeGain = useCallback((ctx, gainNode, {
    attack = 0.01,
    decay = 0.14,
    sustain = 0,
    peak = 0.04,
  } = {}) => {
    const now = ctx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.linearRampToValueAtTime(peak, now + attack);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), now + attack + decay);
  }, []);

  const playTone = useCallback((options = {}) => {
    const ctx = initCtx();
    const {
      duration = 0.18,
      endFrequency,
      filterSweepTo,
      startDelay = 0,
    } = options;
    const { osc, filter, gain, gainAmount } = createVoice(ctx, options);
    const startAt = ctx.currentTime + startDelay;

    osc.frequency.setValueAtTime(options.frequency ?? 440, startAt);
    if (endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
    }

    if (filterSweepTo) {
      filter.frequency.setValueAtTime(options.filterFrequency ?? 2200, startAt);
      filter.frequency.exponentialRampToValueAtTime(filterSweepTo, startAt + duration);
    }

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.linearRampToValueAtTime(gainAmount, startAt + Math.min(duration * 0.25, 0.03));
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.start(startAt);
    osc.stop(startAt + duration);
  }, [createVoice]);

  const playHover = useCallback(() => {
    try {
      const now = performance.now();
      if (now - lastHoverAtRef.current < 80) return;
      lastHoverAtRef.current = now;

      const ctx = initCtx();
      const primary = createVoice(ctx, {
        type: 'triangle',
        frequency: 560,
        gainAmount: 0.025,
        filterFrequency: 1800,
      });
      const shimmer = createVoice(ctx, {
        type: 'sine',
        frequency: 840,
        gainAmount: 0.012,
        filterFrequency: 2600,
      });

      primary.osc.frequency.exponentialRampToValueAtTime(720, ctx.currentTime + 0.12);
      shimmer.osc.frequency.exponentialRampToValueAtTime(980, ctx.currentTime + 0.12);

      shapeGain(ctx, primary.gain, { attack: 0.01, decay: 0.12, peak: primary.gainAmount });
      shapeGain(ctx, shimmer.gain, { attack: 0.008, decay: 0.1, peak: shimmer.gainAmount });

      primary.osc.start();
      shimmer.osc.start();
      primary.osc.stop(ctx.currentTime + 0.12);
      shimmer.osc.stop(ctx.currentTime + 0.12);
    } catch {
      return;
    }
  }, [createVoice, shapeGain]);

  const playNodeTick = useCallback(() => {
    try {
      playTone({
        type: 'sine',
        frequency: 780,
        endFrequency: 940,
        gainAmount: 0.02,
        duration: 0.1,
        filterFrequency: 2400,
      });
    } catch {
      return;
    }
  }, [playTone]);

  const startSwipe = useCallback(() => {
    try {
      const ctx = initCtx();
      if (swipeOscRef.current) {
        swipeOscRef.current.stop();
        swipeOscRef.current.disconnect();
      }
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(140, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(170, ctx.currentTime + 0.18);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, ctx.currentTime);
      filter.Q.setValueAtTime(0.7, ctx.currentTime);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.018, ctx.currentTime + 0.08);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      
      swipeOscRef.current = osc;
      swipeGainRef.current = gain;
    } catch {
      return;
    }
  }, []);

  const stopSwipe = useCallback(() => {
    try {
      if (swipeGainRef.current && swipeOscRef.current) {
        const ctx = initCtx();
        swipeGainRef.current.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
        swipeOscRef.current.stop(ctx.currentTime + 0.1);
        swipeOscRef.current = null;
        swipeGainRef.current = null;
      }
    } catch {
      return;
    }
  }, []);

  // For compatibility with old code if used elsewhere
  const playDraw = playHover; 

  const playSuccess = useCallback(() => {
    try {
      playTone({
        type: 'triangle',
        frequency: 523.25,
        endFrequency: 659.25,
        gainAmount: 0.032,
        duration: 0.16,
        filterFrequency: 2200,
        filterSweepTo: 2800,
      });
      playTone({
        type: 'sine',
        frequency: 659.25,
        endFrequency: 783.99,
        gainAmount: 0.028,
        duration: 0.2,
        filterFrequency: 2600,
        filterSweepTo: 3200,
        startDelay: 0.09,
      });
      playTone({
        type: 'sine',
        frequency: 783.99,
        gainAmount: 0.02,
        duration: 0.26,
        filterFrequency: 3200,
        startDelay: 0.19,
      });
    } catch {
      return;
    }
  }, [playTone]);

  const playError = useCallback(() => {
    try {
      playTone({
        type: 'triangle',
        frequency: 392,
        endFrequency: 329.63,
        gainAmount: 0.03,
        duration: 0.18,
        filterFrequency: 1400,
        filterSweepTo: 1000,
      });
      playTone({
        type: 'sine',
        frequency: 261.63,
        endFrequency: 220,
        gainAmount: 0.022,
        duration: 0.24,
        filterFrequency: 1200,
        filterSweepTo: 850,
        startDelay: 0.05,
      });
    } catch {
      return;
    }
  }, [playTone]);

  useEffect(() => {
    return () => {
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  return { playHover, playDraw, playSuccess, playError, playNodeTick, startSwipe, stopSwipe };
}
