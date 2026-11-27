import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { StringDecoder } from 'string_decoder';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import {
  consumeWsTicket,
  onSessionEpochChange,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from './auth.ts';
import {
  getHostWithSecrets,
  getKnownFingerprint,
  saveKnownFingerprint,
} from './db.ts';

/*
 * Persistent shells
 * -----------------
 * Each SSH shell lives in a ShellSession that is independent of the WebSocket
 * that created it. When the browser drops (phone locks, network switch, page
 * reload) the shell keeps running "detached" for SESSION_LINGER_MINUTES and
 * buffers its output. The browser re-attaches with the session key and gets
 * everything it missed replayed, so `apt upgrade` or `htop` keep going.
 */

const LINGER_MS =
  Math.max(0, Number(process.env.SESSION_LINGER_MINUTES ?? 15) || 0) * 60_000;
const BUFFER_LIMIT = 512 * 1024; // characters of scrollback kept per shell for replay

interface ClientMessage {
  type: 'connect' | 'attach' | 'input' | 'resize' | 'hostkey:decision' | 'ping' | 'close';
  sessionKey?: string;
  since?: number;
  hostId?: string;
  host?: string;
  port?: number;
  username?: string;
  authType?: 'password' | 'key';
  password?: string;
  privateKey?: string;
  passphrase?: string;
  cols?: number;
  rows?: number;
  data?: string;
  accept?: boolean;
  label?: string;
}

export interface ShellSessionInfo {
  key: string;
  label: string;
  target: string;
  hostId?: string;
  attached: boolean;
  createdAt: number;
  lastActivity: number;
  detachedAt: number | null;
}

class ShellSession {
  readonly key = crypto.randomBytes(24).toString('hex');
  readonly createdAt = Date.now();
  lastActivity = Date.now();
  detachedAt: number | null = null;
  ws: WebSocket | null = null;
  stream: ClientChannel | null = null;
  ended = false;

  /** Output chunks with the total character count at the end of each chunk. */
  private chunks: { end: number; text: string }[] = [];
  private bufferedChars = 0;
  totalChars = 0;
  private lingerTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly client: Client,
    readonly label: string,
    readonly target: string,
    readonly hostId?: string
  ) {}

  info(): ShellSessionInfo {
    return {
      key: this.key,
      label: this.label,
      target: this.target,
      hostId: this.hostId,
      attached: Boolean(this.ws),
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      detachedAt: this.detachedAt,
    };
  }

  /** Record shell output and forward it to the attached browser, if any. */
  output(text: string): void {
    if (!text) return;
    this.lastActivity = Date.now();
    this.totalChars += text.length;
    this.chunks.push({ end: this.totalChars, text });
    this.bufferedChars += text.length;
    while (this.bufferedChars > BUFFER_LIMIT && this.chunks.length > 1) {
      const dropped = this.chunks.shift()!;
      this.bufferedChars -= dropped.text.length;
    }
    if (this.ws) sendJson(this.ws, { type: 'data', data: text, seq: this.totalChars });
  }

  /** Everything after character offset `since` that is still buffered. */
  replaySince(since: number): { text: string; gap: boolean } {
    const firstStart = this.chunks.length
      ? this.chunks[0].end - this.chunks[0].text.length
      : this.totalChars;
    const from = Math.max(0, Math.min(since, this.totalChars));
    const parts: string[] = [];
    for (const c of this.chunks) {
      const start = c.end - c.text.length;
      if (c.end <= from) continue;
      parts.push(start >= from ? c.text : c.text.slice(from - start));
    }
    return { text: parts.join(''), gap: from < firstStart };
  }

  attach(ws: WebSocket): void {
    if (this.ws && this.ws !== ws) {
      sendJson(this.ws, { type: 'closed', message: 'Session was opened on another device.', taken: true });
      try {
        this.ws.close(4001, 'attached elsewhere');
      } catch {
        // ignore
      }
    }
    this.ws = ws;
    this.detachedAt = null;
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
  }

  detach(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    if (this.ended) return;
    if (!this.stream || LINGER_MS === 0) {
      // Never got a shell (still authenticating) or lingering disabled: end it.
      endSession(this, 'Browser disconnected.');
      return;
    }
    this.detachedAt = Date.now();
    this.lingerTimer = setTimeout(() => {
      endSession(this, 'Detached session timed out.');
    }, LINGER_MS);
  }

  dispose(): void {
    this.ended = true;
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = null;
    try {
      this.stream?.end();
      this.stream?.close();
    } catch {
      // ignore
    }
    try {
      this.client.end();
      this.client.destroy();
    } catch {
      // ignore
    }
    this.stream = null;
  }
}

const sessions = new Map<string, ShellSession>();
const liveSockets = new Set<WebSocket>();

function endSession(session: ShellSession, reason: string): void {
  if (session.ended) return;
  sessions.delete(session.key);
  const ws = session.ws;
  session.ws = null;
  session.dispose();
  if (ws) {
    sendJson(ws, { type: 'closed', message: reason, final: true });
    try {
      ws.close();
    } catch {
      // ignore
    }
  }
}

export function listShellSessions(): ShellSessionInfo[] {
  return [...sessions.values()]
    .filter((s) => s.stream && !s.ended)
    .map((s) => s.info())
    .sort((a, b) => b.lastActivity - a.lastActivity);
}

export function killShellSession(key: string): boolean {
  const s = sessions.get(key);
  if (!s) return false;
  endSession(s, 'Session ended from settings.');
  return true;
}

export function killAllShellSessions(): number {
  const all = [...sessions.values()];
  for (const s of all) endSession(s, 'All sessions were ended.');
  return all.length;
}

/** Close every open WebSocket (used when sessions are revoked). Shells stay detached. */
function closeAllSockets(): void {
  for (const ws of liveSockets) {
    sendJson(ws, { type: 'auth-revoked' });
    try {
      ws.close(4003, 'session revoked');
    } catch {
      // ignore
    }
  }
}

onSessionEpochChange(closeAllSockets);

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function formatSha256Fingerprint(keyBlob: Buffer): string {
  const digest = crypto.createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

function sanitizeHost(host: string): string | null {
  const trimmed = host.trim();
  if (!trimmed || trimmed.length > 253 || /[\s\x00-\x1f]/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function clampDim(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function isPrivateOrLocalHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === '::1' || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.internal')) {
    return true;
  }
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m = /^172\.(\d+)\./.exec(h);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function readableSshError(err: Error, host: string, port: number): string {
  const level = (err as Error & { level?: string }).level;
  const message = err.message || 'SSH connection error';
  const lanHint = isPrivateOrLocalHost(host)
    ? ' Note: private/LAN addresses (e.g. 192.168.x.x, 10.x.x.x) are only reachable when xlab-bash is self-hosted on the same network (Docker) or over VPN/Tailscale—cloud previews can only reach public hosts.'
    : '';
  if (level === 'client-authentication') {
    return 'Authentication failed. Check your username, password, or private key.';
  }
  if (message.includes('ECONNREFUSED')) {
    return `Connection refused by ${host}:${port}. Make sure sshd is running on port ${port}.${lanHint}`;
  }
  if (message.includes('ETIMEDOUT') || message.includes('Timed out')) {
    return `Connection timed out reaching ${host}:${port}.${lanHint}`;
  }
  if (message.includes('EHOSTUNREACH') || message.includes('ENETUNREACH')) {
    return `Host unreachable: ${host}:${port}.${lanHint}`;
  }
  if (message.includes('ENOTFOUND')) {
    return `Host not found: ${host}.${lanHint}`;
  }
  return message;
}

export function attachSshWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    liveSockets.add(ws);
    let session: ShellSession | null = null;
    let pendingHostKeyCallback: ((ok: boolean) => void) | null = null;
    let pendingHostKeyMeta: {
      host: string;
      port: number;
      fingerprint: string;
      hostId?: string;
    } | null = null;
    let hostKeyTimer: NodeJS.Timeout | null = null;

    const clearHostKeyWait = () => {
      if (hostKeyTimer) {
        clearTimeout(hostKeyTimer);
        hostKeyTimer = null;
      }
      if (pendingHostKeyCallback) {
        try {
          pendingHostKeyCallback(false);
        } catch {
          // ignore
        }
        pendingHostKeyCallback = null;
      }
      pendingHostKeyMeta = null;
    };

    const onSocketGone = () => {
      liveSockets.delete(ws);
      clearHostKeyWait();
      if (session) {
        session.detach(ws);
        session = null;
      }
    };

    ws.on('close', onSocketGone);
    ws.on('error', onSocketGone);

    const failAndClose = (message: string) => {
      sendJson(ws, { type: 'error', message });
      ws.close();
    };

    const attachExisting = (msg: ClientMessage) => {
      const key = typeof msg.sessionKey === 'string' ? msg.sessionKey : '';
      const existing = key ? sessions.get(key) : undefined;
      if (!existing || existing.ended || !existing.stream) {
        sendJson(ws, { type: 'session-expired' });
        return;
      }
      session = existing;
      existing.attach(ws);
      const since = Number.isFinite(Number(msg.since)) ? Number(msg.since) : 0;
      const { text, gap } = existing.replaySince(since);
      sendJson(ws, { type: 'session', sessionKey: existing.key, resumed: true });
      if (gap && since > 0) {
        sendJson(ws, {
          type: 'data',
          data: '\r\n\x1b[90m[xlab-bash] Some output was dropped while you were away.\x1b[0m\r\n',
        });
      }
      if (text) sendJson(ws, { type: 'data', data: text, seq: existing.totalChars });
      sendJson(ws, { type: 'status', status: 'connected', resumed: true });
      const cols = clampDim(msg.cols, 80, 10, 500);
      const rows = clampDim(msg.rows, 24, 5, 200);
      try {
        existing.stream.setWindow(rows, cols, 0, 0);
      } catch {
        // ignore
      }
    };

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString('utf8')) as ClientMessage;
      } catch {
        return;
      }

      if (msg.type === 'ping') {
        sendJson(ws, { type: 'pong' });
        return;
      }

      if (msg.type === 'input') {
        if (session?.stream && typeof msg.data === 'string') {
          session.lastActivity = Date.now();
          session.stream.write(msg.data);
        }
        return;
      }

      if (msg.type === 'resize') {
        if (session?.stream) {
          const cols = clampDim(msg.cols, 80, 10, 500);
          const rows = clampDim(msg.rows, 24, 5, 200);
          try {
            session.stream.setWindow(rows, cols, 0, 0);
          } catch {
            // ignore resize race on closing stream
          }
        }
        return;
      }

      if (msg.type === 'close') {
        // User closed the tab: end the shell instead of leaving it detached.
        if (session) endSession(session, 'Session closed.');
        session = null;
        return;
      }

      if (msg.type === 'hostkey:decision') {
        if (pendingHostKeyCallback && pendingHostKeyMeta) {
          if (hostKeyTimer) {
            clearTimeout(hostKeyTimer);
            hostKeyTimer = null;
          }
          const accept = Boolean(msg.accept);
          const cb = pendingHostKeyCallback;
          const meta = pendingHostKeyMeta;
          pendingHostKeyCallback = null;
          pendingHostKeyMeta = null;

          if (accept) {
            saveKnownFingerprint(meta.host, meta.port, meta.fingerprint, meta.hostId);
            cb(true);
          } else {
            cb(false);
            sendJson(ws, {
              type: 'error',
              message: 'Connection aborted: host key verification rejected.',
            });
          }
        }
        return;
      }

      if (msg.type === 'attach') {
        if (session) {
          sendJson(ws, { type: 'error', message: 'Socket already has a session.' });
          return;
        }
        attachExisting(msg);
        return;
      }

      if (msg.type !== 'connect') return;

      if (session) {
        sendJson(ws, { type: 'error', message: 'SSH session already active on this socket.' });
        return;
      }

      let targetHost = '';
      let targetPort = 22;
      let targetUsername = '';
      let authType: 'password' | 'key' = 'password';
      let password: string | null = null;
      let privateKey: string | null = null;
      let passphrase: string | null = null;
      let label = '';
      const hostId = typeof msg.hostId === 'string' && msg.hostId.trim() ? msg.hostId.trim() : undefined;

      if (hostId) {
        const saved = getHostWithSecrets(hostId);
        if (!saved) {
          failAndClose('Saved host not found.');
          return;
        }
        targetHost = saved.summary.host;
        targetPort = saved.summary.port;
        targetUsername = saved.summary.username;
        authType = saved.summary.authType;
        password = saved.password;
        privateKey = saved.privateKey;
        passphrase = saved.passphrase;
        label = saved.summary.name;

        if (authType === 'password' && !password) {
          failAndClose('Saved password could not be decrypted (check ENCRYPTION_KEY or re-save this host).');
          return;
        }
        if (authType === 'key' && !privateKey) {
          failAndClose('Saved private key could not be decrypted (check ENCRYPTION_KEY or re-save this host).');
          return;
        }
      } else {
        const cleanHost = typeof msg.host === 'string' ? sanitizeHost(msg.host) : null;
        if (!cleanHost) {
          failAndClose('Valid hostname or IP address is required.');
          return;
        }
        targetHost = cleanHost;
        targetPort = clampDim(msg.port, 22, 1, 65535);
        targetUsername = typeof msg.username === 'string' ? msg.username.trim() : '';
        if (!targetUsername) {
          failAndClose('SSH username is required.');
          return;
        }
        authType = msg.authType === 'key' ? 'key' : 'password';
        password = typeof msg.password === 'string' ? msg.password : null;
        privateKey = typeof msg.privateKey === 'string' ? msg.privateKey : null;
        passphrase = typeof msg.passphrase === 'string' && msg.passphrase ? msg.passphrase : null;
        label = typeof msg.label === 'string' && msg.label.trim() ? msg.label.trim().slice(0, 80) : cleanHost;
      }

      const cols = clampDim(msg.cols, 80, 10, 500);
      const rows = clampDim(msg.rows, 24, 5, 200);

      const client = new Client();
      const current = new ShellSession(
        client,
        label,
        `${targetUsername}@${targetHost}:${targetPort}`,
        hostId
      );
      sessions.set(current.key, current);
      current.attach(ws);
      session = current;

      sendJson(ws, {
        type: 'status',
        status: 'connecting',
        message: `Connecting to ${targetUsername}@${targetHost}:${targetPort}...`,
      });

      client.on('ready', () => {
        client.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
          if (err) {
            if (current.ws) sendJson(current.ws, { type: 'error', message: `Failed to allocate PTY shell: ${err.message}` });
            endSession(current, 'Shell could not start.');
            return;
          }
          current.stream = stream;
          if (current.ws) {
            sendJson(current.ws, { type: 'session', sessionKey: current.key, resumed: false });
            sendJson(current.ws, { type: 'status', status: 'connected' });
          } else {
            // Browser left while we were authenticating and nobody is coming back.
            endSession(current, 'Browser disconnected.');
            return;
          }

          // Multi-byte UTF-8 characters (box drawing in htop/tmux, emoji) can be split
          // across SSH packets; a StringDecoder holds partial bytes until complete.
          const stdoutDecoder = new StringDecoder('utf8');
          const stderrDecoder = new StringDecoder('utf8');
          stream.on('data', (chunk: Buffer) => current.output(stdoutDecoder.write(chunk)));
          stream.stderr.on('data', (chunk: Buffer) => current.output(stderrDecoder.write(chunk)));
          stream.on('close', () => endSession(current, 'Remote shell exited.'));
        });
      });

      client.on('error', (err) => {
        if (current.ws) {
          sendJson(current.ws, { type: 'error', message: readableSshError(err, targetHost, targetPort) });
        }
        endSession(current, 'SSH connection error.');
      });

      client.on('close', () => endSession(current, 'SSH connection closed.'));

      const connectConfig: ConnectConfig = {
        host: targetHost,
        port: targetPort,
        username: targetUsername,
        readyTimeout: 15_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 4,
        hostVerifier: (keyBlob: Buffer, verifyCallback: (valid: boolean) => void) => {
          const fingerprint = formatSha256Fingerprint(keyBlob);
          const savedFingerprint = getKnownFingerprint(targetHost, targetPort, hostId);

          if (savedFingerprint && savedFingerprint === fingerprint) {
            verifyCallback(true);
            return;
          }

          pendingHostKeyCallback = verifyCallback;
          pendingHostKeyMeta = { host: targetHost, port: targetPort, fingerprint, hostId };

          sendJson(ws, {
            type: 'hostkey',
            host: targetHost,
            port: targetPort,
            fingerprint,
            status: savedFingerprint ? 'changed' : 'new',
            previousFingerprint: savedFingerprint || null,
          });

          hostKeyTimer = setTimeout(() => {
            if (pendingHostKeyCallback) {
              const cb = pendingHostKeyCallback;
              pendingHostKeyCallback = null;
              pendingHostKeyMeta = null;
              cb(false);
              failAndClose('Host key verification timed out.');
            }
          }, 60_000);
        },
      };

      if (authType === 'key' && privateKey) {
        connectConfig.privateKey = privateKey;
        if (passphrase) connectConfig.passphrase = passphrase;
      } else if (password !== null) {
        connectConfig.password = password;
        connectConfig.tryKeyboard = true;
        client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
          finish(prompts.map(() => password || ''));
        });
      }

      try {
        client.connect(connectConfig);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to initiate SSH connection.';
        sendJson(ws, { type: 'error', message });
        endSession(current, 'SSH connection error.');
      }
    });
  });
}

function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/:(80|443)$/, '');
}

function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  // Non-browser clients (no Origin header) still need a valid ticket or session below.
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = normalizeHost(new URL(origin).host);
  } catch {
    return false;
  }
  const candidates = new Set<string>();
  const host = req.headers.host;
  if (host) candidates.add(normalizeHost(host));
  const fwdHost = req.headers['x-forwarded-host'];
  if (typeof fwdHost === 'string' && fwdHost) {
    candidates.add(normalizeHost(fwdHost.split(',')[0]));
  }
  if (process.env.APP_URL) {
    try {
      candidates.add(normalizeHost(new URL(process.env.APP_URL).host));
    } catch {
      // ignore malformed APP_URL
    }
  }
  for (const extra of (process.env.ALLOWED_ORIGINS || '').split(',')) {
    const clean = extra.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
    if (clean) candidates.add(normalizeHost(clean));
  }
  return candidates.has(originHost);
}

export function handleSshUpgrade(
  wss: WebSocketServer,
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname !== '/ws/ssh') {
    socket.destroy();
    return;
  }

  // Prefer single-use ticket issued via Same-Origin POST /api/ws-ticket.
  // Tickets are immune to cross-site WebSocket hijacking even behind proxies that
  // rewrite Host headers without forwarding X-Forwarded-Host.
  let authenticatedUser: string | null = null;
  const ticket = url.searchParams.get('ticket');
  if (ticket) {
    authenticatedUser = consumeWsTicket(ticket);
  }

  if (!authenticatedUser) {
    // Cookie-only WebSocket upgrades must come from an allowed same-origin host.
    if (!isAllowedOrigin(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const cookies = parseCookieHeader(req.headers.cookie);
    authenticatedUser = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  }

  if (!authenticatedUser) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
}
