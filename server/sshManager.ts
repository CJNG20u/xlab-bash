import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import {
  consumeWsTicket,
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from './auth.ts';
import {
  getHostWithSecrets,
  getKnownFingerprint,
  saveKnownFingerprint,
} from './db.ts';

interface ClientMessage {
  type: 'connect' | 'input' | 'resize' | 'hostkey:decision' | 'ping';
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
}

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function formatSha256Fingerprint(keyBlob: Buffer): string {
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

export function attachSshWebSocketServer(wss: WebSocketServer): void {
  wss.on('connection', (ws: WebSocket) => {
    let sshClient: Client | null = null;
    let shellStream: ClientChannel | null = null;
    let pendingHostKeyCallback: ((ok: boolean) => void) | null = null;
    let pendingHostKeyMeta: {
      host: string;
      port: number;
      fingerprint: string;
      hostId?: string;
    } | null = null;
    let hostKeyTimer: NodeJS.Timeout | null = null;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
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
      if (shellStream) {
        try {
          shellStream.end();
          shellStream.close();
        } catch {
          // ignore
        }
        shellStream = null;
      }
      if (sshClient) {
        try {
          sshClient.end();
          sshClient.destroy();
        } catch {
          // ignore
        }
        sshClient = null;
      }
    };

    ws.on('close', cleanup);
    ws.on('error', cleanup);

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
        if (shellStream && typeof msg.data === 'string') {
          shellStream.write(msg.data);
        }
        return;
      }

      if (msg.type === 'resize') {
        if (shellStream) {
          const cols = clampDim(msg.cols, 80, 10, 500);
          const rows = clampDim(msg.rows, 24, 5, 200);
          try {
            shellStream.setWindow(rows, cols, 0, 0);
          } catch {
            // ignore resize race on closing stream
          }
        }
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

      if (msg.type === 'connect') {
        if (sshClient) {
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
        const hostId = typeof msg.hostId === 'string' && msg.hostId.trim() ? msg.hostId.trim() : undefined;

        if (hostId) {
          const saved = getHostWithSecrets(hostId);
          if (!saved) {
            sendJson(ws, { type: 'error', message: 'Saved host not found.' });
            ws.close();
            return;
          }
          targetHost = saved.summary.host;
          targetPort = saved.summary.port;
          targetUsername = saved.summary.username;
          authType = saved.summary.authType;
          password = saved.password;
          privateKey = saved.privateKey;
          passphrase = saved.passphrase;

          if (authType === 'password' && !password) {
            sendJson(ws, {
              type: 'error',
              message:
                'Saved password could not be decrypted (check ENCRYPTION_KEY or re-save this host).',
            });
            ws.close();
            return;
          }
          if (authType === 'key' && !privateKey) {
            sendJson(ws, {
              type: 'error',
              message:
                'Saved private key could not be decrypted (check ENCRYPTION_KEY or re-save this host).',
            });
            ws.close();
            return;
          }
        } else {
          const cleanHost = typeof msg.host === 'string' ? sanitizeHost(msg.host) : null;
          if (!cleanHost) {
            sendJson(ws, { type: 'error', message: 'Valid hostname or IP address is required.' });
            ws.close();
            return;
          }
          targetHost = cleanHost;
          targetPort = clampDim(msg.port, 22, 1, 65535);
          targetUsername = typeof msg.username === 'string' ? msg.username.trim() : '';
          if (!targetUsername) {
            sendJson(ws, { type: 'error', message: 'SSH username is required.' });
            ws.close();
            return;
          }
          authType = msg.authType === 'key' ? 'key' : 'password';
          password = typeof msg.password === 'string' ? msg.password : null;
          privateKey = typeof msg.privateKey === 'string' ? msg.privateKey : null;
          passphrase = typeof msg.passphrase === 'string' && msg.passphrase ? msg.passphrase : null;
        }

        const cols = clampDim(msg.cols, 80, 10, 500);
        const rows = clampDim(msg.rows, 24, 5, 200);

        const client = new Client();
        sshClient = client;

        sendJson(ws, {
          type: 'status',
          status: 'connecting',
          message: `Connecting to ${targetUsername}@${targetHost}:${targetPort}...`,
        });

        client.on('ready', () => {
          sendJson(ws, { type: 'status', status: 'connected' });
          client.shell(
            {
              term: 'xterm-256color',
              cols,
              rows,
            },
            (err, stream) => {
              if (err) {
                sendJson(ws, {
                  type: 'error',
                  message: `Failed to allocate PTY shell: ${err.message}`,
                });
                cleanup();
                ws.close();
                return;
              }
              shellStream = stream;

              stream.on('data', (chunk: Buffer) => {
                sendJson(ws, { type: 'data', data: chunk.toString('utf8') });
              });

              stream.stderr.on('data', (chunk: Buffer) => {
                sendJson(ws, { type: 'data', data: chunk.toString('utf8') });
              });

              stream.on('close', () => {
                sendJson(ws, { type: 'closed', message: 'Remote shell exited.' });
                cleanup();
                ws.close();
              });
            }
          );
        });

        client.on('error', (err) => {
          const level = (err as Error & { level?: string }).level;
          let readable = err.message || 'SSH connection error';
          if (level === 'client-authentication') {
            readable = 'Authentication failed. Check your username, password, or private key.';
          } else if (readable.includes('ECONNREFUSED')) {
            readable = `Connection refused by ${targetHost}:${targetPort}.`;
          } else if (readable.includes('ETIMEDOUT') || readable.includes('Timed out')) {
            readable = `Connection timed out reaching ${targetHost}:${targetPort}.`;
          } else if (readable.includes('ENOTFOUND')) {
            readable = `Host not found: ${targetHost}.`;
          }
          sendJson(ws, { type: 'error', message: readable });
          cleanup();
          ws.close();
        });

        client.on('end', () => {
          sendJson(ws, { type: 'closed', message: 'SSH server closed the connection.' });
        });

        client.on('close', () => {
          if (!closed) {
            sendJson(ws, { type: 'closed', message: 'SSH connection closed.' });
            cleanup();
            ws.close();
          }
        });

        const connectConfig: ConnectConfig = {
          host: targetHost,
          port: targetPort,
          username: targetUsername,
          readyTimeout: 20_000,
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
            pendingHostKeyMeta = {
              host: targetHost,
              port: targetPort,
              fingerprint,
              hostId,
            };

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
                sendJson(ws, {
                  type: 'error',
                  message: 'Host key verification timed out.',
                });
                ws.close();
              }
            }, 60_000);
          },
        };

        if (authType === 'key' && privateKey) {
          connectConfig.privateKey = privateKey;
          if (passphrase) {
            connectConfig.passphrase = passphrase;
          }
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
          cleanup();
          ws.close();
        }
      }
    });
  });
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

  let authenticatedUser: string | null = null;
  const ticket = url.searchParams.get('ticket');
  if (ticket) {
    authenticatedUser = consumeWsTicket(ticket);
  }
  if (!authenticatedUser) {
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
