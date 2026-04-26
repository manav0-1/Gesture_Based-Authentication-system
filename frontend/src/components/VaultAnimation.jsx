import React, { useEffect } from 'react';

export default function VaultAnimation({ isSuccess, onAnimationComplete }) {
  useEffect(() => {
    if (!isSuccess) return undefined;

    const timer = window.setTimeout(() => {
      onAnimationComplete?.();
    }, 900);

    return () => window.clearTimeout(timer);
  }, [isSuccess, onAnimationComplete]);

  if (!isSuccess) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-6">
      <div className="rounded-2xl border border-emerald-400/30 bg-slate-900 px-8 py-6 text-center shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-lg font-bold text-emerald-300">
          Done
        </div>
        <h2 className="mt-4 text-xl font-semibold text-white">Success</h2>
        <p className="mt-2 text-sm text-slate-400">Taking you to the next page...</p>
      </div>
    </div>
  );
}
