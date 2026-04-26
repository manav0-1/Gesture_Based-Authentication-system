import React from 'react';
import { motion } from 'framer-motion';
import BrandMark from './BrandMark';

function Stepper({ steps, activeStep }) {
  return (
    <div className="auth-stepper">
      {steps.map((step, index) => {
        const state =
          index === activeStep ? 'active' : index < activeStep ? 'done' : '';

        return (
          <div key={step} className={`auth-step ${state}`}>
            <span className="auth-step-dot">{index < activeStep ? 'Done' : index + 1}</span>
            <span>{step}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function AuthShell({
  eyebrow,
  title,
  description,
  steps,
  activeStep,
  sideKicker,
  sideTitle,
  sideCopy,
  sidePoints = [],
  sideMetrics = [],
  footer,
  children,
}) {
  return (
    <div className="auth-page">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45 }}
        className="auth-card"
      >
        <aside className="relative z-10 border-b border-slate-800/70 bg-slate-950/45 p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <BrandMark caption="Secure motion identity" />

          <div className="mt-8">
            <span className="eyebrow">{sideKicker}</span>
            <h2 className="mt-5 text-3xl font-semibold text-slate-50">
              {sideTitle}
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-400">{sideCopy}</p>
          </div>

          <div className="mt-8 space-y-3">
            {sidePoints.map((point) => (
              <div
                key={point}
                className="rounded-[22px] border border-slate-800/80 bg-slate-950/55 px-4 py-3 text-sm leading-6 text-slate-300"
              >
                {point}
              </div>
            ))}
          </div>

          {sideMetrics.length > 0 && (
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              {sideMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="surface rounded-[22px] px-4 py-4"
                >
                  <p className="text-2xl font-semibold text-slate-50">
                    {metric.value}
                  </p>
                  <p className="mt-2 text-sm text-slate-400">{metric.label}</p>
                </div>
              ))}
            </div>
          )}
        </aside>

        <section className="relative z-10 flex min-w-0 flex-col bg-slate-950/25">
          <div className="auth-header border-b border-slate-800/70 px-6 py-6 sm:px-8">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-200">
                {eyebrow}
              </p>
              <h1 className="mt-3 text-3xl font-semibold text-slate-50">{title}</h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-400">
                {description}
              </p>
            </div>
            <div className="mt-6">
              <Stepper steps={steps} activeStep={activeStep} />
            </div>
          </div>

          <div className="flex-1 px-6 py-6 sm:px-8 sm:py-8">{children}</div>

          {footer && (
            <div className="border-t border-slate-800/70 px-6 py-5 text-sm text-slate-400 sm:px-8">
              {footer}
            </div>
          )}
        </section>
      </motion.div>
    </div>
  );
}
