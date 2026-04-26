import React from 'react';
import { Link } from 'react-router-dom';

export default function BrandMark({
  to = '/',
  caption = 'Secure gesture login',
  compact = false,
  className = '',
}) {
  return (
    <Link to={to} className={`inline-flex items-center gap-3 ${className}`}>
      <span
        className={`flex items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-500/10 font-bold text-emerald-300 ${
          compact ? 'h-10 w-10 text-sm' : 'h-11 w-11 text-base'
        }`}
      >
        GA
      </span>
      <span className="flex flex-col">
        <span className="text-base font-semibold text-white">GestureAuth</span>
        {!compact && <span className="text-xs text-slate-400">{caption}</span>}
      </span>
    </Link>
  );
}
