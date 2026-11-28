import {
  CornerDownLeft,
  Keyboard,
  LogOut,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sliders,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import React, { useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { APP_ACCENT_THEMES } from '../lib/appThemes.ts';
import { DEFAULT_QUICK_BAR_ITEMS } from '../lib/defaultLayout.ts';
import { TERMINAL_THEMES } from '../lib/terminalThemes.ts';
import type {
  AppSettings,
  KeyboardLayoutRecord,
  KeyboardMode,
  QuickBarItem,
  ShellSessionInfo,
  SnippetItem,
} from '../types/index.ts';
import { AccountSecurityPanel } from './AccountSecurityPanel.tsx';
import { KeyboardLayoutEditor } from './KeyboardLayoutEditor.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

export type SettingsTab = 'display' | 'snippets' | 'quickbar' | 'layout' | 'security';

interface SettingsModalProps {
  initialTab: SettingsTab;
  settings: AppSettings;
  snippets: SnippetItem[];
  layouts: KeyboardLayoutRecord[];
  username?: string;
  envAuthActive: boolean;
  openSessionKeys: string[];
  onResumeShell: (info: ShellSessionInfo) => void;
  onSignedOutEverywhere: () => void;
  onClose: () => void;
  onUpdateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  onSnippetsChange: (snippets: SnippetItem[]) => void;
  onLayoutsChange: (layouts: KeyboardLayoutRecord[]) => void;
  onLogout: () => void;
  onToast: (message: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  initialTab,
  settings,
  snippets,
  layouts,
  username,
  envAuthActive,
  openSessionKeys,
  onResumeShell,
  onSignedOutEverywhere,
  onClose,
  onUpdateSettings,
  onSnippetsChange,
  onLayoutsChange,
  onLogout,
  onToast,
}) => {
  const [tab, setTab] = useState<SettingsTab>(initialTab);

  // Snippet form
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);
  const [snipLabel, setSnipLabel] = useState('');
  const [snipCmd, setSnipCmd] = useState('');
  const [snipEnter, setSnipEnter] = useState(true);

  // QuickBar item form
  const [qbLabel, setQbLabel] = useState('');
  const [qbSeq, setQbSeq] = useState('');
  const [qbCat, setQbCat] = useState<'combo' | 'symbol'>('combo');

  const handleSaveSnippet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!snipLabel.trim() || !snipCmd) return;
    try {
      if (editingSnippetId) {
        const res = await api.updateSnippet(editingSnippetId, {
          label: snipLabel.trim(),
          command: snipCmd,
          sendEnter: snipEnter,
        });
        onSnippetsChange(snippets.map((s) => (s.id === editingSnippetId ? res.snippet : s)));
        onToast('Snippet updated');
      } else {
        const res = await api.createSnippet({
          label: snipLabel.trim(),
          command: snipCmd,
          sendEnter: snipEnter,
        });
        onSnippetsChange([...snippets, res.snippet]);
        onToast('Snippet added');
      }
      setEditingSnippetId(null);
      setSnipLabel('');
      setSnipCmd('');
      setSnipEnter(true);
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Failed to save snippet');
    }
  };

  const handleDeleteSnippet = async (id: string) => {
    try {
      await api.deleteSnippet(id);
      onSnippetsChange(snippets.filter((s) => s.id !== id));
      onToast('Snippet removed');
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Failed to delete snippet');
    }
  };

  const handleAddQuickItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qbLabel.trim() || !qbSeq) return;
    const nextItem: QuickBarItem = {
      id: `qb-${Date.now()}`,
      label: qbLabel.trim(),
      sequence: qbSeq,
      category: qbCat,
    };
    await onUpdateSettings({ quickBarItems: [...settings.quickBarItems, nextItem] });
    setQbLabel('');
    setQbSeq('');
    onToast('Quick bar item added');
  };

  const handleRemoveQuickItem = async (id: string) => {
    await onUpdateSettings({
      quickBarItems: settings.quickBarItems.filter((item) => item.id !== id),
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 sm:p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl h-[92dvh] sm:h-[85dvh] flex flex-col rounded-t-3xl sm:rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-zinc-800/90 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
            {username && (
              <p className="text-xs text-zinc-500">Signed in as {username}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 border-b border-zinc-800/90 overflow-x-auto no-scrollbar shrink-0 bg-black/50">
          {(
            [
              { id: 'display', label: 'Terminal', icon: Sliders },
              { id: 'snippets', label: 'Snippets', icon: TerminalSquare },
              { id: 'quickbar', label: 'Quick Bar', icon: Zap },
              { id: 'layout', label: 'Keyboard Layout', icon: Keyboard },
              { id: 'security', label: 'Security', icon: ShieldCheck },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`h-9 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition ${
                  active
                    ? 'bg-zinc-800 text-zinc-50'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6">
          {tab === 'display' && (
            <div className="space-y-5">
              {/* Font Size */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
                <div>
                  <div className="text-sm font-medium text-zinc-100">Terminal Font Size</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    JetBrains Mono · also adjustable with two-finger pinch
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ fontSize: Math.max(9, settings.fontSize - 1) })
                    }
                    className="w-9 h-9 rounded-lg border border-zinc-800 bg-black flex items-center justify-center text-zinc-200 hover:bg-zinc-900"
                    aria-label="Decrease font size"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="w-12 text-center text-sm font-mono-term text-zinc-100">
                    {settings.fontSize}px
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateSettings({ fontSize: Math.min(26, settings.fontSize + 1) })
                    }
                    className="w-9 h-9 rounded-lg border border-zinc-800 bg-black flex items-center justify-center text-zinc-200 hover:bg-zinc-900"
                    aria-label="Increase font size"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* App Button Theme (Spotify Green, Apple Music Red, Tidal Blue, Cobalt Blue) */}
              <div className="pb-5 border-b border-zinc-800/80 space-y-3">
                <div>
                  <div className="text-sm font-medium text-zinc-100">App Button Theme</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Changes primary buttons, active toggles, sliders, and keyboard accents across the whole app
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {APP_ACCENT_THEMES.map((theme) => {
                    const selected = (settings.accentTheme || 'spotify-green') === theme.id;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => onUpdateSettings({ accentTheme: theme.id })}
                        className={`text-left rounded-xl border p-3 transition ${
                          selected
                            ? 'bg-accent-soft border-accent'
                            : 'border-zinc-800 bg-black hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-4 h-4 rounded-full shrink-0 border border-white/15"
                            style={{ backgroundColor: theme.accent }}
                          />
                          <span className="text-xs font-semibold text-zinc-100 truncate">
                            {theme.name}
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-zinc-500 truncate">
                            {theme.subtitle}
                          </span>
                        </div>
                        <div
                          className="mt-2.5 h-6 rounded-md flex items-center justify-center text-[10px] font-semibold"
                          style={{
                            backgroundColor: theme.accent,
                            color: theme.accentFg,
                          }}
                        >
                          {selected ? 'Active' : 'Preview'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Terminal Color Theme (Fish Shell Palettes) */}
              <div className="pb-5 border-b border-zinc-800/80 space-y-3">
                <div>
                  <div className="text-sm font-medium text-zinc-100">Terminal Color Theme</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Fish-inspired syntax colors tuned for pure OLED black
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {TERMINAL_THEMES.map((preset) => {
                    const selected = (settings.terminalTheme || 'fish-vivid') === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onUpdateSettings({ terminalTheme: preset.id })}
                        className={`text-left rounded-xl border p-3 transition ${
                          selected
                            ? 'border-accent bg-accent-soft'
                            : 'border-zinc-800 bg-black hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-zinc-100">{preset.name}</span>
                          <span className="flex items-center gap-1 shrink-0">
                            {preset.swatches.map((hex, idx) => (
                              <span
                                key={idx}
                                className="w-2.5 h-2.5 rounded-full"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </span>
                        </div>
                        <div className="mt-2 rounded-md bg-black border border-zinc-900 px-2.5 py-1.5 font-mono-term text-[11px] truncate">
                          <span style={{ color: preset.theme.green }}>root@pve</span>{' '}
                          <span style={{ color: preset.theme.blue }}>~&gt;</span>{' '}
                          <span style={{ color: preset.theme.cyan }}>qm</span>{' '}
                          <span style={{ color: preset.theme.foreground }}>list</span>{' '}
                          <span style={{ color: preset.theme.yellow }}>--full</span>{' '}
                          <span style={{ color: preset.theme.magenta }}>|</span>{' '}
                          <span style={{ color: preset.theme.red }}>grep</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Keyboard Mode */}
              <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-zinc-800/80">
                <div>
                  <div className="text-sm font-medium text-zinc-100">Input Keyboard Mode</div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    Built-in Dev Keyboard suppresses the Android system keyboard automatically
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black border border-zinc-800">
                  {(
                    [
                      { value: 'dev', label: 'Built-in Dev' },
                      { value: 'native', label: 'Phone Native' },
                      { value: 'hidden', label: 'Hidden' },
                    ] as { value: KeyboardMode; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => onUpdateSettings({ keyboardMode: opt.value })}
                      className={`h-8 px-2.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                        settings.keyboardMode === opt.value
                          ? 'btn-accent font-semibold'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Keyboard Height */}
              <div className="pb-5 border-b border-zinc-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">Dev Keyboard Height</div>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      Adjust vertical height for portrait ergonomics (auto-scaled in landscape)
                    </div>
                  </div>
                  <span className="text-xs font-mono-term text-zinc-300">
                    {settings.keyboardHeight}px
                  </span>
                </div>
                <input
                  type="range"
                  min={200}
                  max={400}
                  step={4}
                  value={settings.keyboardHeight}
                  onChange={(e) =>
                    onUpdateSettings({ keyboardHeight: Number(e.target.value) })
                  }
                  className="w-full"
                />
              </div>

              {/* Haptics & Preview */}
              <div className="space-y-3 pb-5 border-b border-zinc-800/80">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">Haptic Key Feedback</div>
                    <div className="text-xs text-zinc-500">
                      Short vibration pulse on key press and spacebar cursor scrub
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.hapticEnabled}
                    onChange={(e) => onUpdateSettings({ hapticEnabled: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">Key-Preview Popup</div>
                    <div className="text-xs text-zinc-500">
                      Show floating character bubble above keys when tapped
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showKeyPreview}
                    onChange={(e) => onUpdateSettings({ showKeyPreview: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>

                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">Show Snippets Above Keyboard</div>
                    <div className="text-xs text-zinc-500">
                      The row of snippet buttons (qm list, docker ps…). Turn off for more terminal space
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showSnippets}
                    onChange={(e) => onUpdateSettings({ showSnippets: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
              </div>

              {/* PWA & Session Account */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <PWAInstallButton />
                <button
                  type="button"
                  onClick={onLogout}
                  className="h-10 px-4 rounded-xl border border-zinc-800 bg-black text-xs font-medium text-red-400 hover:bg-red-950/30 hover:border-red-900/60 inline-flex items-center gap-2 transition"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}

          {tab === 'security' && (
            <AccountSecurityPanel
              envAuthActive={envAuthActive}
              openSessionKeys={openSessionKeys}
              onResumeShell={onResumeShell}
              onSignedOutEverywhere={onSignedOutEverywhere}
              onToast={onToast}
            />
          )}

          {tab === 'snippets' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-zinc-800 bg-black p-4">
                <label className="flex items-center justify-between gap-4 cursor-pointer">
                  <div>
                    <div className="text-sm font-medium text-zinc-100">Show Snippets Above Keyboard</div>
                    <div className="text-xs text-zinc-500">
                      The row of snippet buttons (qm list, docker ps…). Turn off for more terminal space
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.showSnippets}
                    onChange={(e) => onUpdateSettings({ showSnippets: e.target.checked })}
                    className="w-5 h-5"
                  />
                </label>
              </div>
              <form
                onSubmit={handleSaveSnippet}
                className="rounded-xl border border-zinc-800 bg-black p-4 space-y-3"
              >
                <div className="text-xs font-semibold text-zinc-200">
                  {editingSnippetId ? 'Edit Snippet' : 'Add Snippet Button'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Button Label</label>
                    <input
                      type="text"
                      required
                      value={snipLabel}
                      onChange={(e) => setSnipLabel(e.target.value)}
                      placeholder="qm list"
                      className="w-full h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-xs font-mono-term text-zinc-100 focus-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-400 mb-1">Command</label>
                    <input
                      type="text"
                      required
                      value={snipCmd}
                      onChange={(e) => setSnipCmd(e.target.value)}
                      placeholder="qm list"
                      className="w-full h-10 rounded-lg border border-zinc-800 bg-zinc-950 px-3 text-xs font-mono-term text-zinc-100 focus-accent"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={snipEnter}
                      onChange={(e) => setSnipEnter(e.target.checked)}
                    />
                    <span>Send with Enter (execute immediately)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {editingSnippetId && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSnippetId(null);
                          setSnipLabel('');
                          setSnipCmd('');
                          setSnipEnter(true);
                        }}
                        className="h-9 px-3 rounded-lg border border-zinc-800 text-xs text-zinc-400 hover:text-zinc-100"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      className="h-9 px-4 rounded-lg btn-accent text-xs font-semibold transition"
                    >
                      {editingSnippetId ? 'Update' : 'Add Snippet'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="divide-y divide-zinc-800/80 rounded-xl border border-zinc-800 bg-black">
                {snippets.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-zinc-100 truncate">
                          {s.label}
                        </span>
                        <span className="text-[11px] text-zinc-500 inline-flex items-center gap-1 shrink-0">
                          {s.sendEnter ? (
                            <>
                              <CornerDownLeft className="w-3 h-3 text-accent" />
                              Auto-Enter
                            </>
                          ) : (
                            'Type only'
                          )}
                        </span>
                      </div>
                      <div className="text-xs font-mono-term text-zinc-400 truncate mt-0.5">
                        {s.command}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSnippetId(s.id);
                          setSnipLabel(s.label);
                          setSnipCmd(s.command);
                          setSnipEnter(s.sendEnter);
                        }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
                        aria-label={`Edit ${s.label}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteSnippet(s.id)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-zinc-900"
                        aria-label={`Delete ${s.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {snippets.length === 0 && (
                  <div className="p-6 text-center text-xs text-zinc-500">
                    No snippets configured yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'quickbar' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-400">
                  Configure one-tap shortcuts rendered in the top row of the Quick Bar.
                </p>
                <button
                  type="button"
                  onClick={() => onUpdateSettings({ quickBarItems: DEFAULT_QUICK_BAR_ITEMS })}
                  className="h-8 px-3 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900 inline-flex items-center gap-1.5 shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset Defaults</span>
                </button>
              </div>

              <form
                onSubmit={handleAddQuickItem}
                className="rounded-xl border border-zinc-800 bg-black p-4 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end"
              >
                <div className="sm:col-span-3">
                  <label className="block text-[11px] text-zinc-400 mb-1">Label</label>
                  <input
                    type="text"
                    required
                    value={qbLabel}
                    onChange={(e) => setQbLabel(e.target.value)}
                    placeholder="Ctrl+B"
                    className="w-full h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-mono-term text-zinc-100 focus-accent"
                  />
                </div>
                <div className="sm:col-span-4">
                  <label className="block text-[11px] text-zinc-400 mb-1">
                    Sequence (\x02, \x03, \t, |)
                  </label>
                  <input
                    type="text"
                    required
                    value={qbSeq}
                    onChange={(e) => setQbSeq(e.target.value)}
                    placeholder="\x02"
                    className="w-full h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs font-mono-term text-accent focus-accent"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] text-zinc-400 mb-1">Style</label>
                  <select
                    value={qbCat}
                    onChange={(e) => setQbCat(e.target.value as 'combo' | 'symbol')}
                    className="w-full h-9 rounded-lg border border-zinc-800 bg-zinc-950 px-2.5 text-xs text-zinc-100 focus-accent"
                  >
                    <option value="combo">Combo</option>
                    <option value="symbol">Symbol</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="w-full h-9 rounded-lg btn-accent text-xs font-semibold transition"
                  >
                    Add
                  </button>
                </div>
              </form>

              <div className="flex flex-wrap gap-2">
                {settings.quickBarItems.map((item) => (
                  <div
                    key={item.id}
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-black px-3 py-1.5 text-xs font-mono-term text-zinc-200"
                  >
                    <span>{item.label}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveQuickItem(item.id)}
                      className="text-zinc-500 hover:text-red-400"
                      aria-label={`Remove ${item.label}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'layout' && (
            <KeyboardLayoutEditor
              layouts={layouts}
              activeLayoutId={settings.activeLayoutId}
              onLayoutsChange={onLayoutsChange}
              onSelectActiveLayout={(id) => onUpdateSettings({ activeLayoutId: id })}
              onToast={onToast}
            />
          )}
        </div>
      </div>
    </div>
  );
};
