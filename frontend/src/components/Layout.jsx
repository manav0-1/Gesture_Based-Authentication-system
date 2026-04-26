import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useAuthStore from '../store/useAuthStore';
import BrandMark from './BrandMark';

function NavLink({ to, children, active }) {
  return (
    <Link
      to={to}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
        active
          ? 'bg-slate-800 text-white'
          : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
      }`}
    >
      {children}
    </Link>
  );
}

function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const logout = useAuthStore((state) => state.logout);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header className="surface-strong sticky top-0 z-50">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <BrandMark compact={false} caption="Secure gesture login" />

        <nav className="flex flex-wrap items-center gap-2">
          <NavLink to="/" active={location.pathname === '/'}>
            Home
          </NavLink>

          {isAuthenticated ? (
            <>
              <NavLink to="/dashboard" active={location.pathname === '/dashboard'}>
                Dashboard
              </NavLink>
              <button
                type="button"
                onClick={handleLogout}
                className="button-secondary rounded-lg px-3 py-2 text-sm font-medium"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <NavLink to="/signin" active={location.pathname === '/signin'}>
                Sign in
              </NavLink>
              <Link
                to="/signup"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
              >
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="glass-card mt-auto rounded-none border-b-0 border-x-0">
      <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-slate-500 sm:px-6">
        GestureAuth keeps account access and protected files in one simple flow.
      </div>
    </footer>
  );
}

export default function Layout({ children }) {
  return (
    <div className="app-shell flex min-h-screen flex-col bg-slate-950">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
