import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useAnimation } from 'framer-motion';
import useAuthStore from '../store/useAuthStore';
import MouseGestureCanvas from './MouseGestureCanvas';
import VaultAnimation from './VaultAnimation';
import CyberLoader from './CyberLoader';
import useSound from '../hooks/useSound';

const steps = ['Details', 'Verification', 'Mouse Gesture', 'Hand Gesture'];
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

function AnimatedInput({ label, type = 'text', name, value, onChange, delay = 0 }) {
  const [focused, setFocused] = useState(false);
  const hasValue = Boolean(value?.length);

  return (
    <motion.div
      className="relative"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay }}
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
    <div className="auth-stepper px-6">
      {steps.map((label, index) => (
        <motion.div
          key={label}
          className={`auth-step ${index === activeStep ? 'active' : ''} ${
            index < activeStep ? 'done' : ''
          }`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.06 }}
        >
          <span className="auth-step-dot">{index < activeStep ? 'Done' : index + 1}</span>
          <span>{label}</span>
        </motion.div>
      ))}
    </div>
  );
}

function OTPInput({ value, onChange, disabled = false }) {
  const inputRefs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] || '');

  const focusInput = (index) => {
    inputRefs.current[index]?.focus();
  };

  const handleChange = (index, event) => {
    const nextDigit = event.target.value.replace(/\D/g, '').slice(-1);
    const nextDigits = [...digits];
    nextDigits[index] = nextDigit;
    onChange(nextDigits.join(''));

    if (nextDigit && index < digits.length - 1) {
      focusInput(index + 1);
    }
  };

  const handleKeyDown = (index, event) => {
    if (event.key === 'Backspace') {
      event.preventDefault();

      if (digits[index]) {
        const nextDigits = [...digits];
        nextDigits[index] = '';
        onChange(nextDigits.join(''));
        return;
      }

      if (index > 0) {
        const nextDigits = [...digits];
        nextDigits[index - 1] = '';
        onChange(nextDigits.join(''));
        focusInput(index - 1);
      }
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      focusInput(index - 1);
    }

    if (event.key === 'ArrowRight' && index < digits.length - 1) {
      event.preventDefault();
      focusInput(index + 1);
    }
  };

  const handlePaste = (event) => {
    const pastedDigits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pastedDigits) return;

    event.preventDefault();
    onChange(pastedDigits);
    focusInput(Math.min(pastedDigits.length, digits.length - 1));
  };

  return (
    <div className="flex justify-center gap-2.5" onPaste={handlePaste}>
      <span className="sr-only">6-digit verification code</span>
      {digits.map((digit, index) => (
        <motion.input
          key={index}
          ref={(element) => {
            inputRefs.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(event) => handleChange(index, event)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onFocus={(event) => event.target.select()}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className={`h-14 w-11 rounded-2xl border text-center text-2xl font-bold outline-none transition-all duration-300 ${
            digit
              ? 'border-emerald-300/35 bg-emerald-400/10 text-emerald-100'
              : 'border-slate-700/60 bg-slate-950/60 text-slate-300'
          } focus:border-emerald-300/40 focus:bg-slate-950/90 focus:text-emerald-100`}
        />
      ))}
    </div>
  );
}

export default function SignUp() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [emailVerified, setEmailVerified] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [showVault, setShowVault] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const { playHover, playSuccess, playError } = useSound();
  const controls = useAnimation();

  const {
    formData,
    mouseGesture,
    handGesture,
    error,
    success,
    isLoading,
    setFormField,
    setMouseGesture,
    setHandGesture,
    setError,
    setSuccess,
    clearMessages,
    register,
    resetForm,
    requestOTP,
    verifyOTP,
  } = useAuthStore();

  useEffect(() => {
    resetForm();
    clearMessages();

    return () => {
      clearMessages();
    };
  }, [clearMessages, resetForm]);

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
    if (resendCooldown <= 0) return undefined;

    const timer = window.setInterval(() => {
      setResendCooldown((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const handleInputChange = (event) => {
    if (event.target.name === 'email') {
      setOtpSent(false);
      setOtpCode('');
      setEmailVerified(false);
      setPreviewUrl('');
      setResendCooldown(0);
    }

    setFormField(event.target.name, event.target.value);
  };

  const handleNext = () => {
    clearMessages();

    if (activeStep === 0) {
      if (!formData.username || !formData.email || !formData.password || !formData.confirmPassword) {
        setError('Complete all required fields.');
        return;
      }
      if (!formData.email.includes('@') || !formData.email.includes('.')) {
        setError('Invalid email address.');
        return;
      }
      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
      if (formData.password.length < 6) {
        setError('Password must be at least 6 characters.');
        return;
      }
    }

    if (activeStep === 1 && !emailVerified) {
      setError('Verify your email before continuing.');
      return;
    }

    setActiveStep((current) => Math.min(current + 1, steps.length - 1));
  };

  const handleBack = () => {
    clearMessages();
    setActiveStep((current) => Math.max(current - 1, 0));
  };

  const handleSendOTP = async () => {
    clearMessages();
    const result = await requestOTP(formData.email);

    if (result?.ok) {
      setOtpSent(true);
      setPreviewUrl(result.debugPreviewUrl || '');
      setResendCooldown(Math.max(0, Number(result.retryAfter) || 60));
      return;
    }

    if (result?.retryAfter) {
      setResendCooldown(Math.max(0, Number(result.retryAfter) || 60));
    }
  };

  const handleVerifyOTP = async () => {
    if (!otpCode || otpCode.length !== 6) {
      setError('Enter the 6-digit verification code.');
      return;
    }

    const ok = await verifyOTP(formData.email, otpCode);
    if (ok) {
      setEmailVerified(true);
      setSuccess('Email verified successfully.');
      playSuccess();
    }
  };

  const handleSubmit = async () => {
    const ok = await register();
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
              Account setup
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 }}
              className="mt-3 text-3xl font-semibold text-slate-50"
            >
              Create account
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.22 }}
              className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-400"
            >
              Set up your account and save both gesture methods for future sign-in.
            </motion.p>
          </div>

          <StepIndicator activeStep={activeStep} />

          <div className="relative min-h-[380px] overflow-hidden p-8">
            <AnimatePresence mode="wait">
              {isLoading ? (
                <motion.div
                  key="loader"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm"
                >
                  <CyberLoader text="Processing..." />
                </motion.div>
              ) : activeStep === 0 ? (
                <motion.div
                  key="step0"
                  variants={stepVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="mx-auto mt-2 grid max-w-lg grid-cols-1 gap-4 md:grid-cols-2"
                >
                  <div className="md:col-span-2">
                    <AnimatedInput
                      label="Username"
                      name="username"
                      value={formData.username}
                      onChange={handleInputChange}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <AnimatedInput
                      label="Email"
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      delay={0.05}
                    />
                  </div>
                  <AnimatedInput
                    label="Password"
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    delay={0.1}
                  />
                  <AnimatedInput
                    label="Confirm password"
                    type="password"
                    name="confirmPassword"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    delay={0.15}
                  />
                </motion.div>
              ) : activeStep === 1 ? (
                <motion.div
                  key="step1"
                  variants={stepVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="mx-auto max-w-sm space-y-6"
                >
                  <div className="text-center">
                    <h3 className="text-xl font-semibold text-slate-100">
                      Verify your email
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-slate-400">
                      We&apos;ll send a 6-digit code to{' '}
                      <span className="font-medium text-emerald-200">{formData.email}</span>
                    </p>
                  </div>

                  {!otpSent ? (
                    <motion.button
                      type="button"
                      onMouseEnter={playHover}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={handleSendOTP}
                      disabled={isLoading}
                      className="button-primary w-full rounded-full px-5 py-3 text-sm font-semibold"
                    >
                      Send verification code
                    </motion.button>
                  ) : !emailVerified ? (
                    <div className="space-y-6">
                      <div>
                        <label className="mb-3 block text-center text-sm text-slate-300">
                          Verification code
                        </label>
                        <OTPInput value={otpCode} onChange={setOtpCode} disabled={isLoading} />
                      </div>

                      {previewUrl && (
                        <div className="rounded-2xl border border-slate-700/50 bg-slate-950/55 p-3 text-xs">
                          <p className="mb-1 text-slate-400">Local dev preview:</p>
                          <a
                            href={previewUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-emerald-200 underline hover:text-white"
                          >
                            {previewUrl}
                          </a>
                        </div>
                      )}

                      <motion.button
                        type="button"
                        onMouseEnter={playHover}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        onClick={handleVerifyOTP}
                        disabled={isLoading}
                        className="button-primary w-full rounded-full px-5 py-3 text-sm font-semibold"
                      >
                        Verify code
                      </motion.button>

                      <button
                        type="button"
                        onMouseEnter={playHover}
                        onClick={handleSendOTP}
                        disabled={isLoading || resendCooldown > 0}
                        className="w-full text-sm text-slate-400 transition-colors hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                      </button>
                    </div>
                  ) : (
                    <motion.div
                      initial={{ scale: 0.92, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                      className="rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-6 text-center"
                    >
                      <div className="text-3xl text-emerald-200">Done</div>
                      <p className="mt-3 font-semibold text-emerald-100">Email verified</p>
                      <p className="mt-2 text-sm text-slate-300">
                        You can continue to gesture setup.
                      </p>
                    </motion.div>
                  )}
                </motion.div>
              ) : activeStep === 2 ? (
                <motion.div
                  key="step2"
                  variants={stepVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <div className="mx-auto mb-5 max-w-md text-center">
                    <h3 className="text-xl font-semibold text-slate-100">
                      Save your mouse gesture
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-slate-400">
                      Draw a larger, deliberate gesture you can repeat consistently.
                    </p>
                  </div>
                  <MouseGestureCanvas onComplete={setMouseGesture} qualityPreset="enroll" />
                  <AnimatePresence>
                    {mouseGesture && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm text-emerald-100"
                      >
                        <span>Done</span>
                        Mouse gesture saved
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ) : (
                <motion.div
                  key="step3"
                  variants={stepVariants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  transition={{ duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] }}
                >
                  <div className="mx-auto mb-5 max-w-md text-center">
                    <h3 className="text-xl font-semibold text-slate-100">
                      Save your hand gesture
                    </h3>
                    <p className="mt-2 text-sm leading-7 text-slate-400">
                      Hold the pose steady while we capture enough clean hand samples.
                    </p>
                  </div>
                  <Suspense fallback={<GestureDetectorFallback />}>
                    <HandGestureDetector onDetect={setHandGesture} capturePreset="enroll" />
                  </Suspense>
                  <AnimatePresence>
                    {handGesture && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        className="mt-6 flex items-center justify-center gap-2 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-4 text-sm text-emerald-100"
                      >
                        <span>Done</span>
                        Hand gesture saved
                      </motion.div>
                    )}
                  </AnimatePresence>
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
              {success && (
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
                onClick={handleBack}
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
                {activeStep === steps.length - 1 ? 'Create account' : 'Continue'}
              </motion.button>
            </div>
          </div>

          <div className="border-t border-white/5 bg-slate-950/25 px-6 pb-6 pt-4 text-center text-sm text-slate-400">
            Already have an account?{' '}
            <RouterLink
              to="/signin"
              onMouseEnter={playHover}
              className="font-medium text-emerald-200 transition-all hover:text-white hover:underline"
            >
              Sign in
            </RouterLink>
          </div>
        </motion.div>
      )}
    </div>
  );
}
