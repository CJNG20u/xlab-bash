import {
  ArrowUp,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  Link2,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import type { HostSummary, RemoteEntry, RemoteListing } from '../types/index.ts';

interface FilesViewProps {
  host: HostSummary;
  onClose: () => void;
  onToast: (message: string) => void;
}

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

type NameDialog =
  | { kind: 'mkdir'; value: string }
  | { kind: 'rename'; value: string; entry: RemoteEntry }
  | null;

function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? { hour: '2-digit', minute: '2-digit' } : { year: 'numeric' }),
  });
}

export const FilesView: React.FC<FilesViewProps> = ({ host, onClose, onToast }) => {
  const [listing, setListing] = useState<RemoteListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentPath = listing?.path;

  const load = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);
      setMenuFor(null);
      setConfirmDelete(null);
      try {
        const res = await api.listFiles(host.id, path);
        setListing(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not list files.');
      } finally {
        setLoading(false);
      }
    },
    [host.id]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Close on Escape (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openEntry = (entry: RemoteEntry) => {
    if (!currentPath) return;
    const full = joinPath(currentPath, entry.name);
    if (entry.type === 'dir') {
      load(full);
    } else if (entry.type === 'file') {
      download(entry);
    }
  };

  const download = (entry: RemoteEntry) => {
    if (!currentPath) return;
    const a = document.createElement('a');
    a.href = api.downloadUrl(host.id, joinPath(currentPath, entry.name));
    a.download = entry.name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setMenuFor(null);
    onToast(`Downloading ${entry.name}`);
  };

  const uploadOne = async (file: File, dir: string, overwrite = false): Promise<void> => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setUploads((prev) => [...prev, { id, name: file.name, progress: 0, status: 'uploading' }]);
    const update = (patch: Partial<UploadItem>) =>
      setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
    try {
      await api.uploadFile(host.id, dir, file, {
        overwrite,
        onProgress: (fraction) => update({ progress: fraction }),
      });
      update({ status: 'done', progress: 1 });
      window.setTimeout(() => setUploads((prev) => prev.filter((u) => u.id !== id)), 2500);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !overwrite) {
        setUploads((prev) => prev.filter((u) => u.id !== id));
        if (window.confirm(`${file.name} already exists here. Replace it?`)) {
          return uploadOne(file, dir, true);
        }
        return;
      }
      update({ status: 'error', error: err instanceof Error ? err.message : 'Upload failed.' });
    }
  };

  const handleFilesPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!currentPath || files.length === 0) return;
    const dir = currentPath;
    for (const file of files) {
      // one at a time keeps phone memory and the SSH link calm
      await uploadOne(file, dir);
    }
    load(dir);
  };

  const submitNameDialog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDialog || !currentPath) return;
    const name = nameDialog.value.trim();
    if (!name) return;
    try {
      if (nameDialog.kind === 'mkdir') {
        await api.makeFolder(host.id, currentPath, name);
        onToast(`Created ${name}`);
      } else {
        await api.renameFile(host.id, joinPath(currentPath, nameDialog.entry.name), name);
        onToast(`Renamed to ${name}`);
      }
      setNameDialog(null);
      load(currentPath);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Operation failed.');
    }
  };

  const handleDelete = async (entry: RemoteEntry) => {
    if (!currentPath) return;
    try {
      await api.deleteFile(host.id, joinPath(currentPath, entry.name));
      onToast(`Deleted ${entry.name}`);
      load(currentPath);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Delete failed.');
      setConfirmDelete(null);
    }
  };

  const crumbs = (currentPath || '').split('/').filter(Boolean);

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col" role="dialog" aria-label={`Files on ${host.name}`}>
      {/* Header */}
      <div className="h-12 shrink-0 flex items-center gap-1 px-2 border-b border-zinc-800 bg-[#09090b]">
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
          aria-label="Close file browser"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-zinc-100 truncate">{host.name}</div>
          <div className="text-[11px] font-mono-term text-zinc-500 truncate">
            {host.username}@{host.host}
          </div>
        </div>
        <button
          type="button"
          onClick={() => currentPath && load(currentPath)}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
          aria-label="Refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => setNameDialog({ kind: 'mkdir', value: '' })}
          disabled={!currentPath}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 disabled:opacity-40"
          aria-label="New folder"
        >
          <FolderPlus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!currentPath}
          className="h-9 px-3 rounded-lg btn-accent-soft border text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-40"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Upload</span>
        </button>
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesPicked} />
      </div>

      {/* Path bar */}
      <div className="shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-zinc-900 overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => listing?.parent && load(listing.parent)}
          disabled={!listing?.parent}
          className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 disabled:opacity-30"
          aria-label="Up one folder"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => load('/')}
          className="h-7 px-1.5 shrink-0 rounded text-xs font-mono-term text-zinc-400 hover:text-zinc-100"
        >
          /
        </button>
        {crumbs.map((part, i) => {
          const target = '/' + crumbs.slice(0, i + 1).join('/');
          const last = i === crumbs.length - 1;
          return (
            <React.Fragment key={target}>
              {i > 0 && <span className="text-zinc-700 text-xs">/</span>}
              <button
                type="button"
                onClick={() => !last && load(target)}
                className={`h-7 px-1.5 shrink-0 rounded text-xs font-mono-term whitespace-nowrap ${
                  last ? 'text-zinc-100' : 'text-zinc-400 hover:text-zinc-100'
                }`}
              >
                {part}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Uploads */}
      {uploads.length > 0 && (
        <div className="shrink-0 px-3 py-2 space-y-1.5 border-b border-zinc-900 bg-zinc-950">
          {uploads.map((u) => (
            <div key={u.id} className="text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-zinc-300">{u.name}</span>
                <span
                  className={
                    u.status === 'error' ? 'text-red-400' : u.status === 'done' ? 'text-accent' : 'text-zinc-500'
                  }
                >
                  {u.status === 'error'
                    ? 'Failed'
                    : u.status === 'done'
                    ? 'Done'
                    : `${Math.round(u.progress * 100)}%`}
                </span>
              </div>
              {u.status === 'error' ? (
                <div className="flex items-center justify-between gap-2 text-red-400/80">
                  <span className="truncate">{u.error}</span>
                  <button
                    type="button"
                    onClick={() => setUploads((prev) => prev.filter((x) => x.id !== u.id))}
                    className="text-zinc-500 hover:text-zinc-200"
                  >
                    Dismiss
                  </button>
                </div>
              ) : (
                <div className="mt-1 h-1 rounded bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-accent-solid transition-all" style={{ width: `${u.progress * 100}%` }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Listing */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {error ? (
          <div className="p-6 text-center">
            <p className="text-sm text-red-400">{error}</p>
            <button
              type="button"
              onClick={() => load(currentPath)}
              className="mt-3 h-9 px-4 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900"
            >
              Try again
            </button>
          </div>
        ) : loading && !listing ? (
          <div className="p-8 flex justify-center text-zinc-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : listing && listing.entries.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">This folder is empty.</p>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {listing?.entries.map((entry) => {
              const Icon = entry.type === 'dir' ? Folder : entry.type === 'link' ? Link2 : FileIcon;
              const menuOpen = menuFor === entry.name;
              return (
                <li key={entry.name} className="relative">
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => openEntry(entry)}
                      className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-950 active:bg-zinc-900"
                    >
                      <Icon
                        className={`w-5 h-5 shrink-0 ${entry.type === 'dir' ? 'text-accent' : 'text-zinc-500'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-zinc-100 truncate">{entry.name}</div>
                        <div className="text-[11px] text-zinc-500 font-mono-term">
                          {entry.type === 'dir' ? 'Folder' : formatSize(entry.size)} · {formatDate(entry.mtime)}
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuFor(menuOpen ? null : entry.name);
                        setConfirmDelete(null);
                      }}
                      className="w-11 h-11 shrink-0 flex items-center justify-center text-zinc-500 hover:text-zinc-100"
                      aria-label={`Actions for ${entry.name}`}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                  </div>

                  {menuOpen && (
                    <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
                      {entry.type === 'file' && (
                        <button
                          type="button"
                          onClick={() => download(entry)}
                          className="h-8 px-3 rounded-lg border border-zinc-800 text-xs text-zinc-200 inline-flex items-center gap-1.5 hover:bg-zinc-900"
                        >
                          <Download className="w-3.5 h-3.5" /> Download
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setNameDialog({ kind: 'rename', value: entry.name, entry });
                          setMenuFor(null);
                        }}
                        className="h-8 px-3 rounded-lg border border-zinc-800 text-xs text-zinc-200 inline-flex items-center gap-1.5 hover:bg-zinc-900"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Rename
                      </button>
                      {confirmDelete === entry.name ? (
                        <button
                          type="button"
                          onClick={() => handleDelete(entry)}
                          className="h-8 px-3 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-500"
                        >
                          Delete {entry.type === 'dir' ? 'empty folder' : 'file'} permanently
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(entry.name)}
                          className="h-8 px-3 rounded-lg border border-zinc-800 text-xs text-red-400 inline-flex items-center gap-1.5 hover:bg-red-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* New folder / rename sheet */}
      {nameDialog && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-3">
          <form
            onSubmit={submitNameDialog}
            className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-4 space-y-3"
          >
            <div className="text-sm font-semibold text-zinc-100">
              {nameDialog.kind === 'mkdir' ? 'New folder' : `Rename ${nameDialog.entry.name}`}
            </div>
            <input
              autoFocus
              value={nameDialog.value}
              onChange={(e) => setNameDialog({ ...nameDialog, value: e.target.value })}
              className="w-full h-11 rounded-xl border border-zinc-800 bg-black px-3 text-sm font-mono-term text-zinc-100 outline-none focus:border-zinc-600"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={255}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNameDialog(null)}
                className="h-10 px-4 rounded-xl border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-10 px-4 rounded-xl btn-accent-soft border text-xs font-medium"
              >
                {nameDialog.kind === 'mkdir' ? 'Create' : 'Rename'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
