import {
  AlertTriangle,
  FolderOpen,
  KeyRound,
  Lock,
  Pencil,
  Play,
  Plus,
  Server,
  ShieldCheck,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import React, { useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import type { AuthType, HostPayload, HostSummary, QuickConnectTarget } from '../types/index.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';

interface HostsViewProps {
  hosts: HostSummary[];
  encryptionKeyConfigured: boolean;
  onHostsChange: (hosts: HostSummary[]) => void;
  onConnectSaved: (host: HostSummary) => void;
  onConnectQuick: (target: QuickConnectTarget) => void;
  onOpenFiles: (host: HostSummary) => void;
  onToast: (message: string) => void;
}

interface HostFormState {
  id?: string;
  name: string;
  host: string;
  port: string;
  username: string;
  authType: AuthType;
  password: string;
  privateKey: string;
  passphrase: string;
  clearFingerprint: boolean;
}

const EMPTY_FORM: HostFormState = {
  name: '',
  host: '',
  port: '22',
  username: 'root',
  authType: 'password',
  password: '',
  privateKey: '',
  passphrase: '',
  clearFingerprint: false,
};

export const HostsView: React.FC<HostsViewProps> = ({
  hosts,
  encryptionKeyConfigured,
  onHostsChange,
  onConnectSaved,
  onOpenFiles,
  onConnectQuick,
  onToast,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<HostFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Quick Connect state
  const [qcOpen, setQcOpen] = useState(false);
  const [qcHost, setQcHost] = useState('');
  const [qcPort, setQcPort] = useState('22');
  const [qcUser, setQcUser] = useState('root');
  const [qcAuthType, setQcAuthType] = useState<AuthType>('password');
  const [qcPassword, setQcPassword] = useState('');
  const [qcPrivateKey, setQcPrivateKey] = useState('');
  const [qcPassphrase, setQcPassphrase] = useState('');

  const openCreateModal = () => {
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (h: HostSummary) => {
    setForm({
      id: h.id,
      name: h.name,
      host: h.host,
      port: String(h.port),
      username: h.username,
      authType: h.authType,
      password: '',
      privateKey: '',
      passphrase: '',
      clearFingerprint: false,
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSaveHost = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    const payload: HostPayload = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 22,
      username: form.username.trim(),
      authType: form.authType,
      password: form.password || undefined,
      privateKey: form.privateKey || undefined,
      passphrase: form.passphrase || undefined,
      clearFingerprint: form.clearFingerprint,
    };

    try {
      if (form.id) {
        const res = await api.updateHost(form.id, payload);
        onHostsChange(hosts.map((h) => (h.id === form.id ? res.host : h)));
        onToast(`Updated ${res.host.name}`);
      } else {
        const res = await api.createHost(payload);
        onHostsChange([res.host, ...hosts]);
        onToast(`Saved ${res.host.name}`);
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save host.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteHost(id);
      onHostsChange(hosts.filter((h) => h.id !== id));
      setConfirmDeleteId(null);
      onToast('Host removed');
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Failed to delete host');
    }
  };

  const handleQuickConnectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const host = qcHost.trim();
    const username = qcUser.trim();
    if (!host || !username) return;
    onConnectQuick({
      name: host,
      host,
      port: Number(qcPort) || 22,
      username,
      authType: qcAuthType,
      password: qcAuthType === 'password' ? qcPassword : undefined,
      privateKey: qcAuthType === 'key' ? qcPrivateKey : undefined,
      passphrase: qcAuthType === 'key' && qcPassphrase ? qcPassphrase : undefined,
    });
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-black text-zinc-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 sm:py-8 space-y-6">
        {/* Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-50">
              SSH Hosts
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-zinc-400">
              Direct ssh2 PTY sessions · AES-256 encrypted backend vault
            </p>
          </div>
          <div className="flex items-center gap-2">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={() => setQcOpen((v) => !v)}
              className="h-10 px-3.5 rounded-xl border border-zinc-800 bg-zinc-950 text-xs sm:text-sm font-medium text-zinc-200 hover:bg-zinc-900 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              <span>Quick Connect</span>
            </button>
            <button
              type="button"
              onClick={openCreateModal}
              className="h-10 px-4 rounded-xl btn-accent text-xs sm:text-sm font-semibold active:scale-[0.98] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add Host</span>
            </button>
          </div>
        </div>

        {/* Ephemeral Encryption Key Notice */}
        {!encryptionKeyConfigured && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-xs text-amber-200/90">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              <strong className="font-semibold text-amber-200">ENCRYPTION_KEY is not set.</strong>{' '}
              An ephemeral session key is active for preview. Set{' '}
              <code className="font-mono-term text-amber-300">ENCRYPTION_KEY</code> in your{' '}
              <code className="font-mono-term text-amber-300">.env</code> file before production so
              saved SSH passwords and keys stay decryptable across container restarts.
            </p>
          </div>
        )}

        {/* Quick Connect Panel */}
        {qcOpen && (
          <form
            onSubmit={handleQuickConnectSubmit}
            className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-100">Quick Connect (Not Saved)</h2>
              <button
                type="button"
                onClick={() => setQcOpen(false)}
                className="p-1 text-zinc-500 hover:text-zinc-200"
                aria-label="Close quick connect"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <div className="sm:col-span-5">
                <label className="block text-[11px] text-zinc-400 mb-1">Host or IP</label>
                <input
                  type="text"
                  required
                  value={qcHost}
                  onChange={(e) => setQcHost(e.target.value)}
                  placeholder="192.168.1.10 or pve.lan"
                  className="w-full h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm font-mono-term text-zinc-100 placeholder:text-zinc-600 focus-accent"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] text-zinc-400 mb-1">Port</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={qcPort}
                  onChange={(e) => setQcPort(e.target.value)}
                  className="w-full h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm font-mono-term text-zinc-100 focus-accent"
                />
              </div>
              <div className="sm:col-span-3">
                <label className="block text-[11px] text-zinc-400 mb-1">Username</label>
                <input
                  type="text"
                  required
                  value={qcUser}
                  onChange={(e) => setQcUser(e.target.value)}
                  placeholder="root"
                  className="w-full h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm font-mono-term text-zinc-100 focus-accent"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] text-zinc-400 mb-1">Auth</label>
                <div className="grid grid-cols-2 h-10 p-0.5 rounded-lg bg-black border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setQcAuthType('password')}
                    className={`rounded-md text-xs font-medium transition ${
                      qcAuthType === 'password'
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Pass
                  </button>
                  <button
                    type="button"
                    onClick={() => setQcAuthType('key')}
                    className={`rounded-md text-xs font-medium transition ${
                      qcAuthType === 'key'
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Key
                  </button>
                </div>
              </div>
            </div>

            {qcAuthType === 'password' ? (
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1">SSH Password</label>
                <input
                  type="password"
                  value={qcPassword}
                  onChange={(e) => setQcPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-accent"
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] text-zinc-400 mb-1">Private Key (PEM / OpenSSH)</label>
                  <textarea
                    rows={3}
                    value={qcPrivateKey}
                    onChange={(e) => setQcPrivateKey(e.target.value)}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    className="w-full rounded-lg border border-zinc-800 bg-black p-2.5 text-xs font-mono-term text-zinc-100 placeholder:text-zinc-600 focus-accent"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-zinc-400 mb-1">Key Passphrase (optional)</label>
                  <input
                    type="password"
                    value={qcPassphrase}
                    onChange={(e) => setQcPassphrase(e.target.value)}
                    placeholder="Passphrase"
                    className="w-full h-10 rounded-lg border border-zinc-800 bg-black px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-accent"
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                className="h-10 px-5 rounded-xl btn-accent text-sm font-semibold inline-flex items-center gap-2 transition"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Open SSH Session</span>
              </button>
            </div>
          </form>
        )}

        {/* Saved Hosts Grid / Empty State */}
        {hosts.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-8 sm:p-12 text-center">
            <div className="w-12 h-12 rounded-2xl border border-zinc-800 bg-black flex items-center justify-center mx-auto mb-4">
              <Server className="w-5 h-5 text-zinc-400" />
            </div>
            <h2 className="text-base font-semibold text-zinc-100">No saved hosts yet</h2>
            <p className="mt-1.5 text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
              Add your Proxmox VE node, Linux server, or Raspberry Pi to connect with one tap. All
              passwords and SSH private keys are encrypted with AES-256 on the backend.
            </p>
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-5 h-11 px-5 rounded-xl btn-accent text-sm font-semibold inline-flex items-center gap-2 transition"
            >
              <Plus className="w-4 h-4" />
              <span>Add First Host</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {hosts.map((h) => (
              <div
                key={h.id}
                className="rounded-2xl border border-zinc-800/90 bg-zinc-950 p-4 flex flex-col justify-between gap-4 hover:border-zinc-700 transition"
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-semibold text-zinc-100 truncate">{h.name}</h3>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditModal(h)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 transition"
                        aria-label={`Edit ${h.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {confirmDeleteId === h.id ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(h.id)}
                          className="h-8 px-2.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-500 transition"
                        >
                          Confirm
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(h.id)}
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:text-red-400 hover:bg-zinc-900 transition"
                          aria-label={`Delete ${h.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-1 text-xs font-mono-term text-zinc-300 truncate">
                    {h.username}@{h.host}:{h.port}
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                    <span className="inline-flex items-center gap-1">
                      {h.authType === 'key' ? (
                        <KeyRound className="w-3 h-3 text-zinc-400" />
                      ) : (
                        <Lock className="w-3 h-3 text-zinc-400" />
                      )}
                      {h.authType === 'key' ? 'Private key' : 'Password'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck
                        className={`w-3 h-3 ${
                          h.hostFingerprint ? 'text-accent' : 'text-zinc-600'
                        }`}
                      />
                      {h.hostFingerprint ? 'Key verified' : 'New host'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onConnectSaved(h)}
                    className="flex-1 h-11 rounded-xl border btn-accent-outline text-sm font-medium active:scale-[0.98] inline-flex items-center justify-center gap-2 transition"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Connect</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpenFiles(h)}
                    disabled={!h.hostFingerprint}
                    title={
                      h.hostFingerprint
                        ? 'Browse files (SFTP)'
                        : 'Connect once and accept the host key to enable file browsing'
                    }
                    className="h-11 px-3.5 rounded-xl border border-zinc-800 bg-black text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:border-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] inline-flex items-center justify-center gap-2 transition"
                    aria-label={`Browse files on ${h.name}`}
                  >
                    <FolderOpen className="w-4 h-4" />
                    <span>Files</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Host Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/85 sm:p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-2xl border border-zinc-800 bg-zinc-950 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4 mb-4">
              <h2 className="text-base font-semibold text-zinc-100">
                {form.id ? 'Edit SSH Host' : 'Add SSH Host'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveHost} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Proxmox Node 1"
                  className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus-accent"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Host / IP Address
                  </label>
                  <input
                    type="text"
                    required
                    value={form.host}
                    onChange={(e) => setForm({ ...form, host: e.target.value })}
                    placeholder="192.168.1.50"
                    className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm font-mono-term text-zinc-100 placeholder:text-zinc-600 focus-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">Port</label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => setForm({ ...form, port: e.target.value })}
                    className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm font-mono-term text-zinc-100 focus-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Username</label>
                <input
                  type="text"
                  required
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder="root"
                  className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm font-mono-term text-zinc-100 placeholder:text-zinc-600 focus-accent"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Authentication Method
                </label>
                <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, authType: 'password' })}
                    className={`h-9 rounded-lg text-xs font-medium transition ${
                      form.authType === 'password'
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Password
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, authType: 'key' })}
                    className={`h-9 rounded-lg text-xs font-medium transition ${
                      form.authType === 'key'
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Private Key
                  </button>
                </div>
              </div>

              {form.authType === 'password' ? (
                <div>
                  <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                    SSH Password {form.id && '(leave blank to keep existing)'}
                  </label>
                  <input
                    type="password"
                    required={!form.id}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={form.id ? '••••••••••••' : 'Enter SSH password'}
                    className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus-accent"
                  />
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Private Key (PEM / OpenSSH){' '}
                      {form.id && '(leave blank to keep existing)'}
                    </label>
                    <textarea
                      rows={4}
                      required={!form.id}
                      value={form.privateKey}
                      onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                      className="w-full rounded-xl border border-zinc-800 bg-black p-3 text-xs font-mono-term text-zinc-100 placeholder:text-zinc-600 focus-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Key Passphrase (optional)
                    </label>
                    <input
                      type="password"
                      value={form.passphrase}
                      onChange={(e) => setForm({ ...form, passphrase: e.target.value })}
                      placeholder="Passphrase if encrypted"
                      className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus-accent"
                    />
                  </div>
                </>
              )}

              {form.id && (
                <label className="flex items-center gap-2.5 text-xs text-zinc-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.clearFingerprint}
                    onChange={(e) => setForm({ ...form, clearFingerprint: e.target.checked })}
                    className="rounded border-zinc-700 bg-black"
                  />
                  <span>Reset saved host key fingerprint (re-verify on next connect)</span>
                </label>
              )}

              {formError && (
                <p className="text-xs text-red-400 bg-red-950/30 border border-red-500/30 rounded-lg px-3 py-2">
                  {formError}
                </p>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="h-11 px-4 rounded-xl border border-zinc-800 text-sm text-zinc-300 hover:bg-zinc-900 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="h-11 px-5 rounded-xl btn-accent text-sm font-semibold disabled:opacity-50 transition"
                >
                  {saving ? 'Saving...' : form.id ? 'Save Changes' : 'Save Host'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
