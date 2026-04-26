import React, { lazy, Suspense, useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useAnimation } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';
import MouseGestureCanvas from './MouseGestureCanvas';
import VaultAnimation from './VaultAnimation';
import CyberLoader from './CyberLoader';
import useSound from '../hooks/useSound';

const steps = ['Credentials', 'Gesture'];
const HandGestureDetector = lazy(() => import('./HandGestureDetector'));

function GestureDetectorFallback() {
  return (
    <div className="flex w-full max-w-sm flex-col items-center">
      <div className="flex h-[220px] w-full items-center justify-center rounded-2xl border border-slate-700/40 bg-slate-900/60 shadow-xl">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-400" />
          <p className="mt-4 text-sm font-medium text-emerald-200">
            Loading hand gesture tools...
          </p>
        </div>
      </div>
    </div>
  );
}

function AnimatedInput({ label, type = 'text', name, value, onChange }) {
  const [focused, setFocused] = useState(false);
  const hasValue = Boolean(value?.length);

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="peer block w-full rounded-2xl border border-slate-700/60 bg-slate-950/60 px-4 pb-3.5 pt-6 text-slate-100 outline-none transition-all duration-300 focus:border-emerald-300/40 focus:bg-slate-950/90"
        placeholder=" "
      />
      <label
        className={`pointer-events-none absolute left-4 transition-all duration-300 ${
          focused || hasValue
            ? 'top-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200'
            : 'top-4 text-sm text-slate-400'
        }`}
      >
        {label}
      </label>
      <motion.div
        className="absolute bottom-0 left-1/2 h-[2px] rounded-full bg-emerald-400"
        initial={{ width: 0, x: '-50%' }}
        animate={{ width: focused ? '100%' : '0%', x: '-50%' }}
        transition={{ duration: 0.28 }}
        style={{ boxShadow: focused ? '0 0 12px rgba(56, 211, 159, 0.4)' : 'none' }}
      />
    </motion.div>
  );
}

function StepIndicator({ activeStep }) {
  return (
    <div className="auth-stepper">
      {steps.map((label, index) => (
        <motion.div
          key={label}
          className={`auth-step ${index === activeStep ? 'active' : ''} ${
            index < activeStep ? 'done' : ''
          }`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.08 }}
        >
          <motion.span className="auth-step-dot">
            {index < activeStep ? 'Done' : index + 1}
          </motion.span>
          <span>{label}</span>
        </motion.div>
      ))}
    </div>
  );
}

export default function SignIn() {
  const navigate = useNavigate();
  const [gestureMode, setGestureMode] = useState('hand');
  const [showVault, setShowVault] = useState(false);
  const { playHover, playSuccess, playError } = useSound();
  const controls = useAnimation();

  const login = useAuthStore((state) => state.login);
  const verifyCredentials = useAuthStore((state) => state.verifyCredentials);
  const isLoading = useAuthStore((state) => state.isLoading);

  const {
    activeStep,
    formData,
    error,
    success,
    setFormField,
    setMouseGesture,
    setHandGesture,
    setError,
    setActiveStep,
    nextStep,
    prevStep,
    resetForm,
    clearMessages,
  } = useAuthStore();

  useEffect(() => {
    setActiveStep(0);
    clearMessages();
    setMouseGesture(null);
    setHandGesture(null);

    return () => {
      clearMessages();
    };
  }, [clearMessages, setActiveStep, setHandGesture, setMouseGesture]);

  useEffect(() => {
    if (error) {
      playError();
      controls.start({
        x: [-12, 12, -8, 8, -4, 4, 0],
        transition: { duration: 0.35 },
      });
    }
  }, [controls, error, playError]);

  useEffect(() => {
    setMouseGesture(null);
    setHandGesture(null);
  }, [gestureMode, setHandGesture, setMouseGesture]);

  const handleInputChange = (event) => {
    setFormField(event.target.name, event.target.value);
  };

  const handleNext = async () => {
    if (!formData.password || (!formData.username && !formData.email)) {
      setError('Enter your password and either username or email.');
      return;
    }

    if (formData.email && (!formData.email.includes('@') || !formData.email.includes('.'))) {
      setError('Invalid email address.');
      return;
    }

    const verified = await verifyCredentials();
    if (verified) {
      nextStep();
    }
  };

  const handleSubmit = async () => {
    const ok = await login();
    if (ok) {
      playSuccess();
      setShowVault(true);
    }
  };

  const handleVaultComplete = () => {
    resetForm();
    navigate('/dashboard');
  };

  const stepVariants = {
    initial: { opacity: 0, x: 40, filter: 'blur(4px)' },
    animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
    exit: { opacity: 0, x: -40, filter: 'blur(4px)' },
  };

  return (
    <div className="auth-page">
      <VaultAnimation isSuccess={showVault} onAnimationComplete={handleVaultComplete} />

      {!showVault && (
        <motion.div
          animate={controls}
          initial={{ scale: 0.96, opacity: 0, y: 20 }}
          whileInView={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="auth-card overflow-hidden relative z-10"
        >
          <div className="auth-header text-center">
            <motion.p
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 }}
              className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-200"
            >
              Welcome back
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 }}
              className="mt-3 text-3xl font-semibold text-slate-50"
            >
              Sign in
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.22 }}
              className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-400"
            >
              Enter your account details, then confirm access with your saved gesture.
            </motion.p>
          </div>

          <StepIndicator activeStep={activeStep} />

          <div className="relative min-h-[350px] overflow-hidden p-8">
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div
                  key="loader"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
                >
                  <CyberLoader text="Authenticating..." />
                </motion.div>
              ) : activeStep === 0 ? (
                <motion.div
                  key="step0"
                  variants={stepVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="mx-auto mt-2 max-w-md space-y-4"
                >
                  <AnimatedInput
                    label="Username"
                    name="username"
                    value={formData.username}
                    onChange={handleInputChange}
                  />
                  <AnimatedInput
                    label="Email"
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleInputChange}
                  />
                  <AnimatedInput
                    label="Password"
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="step1"
                  variants={stepVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="space-y-6"
                >
                  <div className="mx-auto max-w-md text-center">
                    <h2 className="text-xl font-semibold text-slate-100">
                      Verify your gesture
                    </h2>
                    <p className="mt-2 text-sm leading-7 text-slate-400">
                      Use the gesture method you enrolled with and capture it steadily.
                    </p>
                  </div>

                  {gestureMode === 'hand' ? (
                    <div className="flex flex-col items-center">
                      <Suspense fallback={<GestureDetectorFallback />}>
                        <HandGestureDetector onDetect={setHandGesture} capturePreset="verify" />
                      </Suspense>
                      <motion.button
                        type="button"
                        onMouseEnter={playHover}
                        onClick={() => setGestureMode('mouse')}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        className="mt-4 rounded-full border border-slate-700/60 px-4 py-2 text-sm text-emerald-200 transition-colors hover:border-slate-600/60 hover:bg-slate-800/40 hover:text-white"
                      >
                        Use mouse gesture instead
                      </motion.button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <MouseGestureCanvas onComplete={setMouseGesture} qualityPreset="verify" />
                      <motion.button
                        type="button"
                        onMouseEnter={playHover}
                        onClick={() => setGestureMode('hand')}
                        whileHover={{ scale: 1.03 }}
                        whileTap={{ scale: 0.97 }}
                        className="mt-4 rounded-full border border-slate-700/60 px-4 py-2 text-sm text-emerald-200 transition-colors hover:border-slate-600/60 hover:bg-slate-800/40 hover:text-white"
                      >
                        Use hand gesture instead
                      </motion.button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  className="relative mt-6 flex items-center gap-3 overflow-hidden rounded-2xl border border-red-400/20 bg-red-500/8 p-4 text-sm text-red-200"
                >
                  <motion.div
                    className="absolute left-0 right-0 top-0 h-[1px] bg-red-400/60"
                    animate={{ top: ['0%', '100%'] }}
                    transition={{ duration: 1, ease: 'linear' }}
                  />
                  <div className="h-2 w-2 shrink-0 rounded-full bg-red-400" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {success && activeStep === 1 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm text-emerald-100"
                >
                  <div className="h-2 w-2 shrink-0 rounded-full bg-emerald-300" />
                  {success}
                </motion.div>
              )}
            </AnimatePresence>

            <div className="mt-10 flex items-center justify-between">
              <motion.button
                type="button"
                onMouseEnter={playHover}
                onClick={prevStep}
                whileHover={{ scale: 1.03, x: -2 }}
                whileTap={{ scale: 0.97 }}
                className={`rounded-full px-5 py-3 text-sm transition-all duration-300 ${
                  activeStep === 0
                    ? 'pointer-events-none opacity-0'
                    : 'button-secondary font-medium'
                }`}
              >
                Back
              </motion.button>

              <motion.button
                type="button"
                onMouseEnter={playHover}
                whileHover={{ scale: 1.03, x: 2 }}
                whileTap={{ scale: 0.95 }}
                onClick={activeStep === steps.length - 1 ? handleSubmit : handleNext}
                disabled={isLoading}
                className="button-primary ml-auto rounded-full px-6 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {activeStep === steps.length - 1 ? 'Sign in' : 'Continue'}
              </motion.button>
            </div>
          </div>

          <div className="border-t border-white/5 bg-slate-950/25 px-6 pb-6 pt-4 text-center text-sm text-slate-400">
            Don&apos;t have an account?{' '}
            <RouterLink
              to="/signup"
              onMouseEnter={playHover}
              className="font-medium text-emerald-200 transition-all hover:text-white hover:underline"
            >
              Create one
            </RouterLink>
          </div>
        </motion.div>
      )}
    </div>
  );
}
