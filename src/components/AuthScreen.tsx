import { AlertCircle, Lock, ShieldCheck, Terminal } from 'lucide-react';
import React, { useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import type { AuthStatus } from '../types/index.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface AuthScreenProps {
  authStatus: AuthStatus;
  onAuthenticated: (status: AuthStatus) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ authStatus, onAuthenticated }) => {
  const isSetup = authStatus.needsSetup;
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isSetup && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const next = isSetup
        ? await api.setupAdmin(username, password)
        : await api.login(username, password);
      onAuthenticated(next);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Unable to reach xlab-bash server.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-dvh w-full bg-black text-zinc-100 flex flex-col justify-between p-5 sm:p-8 overflow-y-auto">
      <div className="flex items-center justify-between max-w-md w-full mx-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center">
            <Terminal className="w-4 h-4 text-accent" />
          </div>
          <span className="text-base font-mono-term font-semibold tracking-tight text-zinc-100">
            xlab-bash
          </span>
        </div>
        <PWAInstallButton compact />
      </div>

      <main className="w-full max-w-md mx-auto my-8">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs text-zinc-400 mb-3">
            {isSetup ? (
              <>
                <ShieldCheck className="w-4 h-4 text-accent" />
                <span>First-run admin setup</span>
              </>
            ) : (
              <>
                <Lock className="w-4 h-4 text-accent" />
                <span>Self-hosted SSH terminal</span>
              </>
            )}
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 text-balance">
            {isSetup ? 'Claim Admin Access' : 'Sign in to xlab-bash'}
          </h1>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {isSetup
              ? 'No APP_PASSWORD environment variable is set yet. Create your local admin account to unlock the SSH vault, or set APP_USERNAME and APP_PASSWORD in your .env file.'
              : 'Authenticate to open SSH sessions and access your encrypted host vault.'}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="auth-username"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Username
              </label>
              <input
                id="auth-username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm text-zinc-100 font-mono-term placeholder:text-zinc-600 focus-accent transition"
                placeholder="admin"
              />
            </div>

            <div>
              <label
                htmlFor="auth-password"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                required
                minLength={isSetup ? 10 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus-accent transition"
                placeholder={isSetup ? 'Minimum 10 characters' : 'Enter password'}
              />
            </div>

            {isSetup && (
              <div>
                <label
                  htmlFor="auth-confirm"
                  className="block text-xs font-medium text-zinc-300 mb-1.5"
                >
                  Confirm password
                </label>
                <input
                  id="auth-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus-accent transition"
                  placeholder="Re-enter password"
                />
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-950/30 px-3.5 py-2.5 text-xs text-red-300"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-12 rounded-xl btn-accent font-semibold text-sm active:scale-[0.99] disabled:opacity-50 transition"
            >
              {submitting
                ? isSetup
                  ? 'Creating account...'
                  : 'Signing in...'
                : isSetup
                ? 'Set Admin Password'
                : 'Sign In'}
            </button>
          </form>
        </div>
      </main>

      <footer className="max-w-md w-full mx-auto text-center text-xs text-zinc-500">
        Direct ssh2 PTY over WebSocket · AES-256-GCM host vault
      </footer>
    </div>
  );
};
