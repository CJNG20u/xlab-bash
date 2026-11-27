import { KeyRound, LogOut, MonitorSmartphone, Play, RefreshCw, Square } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import type { ShellSessionInfo } from '../types/index.ts';

interface AccountSecurityPanelProps {
  envAuthActive: boolean;
  openSessionKeys: string[];
  onResumeShell: (info: ShellSessionInfo) => void;
  onSignedOutEverywhere: () => void;
  onToast: (message: string) => void;
}

function timeAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

export const AccountSecurityPanel: React.FC<AccountSecurityPanelProps> = ({
  envAuthActive,
  openSessionKeys,
  onResumeShell,
  onSignedOutEverywhere,
  onToast,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [shells, setShells] = useState<ShellSessionInfo[]>([]);
  const [lingerMinutes, setLingerMinutes] = useState(15);
  const [shellsLoading, setShellsLoading] = useState(true);
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  const loadShells = useCallback(async () => {
    setShellsLoading(true);
    try {
      const res = await api.getShellSessions();
      setShells(res.sessions);
      setLingerMinutes(res.lingerMinutes);
    } catch {
      // keep previous list
    } finally {
      setShellsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShells();
  }, [loadShells]);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    if (newPassword.length < 10) {
      setPwError('New password must be at least 10 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.');
      return;
    }
    setPwBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onToast('Password changed · other devices signed out');
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setPwBusy(false);
    }
  };

  const endShell = async (key: string) => {
    try {
      await api.killShellSession(key);
      setShells((prev) => prev.filter((s) => s.key !== key));
      onToast('Shell ended');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Could not end shell.');
    }
  };

  const signOutEverywhere = async () => {
    try {
      const res = await api.logoutAll();
      onToast(
        res.endedShells > 0
          ? `Signed out everywhere · ${res.endedShells} shell(s) ended`
          : 'Signed out everywhere'
      );
    } catch {
      // even if the request failed, drop local state
    }
    onSignedOutEverywhere();
  };

  const inputClass =
    'w-full h-11 rounded-xl border border-zinc-800 bg-black px-3 text-sm text-zinc-100 outline-none focus:border-zinc-600';

  return (
    <div className="space-y-6">
      {/* Running shells */}
      <section className="pb-6 border-b border-zinc-800/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-zinc-100 inline-flex items-center gap-2">
              <MonitorSmartphone className="w-4 h-4 text-accent" /> Running shells
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {lingerMinutes > 0
                ? `Shells keep running for ${lingerMinutes} min after your phone disconnects, then end.`
                : 'Shells end as soon as the browser disconnects (SESSION_LINGER_MINUTES=0).'}
            </div>
          </div>
          <button
            type="button"
            onClick={loadShells}
            className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
            aria-label="Refresh running shells"
          >
            <RefreshCw className={`w-4 h-4 ${shellsLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {shells.length === 0 ? (
          <p className="mt-3 text-xs text-zinc-500">{shellsLoading ? 'Loading…' : 'No shells running.'}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {shells.map((s) => {
              const here = openSessionKeys.includes(s.key);
              return (
                <li
                  key={s.key}
                  className="rounded-xl border border-zinc-800 bg-black px-3 py-2.5 flex items-center gap-3"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${s.attached ? 'bg-emerald-400' : 'bg-amber-400'}`}
                    title={s.attached ? 'Connected' : 'Waiting for you'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-100 truncate">{s.label}</div>
                    <div className="text-[11px] font-mono-term text-zinc-500 truncate">
                      {s.target} ·{' '}
                      {here
                        ? 'open here'
                        : s.attached
                        ? 'open on another device'
                        : `detached ${timeAgo(s.detachedAt || s.lastActivity)}`}
                    </div>
                  </div>
                  {!here && (
                    <button
                      type="button"
                      onClick={() => onResumeShell(s)}
                      className="h-8 px-2.5 rounded-lg btn-accent-soft border text-xs font-medium inline-flex items-center gap-1"
                    >
                      <Play className="w-3 h-3 fill-current" /> Open
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => endShell(s.key)}
                    className="h-8 px-2.5 rounded-lg border border-zinc-800 text-xs text-red-400 inline-flex items-center gap-1 hover:bg-red-950/30"
                  >
                    <Square className="w-3 h-3" /> End
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Change password */}
      <section className="pb-6 border-b border-zinc-800/80">
        <div className="text-sm font-medium text-zinc-100 inline-flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-accent" /> Change password
        </div>
        {envAuthActive ? (
          <p className="text-xs text-zinc-500 mt-1">
            Your login comes from <code className="font-mono-term">APP_PASSWORD</code> in{' '}
            <code className="font-mono-term">.env</code>. Change it there and restart the container.
          </p>
        ) : (
          <form onSubmit={changePassword} className="mt-3 space-y-2.5 max-w-sm">
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
              required
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password (10+ characters)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              minLength={10}
              required
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Repeat new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              minLength={10}
              required
            />
            {pwError && <p className="text-xs text-red-400">{pwError}</p>}
            <p className="text-xs text-zinc-500">
              Signs out every other device. Your shells keep running and reconnect here automatically.
            </p>
            <button
              type="submit"
              disabled={pwBusy}
              className="h-10 px-4 rounded-xl btn-accent-soft border text-xs font-medium disabled:opacity-50"
            >
              {pwBusy ? 'Saving…' : 'Change password'}
            </button>
          </form>
        )}
      </section>

      {/* Sign out everywhere */}
      <section>
        <div className="text-sm font-medium text-zinc-100 inline-flex items-center gap-2">
          <LogOut className="w-4 h-4 text-red-400" /> Sign out everywhere
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          Revokes every login on every device (including this one) and ends all running shells. Use it if a
          device was lost.
        </p>
        {confirmSignOutAll ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={signOutEverywhere}
              className="h-10 px-4 rounded-xl bg-red-600 text-white text-xs font-medium hover:bg-red-500"
            >
              Yes, sign out everywhere
            </button>
            <button
              type="button"
              onClick={() => setConfirmSignOutAll(false)}
              className="h-10 px-4 rounded-xl border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmSignOutAll(true)}
            className="mt-3 h-10 px-4 rounded-xl border border-zinc-800 bg-black text-xs font-medium text-red-400 hover:bg-red-950/30 hover:border-red-900/60"
          >
            Sign out everywhere
          </button>
        )}
      </section>
    </div>
  );
};
