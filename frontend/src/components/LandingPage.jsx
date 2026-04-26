import React from 'react';
import { Link } from 'react-router-dom';
import BrandMark from './BrandMark';

const steps = [
  {
    title: 'Create your account',
    copy: 'Enter your username, email, and password.',
  },
  {
    title: 'Verify your email',
    copy: 'Use the OTP sent to your email address.',
  },
  {
    title: 'Save gestures',
    copy: 'Record one mouse gesture and one hand gesture.',
  },
  {
    title: 'Access your files',
    copy: 'Sign in with your password and gesture to manage files.',
  },
];

export default function LandingPage() {
  return (
    <div className="app-shell text-slate-100">
      <header className="surface-strong sticky top-0 z-50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <BrandMark caption="Secure gesture login" />
          <nav className="flex items-center gap-2">
            <Link
              to="/signin"
              className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
            >
              Create account
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="grid gap-8 lg:grid-cols-[1fr_0.85fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-emerald-300">
              Gesture authentication system
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight text-white sm:text-5xl">
              Simple account access with email OTP and gestures.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300">
              Create an account, verify your email, save your gestures, and use
              them later to sign in and protect your files.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/signup"
                className="button-primary rounded-lg px-5 py-3 text-sm font-semibold"
              >
                Create account
              </Link>
              <Link
                to="/signin"
                className="button-secondary rounded-lg px-5 py-3 text-sm font-semibold"
              >
                Sign in
              </Link>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-6 lg:p-8">
            <h2 className="text-xl font-semibold text-white">How it works</h2>
            <div className="mt-6 space-y-4">
              {steps.map((step, index) => (
                <div
                  key={step.title}
                  className="flex gap-4 rounded-xl surface p-4"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-sm font-semibold text-emerald-300">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold text-slate-100">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{step.copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
