import type {
  AppSettings,
  RemoteListing,
  ShellSessionInfo,
  AuthStatus,
  HostPayload,
  HostSummary,
  KeyboardLayoutData,
  KeyboardLayoutRecord,
  SnippetItem,
} from '../types/index.ts';

// Session token held strictly in JS memory (never localStorage or sessionStorage)
let memoryToken: string | null = null;

export function setMemoryToken(token: string | null): void {
  memoryToken = token;
}

export function getMemoryToken(): string | null {
  return memoryToken;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-Requested-With', 'XMLHttpRequest');
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (memoryToken) {
    headers.set('Authorization', `Bearer ${memoryToken}`);
  }

  const res = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  if (!res.ok) {
    const message =
      (data && typeof data.error === 'string' ? data.error : null) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export const api = {
  getAuthStatus: () => request<AuthStatus>('/api/auth/status'),

  setupAdmin: async (username: string, password: string) => {
    const res = await request<AuthStatus & { token: string }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (res.token) setMemoryToken(res.token);
    return res;
  },

  login: async (username: string, password: string) => {
    const res = await request<AuthStatus & { token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    if (res.token) setMemoryToken(res.token);
    return res;
  },

  logout: async () => {
    await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    setMemoryToken(null);
  },

  changePassword: async (currentPassword: string, newPassword: string) => {
    const res = await request<{ ok: boolean; token: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (res.token) setMemoryToken(res.token);
    return res;
  },

  logoutAll: async () => {
    const res = await request<{ ok: boolean; endedShells: number }>('/api/auth/logout-all', {
      method: 'POST',
    });
    setMemoryToken(null);
    return res;
  },

  // Running shells
  getShellSessions: () =>
    request<{ sessions: ShellSessionInfo[]; lingerMinutes: number }>('/api/sessions'),
  killShellSession: (key: string) =>
    request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // SFTP files
  listFiles: (hostId: string, path?: string) =>
    request<RemoteListing>(
      `/api/hosts/${encodeURIComponent(hostId)}/files${path ? `?path=${encodeURIComponent(path)}` : ''}`
    ),
  makeFolder: (hostId: string, dir: string, name: string) =>
    request<{ ok: boolean; path: string }>(`/api/hosts/${encodeURIComponent(hostId)}/files/mkdir`, {
      method: 'POST',
      body: JSON.stringify({ dir, name }),
    }),
  renameFile: (hostId: string, path: string, name: string) =>
    request<{ ok: boolean; path: string }>(`/api/hosts/${encodeURIComponent(hostId)}/files/rename`, {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }),
  deleteFile: (hostId: string, path: string) =>
    request<{ ok: boolean }>(`/api/hosts/${encodeURIComponent(hostId)}/files/delete`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  downloadUrl: (hostId: string, path: string) =>
    `/api/hosts/${encodeURIComponent(hostId)}/files/download?path=${encodeURIComponent(path)}`,

  /** Streams a file to <dir>/<file.name>; XHR so we get upload progress. */
  uploadFile: (
    hostId: string,
    dir: string,
    file: File,
    opts: { overwrite?: boolean; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}
  ) =>
    new Promise<{ ok: boolean; path: string }>((resolve, reject) => {
      const qs = new URLSearchParams({ dir, name: file.name });
      if (opts.overwrite) qs.set('overwrite', '1');
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/api/hosts/${encodeURIComponent(hostId)}/files/upload?${qs.toString()}`);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      if (memoryToken) xhr.setRequestHeader('Authorization', `Bearer ${memoryToken}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
      };
      xhr.onload = () => {
        let data: { error?: string; ok?: boolean; path?: string } | null = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ ok: true, path: data?.path || '' });
        } else {
          reject(new ApiError(data?.error || `Upload failed (${xhr.status})`, xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiError('Upload failed (network error).', 0));
      xhr.onabort = () => reject(new ApiError('Upload cancelled.', 499));
      opts.signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(file);
    }),

  issueWsTicket: () => request<{ ticket: string }>('/api/ws-ticket', { method: 'POST' }),

  // Hosts
  getHosts: () => request<{ hosts: HostSummary[] }>('/api/hosts'),
  createHost: (payload: HostPayload) =>
    request<{ host: HostSummary }>('/api/hosts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateHost: (id: string, payload: HostPayload) =>
    request<{ host: HostSummary }>(`/api/hosts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteHost: (id: string) =>
    request<{ ok: boolean }>(`/api/hosts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Snippets
  getSnippets: () => request<{ snippets: SnippetItem[] }>('/api/snippets'),
  createSnippet: (payload: { label: string; command: string; sendEnter: boolean }) =>
    request<{ snippet: SnippetItem }>('/api/snippets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSnippet: (
    id: string,
    payload: { label: string; command: string; sendEnter: boolean; sortOrder?: number }
  ) =>
    request<{ snippet: SnippetItem }>(`/api/snippets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteSnippet: (id: string) =>
    request<{ ok: boolean }>(`/api/snippets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Keyboard Layouts
  getLayouts: () => request<{ layouts: KeyboardLayoutRecord[] }>('/api/layouts'),
  createLayout: (name: string, layout: KeyboardLayoutData) =>
    request<{ layout: KeyboardLayoutRecord }>('/api/layouts', {
      method: 'POST',
      body: JSON.stringify({ name, layout }),
    }),
  updateLayout: (id: string, name: string, layout: KeyboardLayoutData) =>
    request<{ layout: KeyboardLayoutRecord }>(`/api/layouts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ name, layout }),
    }),
  deleteLayout: (id: string) =>
    request<{ ok: boolean }>(`/api/layouts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Settings
  getSettings: () => request<{ settings: AppSettings }>('/api/settings'),
  saveSettings: (partial: Partial<AppSettings>) =>
    request<{ settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(partial),
    }),
};
