import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import {
  hashPassword,
  isEncryptionKeyConfigured,
  timingSafeEqualString,
  verifyPasswordHash,
} from './crypto.ts';
import { claimAdminOnce, getClaimedAdmin, getConfig, setConfig } from './db.ts';
import { getJwtSecret } from './secrets.ts';

export const SESSION_COOKIE_NAME = 'termdock_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// From JWT_SECRET, or generated once and saved in DATA_DIR/secrets.json so
// sessions survive container restarts.
const JWT_SECRET = getJwtSecret();

interface SessionPayload {
  sub: string;
  ep?: number; // session epoch: bumping it revokes every token issued before
  iat?: number;
  exp?: number;
}

// --- Session epoch (sign out everywhere / password change) ---

type EpochListener = () => void;
const epochListeners = new Set<EpochListener>();

export function getSessionEpoch(): number {
  const n = Number(getConfig('session_epoch') || '0');
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/** Revokes every existing session token and notifies listeners (open sockets close). */
export function bumpSessionEpoch(): number {
  const next = getSessionEpoch() + 1;
  setConfig('session_epoch', String(next));
  wsTickets.clear();
  for (const fn of epochListeners) {
    try {
      fn();
    } catch {
      // ignore listener failures
    }
  }
  return next;
}

export function onSessionEpochChange(fn: EpochListener): void {
  epochListeners.add(fn);
}

// Short-lived single-use tickets for WebSocket handshake authentication
const wsTickets = new Map<string, { username: string; expiresAt: number }>();

export function issueWsTicket(username: string): string {
  const now = Date.now();
  // Clean up expired tickets
  for (const [k, v] of wsTickets.entries()) {
    if (v.expiresAt < now) wsTickets.delete(k);
  }
  const ticket = crypto.randomBytes(24).toString('hex');
  wsTickets.set(ticket, { username, expiresAt: now + 30_000 });
  return ticket;
}

export function consumeWsTicket(ticket: string): string | null {
  const entry = wsTickets.get(ticket);
  if (!entry) return null;
  wsTickets.delete(ticket);
  if (entry.expiresAt < Date.now()) return null;
  return entry.username;
}

export function isEnvAuthActive(): boolean {
  return Boolean(process.env.APP_PASSWORD && process.env.APP_PASSWORD.trim().length > 0);
}

export function needsFirstRunSetup(): boolean {
  if (isEnvAuthActive()) return false;
  return getClaimedAdmin() === null;
}

export function verifyCredentials(username: string, password: string): boolean {
  if (isEnvAuthActive()) {
    const expectedUser = (process.env.APP_USERNAME || 'admin').trim();
    const expectedPass = process.env.APP_PASSWORD || '';
    return (
      timingSafeEqualString(username.trim(), expectedUser) &&
      timingSafeEqualString(password, expectedPass)
    );
  }

  const claimed = getClaimedAdmin();
  if (!claimed) return false;
  return (
    timingSafeEqualString(username.trim(), claimed.username) &&
    verifyPasswordHash(password, claimed.passwordHash)
  );
}

export function performFirstRunSetup(username: string, password: string): boolean {
  if (isEnvAuthActive()) return false;
  const cleanUser = username.trim();
  if (cleanUser.length < 2 || cleanUser.length > 64 || password.length < 10) {
    return false;
  }
  const hashed = hashPassword(password);
  return claimAdminOnce(cleanUser, hashed);
}

export type ChangePasswordResult = 'ok' | 'env-managed' | 'wrong-password' | 'too-short';

/** Changes the first-run admin password and revokes all other sessions. */
export function changeAdminPassword(currentPassword: string, newPassword: string): ChangePasswordResult {
  if (isEnvAuthActive()) return 'env-managed';
  const claimed = getClaimedAdmin();
  if (!claimed || !verifyPasswordHash(currentPassword, claimed.passwordHash)) {
    return 'wrong-password';
  }
  if (newPassword.length < 10) return 'too-short';
  setConfig(
    'claimed_admin',
    JSON.stringify({ username: claimed.username, passwordHash: hashPassword(newPassword) })
  );
  bumpSessionEpoch();
  return 'ok';
}

export function signSessionToken(username: string): string {
  return jwt.sign({ sub: username, ep: getSessionEpoch() }, JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export type TokenRejectReason = 'expired' | 'revoked' | 'invalid';

interface TokenCheck {
  username: string | null;
  reason?: TokenRejectReason;
  issuedAt?: number; // seconds since epoch
}

function checkSessionToken(token: string): TokenCheck {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionPayload;
    if (typeof decoded.sub !== 'string') return { username: null, reason: 'invalid' };
    if ((decoded.ep ?? 0) !== getSessionEpoch()) return { username: null, reason: 'revoked' };
    return { username: decoded.sub, issuedAt: decoded.iat };
  } catch (err) {
    const name = (err as Error).name;
    return { username: null, reason: name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
}

export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  return checkSessionToken(token).username;
}

const REJECT_MESSAGES: Record<TokenRejectReason, string> = {
  expired: 'Your login expired. Sign in again.',
  revoked: 'You were signed out (password changed or "sign out everywhere"). Sign in again.',
  invalid: 'Your login is no longer valid (server key changed). Sign in again.',
};

// Sessions slide: a login used at least once a day never expires while you use it
const RENEW_AFTER_SECONDS = 60 * 60 * 24;

// Secure only when the browser actually reached us over HTTPS (directly or via a
// trusted proxy). A Secure cookie on plain http://<lan-ip>:8022 is silently dropped,
// which logged you out on every reload. SameSite=Lax keeps the cookie off
// cross-site requests and WebSocket upgrades started by other sites.
function cookieAttributes(res: Response): string[] {
  const isSecure = res.req.secure;
  return isSecure ? ['HttpOnly', 'Secure', 'SameSite=Lax'] : ['HttpOnly', 'SameSite=Lax'];
}

export function setSessionCookie(res: Response, token: string): void {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    ...cookieAttributes(res),
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', ...cookieAttributes(res)];
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function extractAuthFromRequest(req: Request): {
  username: string | null;
  viaCookieOnly: boolean;
  /** Why a presented token was refused (no token at all leaves this empty) */
  reason?: TokenRejectReason;
  issuedAt?: number;
} {
  let reason: TokenRejectReason | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const check = checkSessionToken(authHeader.slice(7).trim());
    if (check.username) {
      return { username: check.username, viaCookieOnly: false, issuedAt: check.issuedAt };
    }
    reason = check.reason;
  }

  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const check = checkSessionToken(cookieToken);
    if (check.username) {
      return { username: check.username, viaCookieOnly: true, issuedAt: check.issuedAt };
    }
    reason = check.reason ?? reason;
  }

  return { username: null, viaCookieOnly: false, reason };
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      result[key] = decodeURIComponent(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

export function getAuthStatusForRequest(req: Request) {
  const { username, reason } = extractAuthFromRequest(req);
  return {
    authenticated: Boolean(username),
    // Shown on the sign-in screen when an old login was refused
    signedOutReason: !username && reason ? REJECT_MESSAGES[reason] : undefined,
    needsSetup: needsFirstRunSetup(),
    username: username || undefined,
    encryptionKeyConfigured: isEncryptionKeyConfigured(),
    envAuthActive: isEnvAuthActive(),
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const { username, viaCookieOnly, reason, issuedAt } = extractAuthFromRequest(req);
  if (!username) {
    if (reason) {
      console.warn(`[auth] Rejected ${req.method} ${req.path} from ${req.ip}: session ${reason}`);
    }
    res.status(401).json({
      error: reason ? REJECT_MESSAGES[reason] : 'Sign in required.',
      code: reason ? `session_${reason}` : 'signed_out',
    });
    return;
  }

  // CSRF defense on cookie-authenticated state-changing requests
  const method = req.method.toUpperCase();
  if (viaCookieOnly && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    const hasCustomHeader = req.headers['x-requested-with'] === 'XMLHttpRequest';
    const origin = req.headers.origin;
    const expectedHost = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    let originMatches = false;
    if (origin && expectedHost) {
      try {
        originMatches = new URL(origin).host === expectedHost.split(',')[0].trim();
      } catch {
        originMatches = false;
      }
    }
    if (!hasCustomHeader && !originMatches) {
      res.status(403).json({ error: 'Cross-site request blocked' });
      return;
    }
  }

  // Renew a login that's more than a day old, so it never runs out while in use
  if (issuedAt && Date.now() / 1000 - issuedAt > RENEW_AFTER_SECONDS) {
    const fresh = signSessionToken(username);
    setSessionCookie(res, fresh);
    res.setHeader('X-Session-Token', fresh);
  }

  (req as Request & { authUser?: string }).authUser = username;
  next();
}

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 15 minutes before trying again.' },
});
