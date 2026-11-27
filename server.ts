import cookieParser from 'cookie-parser';
import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import {
  authRateLimiter,
  clearSessionCookie,
  getAuthStatusForRequest,
  issueWsTicket,
  performFirstRunSetup,
  requireAuth,
  setSessionCookie,
  signSessionToken,
  verifyCredentials,
} from './server/auth.ts';
import {
  createHost,
  createLayout,
  createSnippet,
  deleteHost,
  deleteLayout,
  deleteSnippet,
  getSettings,
  listHosts,
  listLayouts,
  listSnippets,
  saveSettings,
  updateHost,
  updateLayout,
  updateSnippet,
} from './server/db.ts';
import { attachSshWebSocketServer, handleSshUpgrade } from './server/sshManager.ts';
import type { HostPayload, KeyboardLayoutData } from './src/types/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

function parseHostPayload(body: Record<string, unknown>): { data?: HostPayload; error?: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const host = typeof body.host === 'string' ? body.host.trim() : '';
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const port = Number(body.port ?? 22);
  const authType = body.authType === 'key' ? 'key' : 'password';

  if (!name || name.length > 80) return { error: 'Host name must be between 1 and 80 characters.' };
  if (!host || host.length > 253 || /[\s\x00-\x1f]/.test(host)) {
    return { error: 'Enter a valid hostname or IP address.' };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'Port must be an integer between 1 and 65535.' };
  }
  if (!username || username.length > 64 || /[\s\x00-\x1f]/.test(username)) {
    return { error: 'Enter a valid SSH username.' };
  }

  return {
    data: {
      name,
      host,
      port,
      username,
      authType,
      password: typeof body.password === 'string' ? body.password : undefined,
      privateKey: typeof body.privateKey === 'string' ? body.privateKey : undefined,
      passphrase: typeof body.passphrase === 'string' ? body.passphrase : undefined,
      clearFingerprint: Boolean(body.clearFingerprint),
    },
  };
}

function validateLayoutData(raw: unknown): KeyboardLayoutData | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { rows?: unknown };
  if (!Array.isArray(candidate.rows) || candidate.rows.length === 0 || candidate.rows.length > 10) {
    return null;
  }
  for (const row of candidate.rows) {
    if (!row || typeof row !== 'object' || !Array.isArray((row as { keys?: unknown }).keys)) {
      return null;
    }
  }
  return candidate as KeyboardLayoutData;
}

async function startServer() {
  const app = express();

  // Respect X-Forwarded-* headers when sitting behind Caddy, Nginx, or Traefik
  const trustProxyEnv = process.env.TRUST_PROXY;
  if (trustProxyEnv === 'false' || trustProxyEnv === '0') {
    app.set('trust proxy', false);
  } else {
    const hops = Number(trustProxyEnv);
    app.set('trust proxy', Number.isInteger(hops) && hops > 0 ? hops : 1);
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Health check for Docker / Caddy
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // --- Authentication Routes ---

  app.get('/api/auth/status', (req: Request, res: Response) => {
    res.json(getAuthStatusForRequest(req));
  });

  app.post('/api/auth/setup', authRateLimiter, (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    if (username.trim().length < 2 || username.trim().length > 64) {
      res.status(400).json({ error: 'Username must be 2–64 characters.' });
      return;
    }
    if (password.length < 10) {
      res.status(400).json({ error: 'Password must be at least 10 characters.' });
      return;
    }

    const ok = performFirstRunSetup(username, password);
    if (!ok) {
      res.status(409).json({ error: 'Admin account is already configured.' });
      return;
    }

    const cleanUser = username.trim();
    const token = signSessionToken(cleanUser);
    setSessionCookie(res, token);
    res.status(201).json({
      ...getAuthStatusForRequest(req),
      token,
      username: cleanUser,
      authenticated: true,
      needsSetup: false,
    });
  });

  app.post('/api/auth/login', authRateLimiter, (req: Request, res: Response) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    if (!verifyCredentials(username, password)) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const cleanUser = username.trim();
    const token = signSessionToken(cleanUser);
    setSessionCookie(res, token);
    res.json({
      ...getAuthStatusForRequest(req),
      token,
      username: cleanUser,
      authenticated: true,
    });
  });

  app.post('/api/auth/logout', (_req: Request, res: Response) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // Short-lived single-use ticket for opening a WebSocket SSH stream
  app.post('/api/ws-ticket', requireAuth, (req: Request, res: Response) => {
    const authUser = (req as Request & { authUser?: string }).authUser || 'admin';
    const ticket = issueWsTicket(authUser);
    res.json({ ticket });
  });

  // --- Saved Hosts Routes (Credentials AES-256 Encrypted in SQLite) ---

  app.get('/api/hosts', requireAuth, (_req: Request, res: Response) => {
    res.json({ hosts: listHosts() });
  });

  app.post('/api/hosts', requireAuth, (req: Request, res: Response) => {
    const parsed = parseHostPayload(req.body || {});
    if (parsed.error || !parsed.data) {
      res.status(400).json({ error: parsed.error || 'Invalid host payload.' });
      return;
    }
    const created = createHost(parsed.data);
    res.status(201).json({ host: created });
  });

  app.put('/api/hosts/:id', requireAuth, (req: Request, res: Response) => {
    const parsed = parseHostPayload(req.body || {});
    if (parsed.error || !parsed.data) {
      res.status(400).json({ error: parsed.error || 'Invalid host payload.' });
      return;
    }
    const updated = updateHost(req.params.id, parsed.data);
    if (!updated) {
      res.status(404).json({ error: 'Host not found.' });
      return;
    }
    res.json({ host: updated });
  });

  app.delete('/api/hosts/:id', requireAuth, (req: Request, res: Response) => {
    const deleted = deleteHost(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Host not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Snippets Routes ---

  app.get('/api/snippets', requireAuth, (_req: Request, res: Response) => {
    res.json({ snippets: listSnippets() });
  });

  app.post('/api/snippets', requireAuth, (req: Request, res: Response) => {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    const command = typeof req.body?.command === 'string' ? req.body.command : '';
    const sendEnter = req.body?.sendEnter !== false;

    if (!label || label.length > 48) {
      res.status(400).json({ error: 'Snippet label must be 1–48 characters.' });
      return;
    }
    if (!command || command.length > 512) {
      res.status(400).json({ error: 'Snippet command must be 1–512 characters.' });
      return;
    }
    const snippet = createSnippet({ label, command, sendEnter });
    res.status(201).json({ snippet });
  });

  app.put('/api/snippets/:id', requireAuth, (req: Request, res: Response) => {
    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : '';
    const command = typeof req.body?.command === 'string' ? req.body.command : '';
    const sendEnter = req.body?.sendEnter !== false;
    const sortOrder = typeof req.body?.sortOrder === 'number' ? req.body.sortOrder : undefined;

    if (!label || label.length > 48 || !command || command.length > 512) {
      res.status(400).json({ error: 'Invalid snippet label or command.' });
      return;
    }
    const updated = updateSnippet(req.params.id, { label, command, sendEnter, sortOrder });
    if (!updated) {
      res.status(404).json({ error: 'Snippet not found.' });
      return;
    }
    res.json({ snippet: updated });
  });

  app.delete('/api/snippets/:id', requireAuth, (req: Request, res: Response) => {
    const ok = deleteSnippet(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Snippet not found.' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Keyboard Layouts Routes ---

  app.get('/api/layouts', requireAuth, (_req: Request, res: Response) => {
    res.json({ layouts: listLayouts() });
  });

  app.post('/api/layouts', requireAuth, (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const layout = validateLayoutData(req.body?.layout);
    if (!name || name.length > 64 || !layout) {
      res.status(400).json({ error: 'Provide a valid layout name and rows array.' });
      return;
    }
    const created = createLayout(name, layout);
    res.status(201).json({ layout: created });
  });

  app.put('/api/layouts/:id', requireAuth, (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const layout = validateLayoutData(req.body?.layout);
    if (!name || name.length > 64 || !layout) {
      res.status(400).json({ error: 'Provide a valid layout name and rows array.' });
      return;
    }
    const updated = updateLayout(req.params.id, name, layout);
    if (!updated) {
      res.status(404).json({ error: 'Keyboard layout not found.' });
      return;
    }
    res.json({ layout: updated });
  });

  app.delete('/api/layouts/:id', requireAuth, (req: Request, res: Response) => {
    const ok = deleteLayout(req.params.id);
    if (!ok) {
      res.status(400).json({ error: 'Cannot delete default or missing layout.' });
      return;
    }
    res.json({ ok: true });
  });

  // --- Settings Routes ---

  app.get('/api/settings', requireAuth, (_req: Request, res: Response) => {
    res.json({ settings: getSettings() });
  });

  app.put('/api/settings', requireAuth, (req: Request, res: Response) => {
    const updated = saveSettings(req.body || {});
    res.json({ settings: updated });
  });

  // --- Frontend Static / Vite Dev Middleware ---

  const server = http.createServer(app);
  // 1 MB cap per message (pasted keys/text fit easily; default is 100 MB)
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  attachSshWebSocketServer(wss);

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname === '/ws/ssh') {
      handleSshUpgrade(wss, req, socket, head);
    } else if (IS_PROD) {
      socket.destroy();
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server },
        watch: process.env.DISABLE_HMR === 'true' ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[xlab-bash] Listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'dev'})`);
  });
}

startServer().catch((err) => {
  console.error('[xlab-bash] Fatal startup error:', err);
  process.exit(1);
});
