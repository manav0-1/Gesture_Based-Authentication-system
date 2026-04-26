import React from 'react';

export default function CyberLoader({ text = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center">
      <div className="h-9 w-9 animate-spin rounded-full border-4 border-slate-700 border-t-emerald-400" />
      <p className="text-sm font-medium text-slate-300">{text}</p>
    </div>
  );
}
