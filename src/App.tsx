import {
  Keyboard,
  KeyboardOff,
  Minus,
  Plus,
  Search,
  Server,
  Settings,
  Smartphone,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthScreen } from './components/AuthScreen.tsx';
import { DevKeyboard } from './components/DevKeyboard.tsx';
import { FilesView } from './components/FilesView.tsx';
import { HostKeyModal } from './components/HostKeyModal.tsx';
import { HostsView } from './components/HostsView.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { QuickBar } from './components/QuickBar.tsx';
import { SettingsModal, type SettingsTab } from './components/SettingsModal.tsx';
import { TerminalPane, type TerminalPaneHandle } from './components/TerminalPane.tsx';
import { api } from './lib/api.ts';
import { applyAppAccentTheme } from './lib/appThemes.ts';
import { DEFAULT_PC_6ROW_LAYOUT, DEFAULT_SETTINGS } from './lib/defaultLayout.ts';
import type {
  AppSettings,
  AuthStatus,
  ConnectionState,
  HostKeyPrompt,
  HostSummary,
  KeyboardLayoutRecord,
  KeyboardMode,
  QuickConnectTarget,
  ShellSessionInfo,
  SnippetItem,
  TerminalSession,
} from './types/index.ts';

// Open tabs are remembered (without any credentials) so a page reload or an
// app restart re-attaches to shells that are still running on the server.
const TABS_STORAGE_KEY = 'xlab-bash:tabs';

interface StoredTab {
  id: string;
  title: string;
  subtitle: string;
  hostId?: string;
  sessionKey: string;
}

function loadStoredTabs(): TerminalSession[] {
  try {
    const raw = window.localStorage.getItem(TABS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredTab[]) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t) => t && typeof t.id === 'string' && typeof t.sessionKey === 'string')
      .map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: t.subtitle,
        hostId: t.hostId,
        sessionKey: t.sessionKey,
        status: 'connecting' as const,
        reconnectAttempt: 0,
        hostKeyPrompt: null,
      }));
  } catch {
    return [];
  }
}

function saveStoredTabs(sessions: TerminalSession[]): void {
  try {
    const tabs: StoredTab[] = sessions
      .filter((s) => s.sessionKey)
      .map((s) => ({
        id: s.id,
        title: s.title,
        subtitle: s.subtitle,
        hostId: s.hostId,
        sessionKey: s.sessionKey!,
      }));
    window.localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
  } catch {
    // storage unavailable (private mode): tabs just won't survive a reload
  }
}

function clearStoredTabs(): void {
  try {
    window.localStorage.removeItem(TABS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export default function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    authenticated: false,
    needsSetup: false,
    encryptionKeyConfigured: false,
    envAuthActive: false,
  });

  const [hosts, setHosts] = useState<HostSummary[]>([]);
  const [snippets, setSnippets] = useState<SnippetItem[]>([]);
  const [layouts, setLayouts] = useState<KeyboardLayoutRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [tabsRestored, setTabsRestored] = useState(false);
  // Message for the sign-in screen when the login ran out while the app was open
  const [signedOutNotice, setSignedOutNotice] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'hosts' | string>('hosts');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('display');
  const [toast, setToast] = useState<string | null>(null);
  const [filesHost, setFilesHost] = useState<HostSummary | null>(null);

  const toastTimerRef = useRef<number | null>(null);
  const paneRefs = useRef<Record<string, TerminalPaneHandle | null>>({});

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 1800);
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    try {
      const [hRes, sRes, lRes, setRes] = await Promise.all([
        api.getHosts(),
        api.getSnippets(),
        api.getLayouts(),
        api.getSettings(),
      ]);
      setHosts(hRes.hosts);
      setSnippets(sRes.snippets);
      setLayouts(lRes.layouts);
      setSettings(setRes.settings);
    } catch {
      // handled gracefully
    }
  }, []);

  useEffect(() => {
    applyAppAccentTheme(settings.accentTheme);
  }, [settings.accentTheme]);

  useEffect(() => {
    let mounted = true;
    api
      .getAuthStatus()
      .then((status) => {
        if (!mounted) return;
        setAuthStatus(status);
        if (status.authenticated) {
          loadWorkspaceData();
          const restored = loadStoredTabs();
          if (restored.length > 0) {
            setSessions(restored);
            setActiveView(restored[restored.length - 1].id);
          }
        }
        setTabsRestored(true);
      })
      .finally(() => {
        if (mounted) setAuthLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [loadWorkspaceData]);

  // Keep the remembered tab list in sync (only tabs bound to a running shell)
  useEffect(() => {
    if (tabsRestored && authStatus.authenticated) saveStoredTabs(sessions);
  }, [sessions, tabsRestored, authStatus.authenticated]);

  // The server refused this browser's login (expired / revoked): go to the sign-in
  // screen right away. Terminals unmount without ending their shells, which keep
  // running on the server and re-attach after you sign in again.
  useEffect(() => {
    api.onUnauthorized((message) => {
      setSignedOutNotice(message);
      setSettingsOpen(false);
      setAuthStatus((prev) => ({ ...prev, authenticated: false, username: undefined }));
    });
  }, []);

  // Coming back to the app after a while: check the login is still good
  useEffect(() => {
    if (!authStatus.authenticated) return;
    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      api
        .getAuthStatus()
        .then((status) => {
          if (!status.authenticated && !api.isSignedOut()) {
            setSignedOutNotice(status.signedOutReason || 'Sign in again to continue.');
            setSettingsOpen(false);
            setAuthStatus(status);
          }
        })
        .catch(() => {
          // offline: the terminals show their own reconnect state
        });
    };
    document.addEventListener('visibilitychange', recheck);
    return () => document.removeEventListener('visibilitychange', recheck);
  }, [authStatus.authenticated]);

  const handleAuthenticated = (status: AuthStatus) => {
    api.markSignedIn();
    setSignedOutNotice(null);
    setAuthStatus(status);
    loadWorkspaceData();
    const restored = loadStoredTabs();
    if (restored.length > 0) {
      setSessions(restored);
      setActiveView(restored[restored.length - 1].id);
    }
    setTabsRestored(true);
  };

  /** Called after "sign out everywhere": the server already ended every shell. */
  const handleSignedOutEverywhere = async () => {
    clearStoredTabs();
    setSessions([]);
    setActiveView('hosts');
    setSettingsOpen(false);
    const status = await api.getAuthStatus();
    setAuthStatus(status);
  };

  const handleSessionKey = useCallback((sessionId: string, sessionKey: string | undefined) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId && s.sessionKey !== sessionKey ? { ...s, sessionKey } : s))
    );
  }, []);

  /** Open a tab for a shell that is running on the server (e.g. started on another device). */
  const resumeShell = (info: ShellSessionInfo) => {
    const existing = sessions.find((s) => s.sessionKey === info.key);
    if (existing) {
      setActiveView(existing.id);
      setSettingsOpen(false);
      return;
    }
    const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setSessions((prev) => [
      ...prev,
      {
        id,
        title: info.label,
        subtitle: info.target,
        hostId: info.hostId,
        sessionKey: info.key,
        status: 'connecting',
        reconnectAttempt: 0,
        hostKeyPrompt: null,
      },
    ]);
    setActiveView(id);
    setSettingsOpen(false);
  };

  const handleLogout = async () => {
    await api.logout();
    clearStoredTabs();
    setSessions([]);
    setActiveView('hosts');
    setSettingsOpen(false);
    const status = await api.getAuthStatus();
    setAuthStatus(status);
  };

  const updateSettings = useCallback(async (partial: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    try {
      const res = await api.saveSettings(partial);
      setSettings(res.settings);
    } catch {
      // keep optimistic UI update
    }
  }, []);

  const openSavedHost = (host: HostSummary) => {
    const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newSession: TerminalSession = {
      id,
      title: host.name,
      subtitle: `${host.username}@${host.host}:${host.port}`,
      hostId: host.id,
      status: 'connecting',
      reconnectAttempt: 0,
      hostKeyPrompt: null,
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveView(id);
  };

  const openQuickConnect = (target: QuickConnectTarget) => {
    const id = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newSession: TerminalSession = {
      id,
      title: target.name || target.host,
      subtitle: `${target.username}@${target.host}:${target.port}`,
      quickTarget: target,
      status: 'connecting',
      reconnectAttempt: 0,
      hostKeyPrompt: null,
    };
    setSessions((prev) => [...prev, newSession]);
    setActiveView(id);
  };

  const closeSession = (sessionId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    delete paneRefs.current[sessionId];
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId);
      const next = prev.filter((s) => s.id !== sessionId);
      if (activeView === sessionId) {
        if (next.length === 0) {
          setActiveView('hosts');
        } else {
          const fallback = next[Math.max(0, idx - 1)] || next[0];
          setActiveView(fallback.id);
        }
      }
      return next;
    });
  };

  const handleStatusChange = useCallback(
    (
      sessionId: string,
      status: ConnectionState,
      extra?: { errorMessage?: string; reconnectAttempt?: number }
    ) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId
            ? {
                ...s,
                status,
                errorMessage:
                  extra && 'errorMessage' in extra ? extra.errorMessage : s.errorMessage,
                reconnectAttempt:
                  extra && typeof extra.reconnectAttempt === 'number'
                    ? extra.reconnectAttempt
                    : s.reconnectAttempt,
              }
            : s
        )
      );
      if (status === 'connected') {
        // Refresh hosts list in case a new host key fingerprint was saved
        api
          .getHosts()
          .then((res) => setHosts(res.hosts))
          .catch(() => {});
      }
    },
    []
  );

  const handleHostKeyPrompt = useCallback(
    (sessionId: string, prompt: HostKeyPrompt | null) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, hostKeyPrompt: prompt } : s))
      );
    },
    []
  );

  const activeSession = useMemo(
    () => (activeView === 'hosts' ? null : sessions.find((s) => s.id === activeView) || null),
    [activeView, sessions]
  );

  const activeLayout = useMemo(() => {
    const found = layouts.find((l) => l.id === settings.activeLayoutId);
    return found?.layout || layouts[0]?.layout || DEFAULT_PC_6ROW_LAYOUT;
  }, [layouts, settings.activeLayoutId]);

  const sendToActiveTerminal = useCallback(
    (seq: string) => {
      if (!activeSession) return;
      paneRefs.current[activeSession.id]?.sendData(seq);
    },
    [activeSession]
  );

  const cycleKeyboardMode = () => {
    const order: KeyboardMode[] = ['dev', 'native', 'hidden'];
    const next = order[(order.indexOf(settings.keyboardMode) + 1) % order.length];
    updateSettings({ keyboardMode: next });
    if (activeSession) {
      window.setTimeout(() => {
        if (next === 'native') {
          paneRefs.current[activeSession.id]?.focusTerminal(true);
        } else {
          paneRefs.current[activeSession.id]?.fit();
        }
      }, 40);
    }
    showToast(
      next === 'dev'
        ? 'Built-in Dev Keyboard'
        : next === 'native'
        ? 'Native Phone Keyboard'
        : 'Keyboard Hidden'
    );
  };

  if (authLoading) {
    return (
      <div className="h-dvh w-full bg-black flex items-center justify-center">
        <div className="text-xs font-mono-term text-accent">Loading xlab-bash...</div>
      </div>
    );
  }

  if (!authStatus.authenticated) {
    return (
      <>
        <OfflineIndicator />
        <AuthScreen
          authStatus={authStatus}
          notice={signedOutNotice || authStatus.signedOutReason}
          onAuthenticated={handleAuthenticated}
        />
      </>
    );
  }

  const isTerminalActive = Boolean(activeSession);

  return (
    <div className="h-dvh w-full bg-black text-zinc-100 flex flex-col overflow-hidden">
      <OfflineIndicator />

      {/* Slim 44px Top Session & Toolbar Strip */}
      <header className="h-11 w-full bg-[#09090b] border-b border-zinc-800/90 flex items-center justify-between gap-1 px-1.5 shrink-0 select-none">
        {/* Left + Center: Hosts trigger & Session Tabs */}
        <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => setActiveView('hosts')}
            className={`h-8 px-2.5 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${
              activeView === 'hosts'
                ? 'bg-zinc-800 text-zinc-50'
                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
            }`}
            title="xlab-bash Hosts"
          >
            <Server className="w-3.5 h-3.5 text-accent shrink-0" />
            <span className="font-mono-term font-semibold tracking-tight">xlab-bash</span>
          </button>

          {sessions.map((sess) => {
            const isTabActive = activeView === sess.id;
            const statusColor =
              sess.status === 'connected'
                ? 'bg-emerald-400'
                : sess.status === 'connecting' ||
                  sess.status === 'reconnecting' ||
                  sess.status === 'verifying'
                ? 'bg-amber-400'
                : 'bg-red-500';

            return (
              <div
                key={sess.id}
                role="tab"
                aria-selected={isTabActive}
                onClick={() => setActiveView(sess.id)}
                className={`group h-8 max-w-[155px] pl-2.5 pr-1 rounded-lg border text-xs inline-flex items-center gap-1.5 cursor-pointer shrink-0 transition ${
                  isTabActive
                    ? 'bg-black border-zinc-700 text-zinc-100'
                    : 'bg-zinc-950/60 border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`}
                  title={sess.status}
                />
                <span className="font-mono-term truncate">{sess.title}</span>
                <button
                  type="button"
                  onClick={(e) => closeSession(sess.id, e)}
                  className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 shrink-0"
                  aria-label={`Close ${sess.title}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {sessions.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveView('hosts')}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 shrink-0"
              aria-label="New connection"
              title="New connection"
            >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Right: Compact Terminal & App Controls */}
        <div className="flex items-center gap-0.5 shrink-0">
          {isTerminalActive && (
            <>
              {/* Font size +/- controls */}
              <div className="hidden sm:flex items-center border border-zinc-800 rounded-lg bg-black mr-1">
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({ fontSize: Math.max(9, settings.fontSize - 1) })
                  }
                  className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-100"
                  aria-label="Decrease font size"
                  title="Smaller font"
                >
                  <Minus className="w-3 h-3" />
                </button>
                <span className="px-1 text-[11px] font-mono-term text-zinc-300">
                  {settings.fontSize}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    updateSettings({ fontSize: Math.min(26, settings.fontSize + 1) })
                  }
                  className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-100"
                  aria-label="Increase font size"
                  title="Larger font"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => activeSession && paneRefs.current[activeSession.id]?.toggleSearch()}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"
                aria-label="Search terminal"
                title="Search terminal"
              >
                <Search className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={cycleKeyboardMode}
                className={`h-8 px-2 rounded-lg inline-flex items-center gap-1 text-[11px] font-medium border transition ${
                  settings.keyboardMode === 'dev'
                    ? 'btn-accent-soft'
                    : settings.keyboardMode === 'native'
                    ? 'bg-zinc-800 text-zinc-100 border-zinc-700'
                    : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 border-transparent'
                }`}
                aria-label="Switch keyboard mode"
                title="Toggle Dev Keyboard / Phone Keyboard / Hidden"
              >
                {settings.keyboardMode === 'dev' ? (
                  <>
                    <Keyboard className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">Dev</span>
                  </>
                ) : settings.keyboardMode === 'native' ? (
                  <>
                    <Smartphone className="w-3.5 h-3.5" />
                    <span className="hidden xs:inline">Native</span>
                  </>
                ) : (
                  <KeyboardOff className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setSettingsTab('display');
              setSettingsOpen(true);
            }}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex-1 min-h-0 flex flex-col relative bg-black">
        {/* Saved Hosts View */}
        {activeView === 'hosts' && (
          <HostsView
            hosts={hosts}
            encryptionKeyConfigured={authStatus.encryptionKeyConfigured}
            onHostsChange={setHosts}
            onConnectSaved={openSavedHost}
            onConnectQuick={openQuickConnect}
            onOpenFiles={setFilesHost}
            onToast={showToast}
          />
        )}

        {/* Persistent Open Terminal Sessions */}
        {sessions.map((session) => (
          <TerminalPane
            key={session.id}
            ref={(el) => {
              paneRefs.current[session.id] = el;
            }}
            session={session}
            isActive={activeView === session.id}
            fontSize={settings.fontSize}
            terminalTheme={settings.terminalTheme}
            keyboardMode={settings.keyboardMode}
            onFontSizeChange={(next) => updateSettings({ fontSize: next })}
            onStatusChange={handleStatusChange}
            onHostKeyPrompt={handleHostKeyPrompt}
            onSessionKey={handleSessionKey}
            onToast={showToast}
          />
        ))}

        {/* Docked Quick Bar + Built-In Dev Keyboard when a terminal tab is active */}
        {isTerminalActive && settings.keyboardMode !== 'hidden' && (
          <QuickBar
            items={settings.quickBarItems}
            snippets={snippets}
            showSnippets={settings.showSnippets}
            hapticEnabled={settings.hapticEnabled}
            onSendSequence={sendToActiveTerminal}
            onOpenSnippetsSettings={() => {
              setSettingsTab('snippets');
              setSettingsOpen(true);
            }}
            onPaste={() => activeSession && paneRefs.current[activeSession.id]?.paste()}
          />
        )}

        {isTerminalActive && settings.keyboardMode === 'dev' && (
          <DevKeyboard
            layout={activeLayout}
            height={settings.keyboardHeight}
            hapticEnabled={settings.hapticEnabled}
            showKeyPreview={settings.showKeyPreview}
            onSendSequence={sendToActiveTerminal}
          />
        )}
      </div>

      {/* Host Key Fingerprint Verification Modal */}
      {activeSession?.hostKeyPrompt && (
        <HostKeyModal
          prompt={activeSession.hostKeyPrompt}
          onAccept={() => paneRefs.current[activeSession.id]?.respondHostKey(true)}
          onReject={() => paneRefs.current[activeSession.id]?.respondHostKey(false)}
        />
      )}

      {/* Dark Settings Panel */}
      {settingsOpen && (
        <SettingsModal
          initialTab={settingsTab}
          settings={settings}
          snippets={snippets}
          layouts={layouts}
          username={authStatus.username}
          envAuthActive={authStatus.envAuthActive}
          openSessionKeys={sessions.map((s) => s.sessionKey).filter(Boolean) as string[]}
          onResumeShell={resumeShell}
          onSignedOutEverywhere={handleSignedOutEverywhere}
          onClose={() => setSettingsOpen(false)}
          onUpdateSettings={updateSettings}
          onSnippetsChange={setSnippets}
          onLayoutsChange={setLayouts}
          onLogout={handleLogout}
          onToast={showToast}
        />
      )}

      {/* SFTP File Browser */}
      {filesHost && (
        <FilesView host={filesHost} onClose={() => setFilesHost(null)} onToast={showToast} />
      )}

      {/* Ephemeral Toast Feedback */}
      {toast && (
        <div
          role="status"
          className="fixed top-13 left-1/2 -translate-x-1/2 z-50 rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 text-xs font-medium text-zinc-100 shadow-lg pointer-events-none"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
