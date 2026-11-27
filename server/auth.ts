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
import { claimAdminOnce, getClaimedAdmin } from './db.ts';

export const SESSION_COOKIE_NAME = 'termdock_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const JWT_SECRET =
  process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16
    ? process.env.JWT_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

interface SessionPayload {
  sub: string;
  iat?: number;
  exp?: number;
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
  if (cleanUser.length < 2 || cleanUser.length > 64 || password.length < 6) {
    return false;
  }
  const hashed = hashPassword(password);
  return claimAdminOnce(cleanUser, hashed);
}

export function signSessionToken(username: string): string {
  return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: SESSION_TTL_SECONDS });
}

export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as SessionPayload;
    return typeof decoded.sub === 'string' ? decoded.sub : null;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  const isSecure =
    res.req.secure ||
    res.req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production';

  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly',
  ];

  if (isSecure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }

  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const isSecure =
    res.req.secure ||
    res.req.headers['x-forwarded-proto'] === 'https' ||
    process.env.NODE_ENV === 'production';
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'Max-Age=0', 'HttpOnly'];
  if (isSecure) {
    parts.push('Secure', 'SameSite=None', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function extractAuthFromRequest(req: Request): {
  username: string | null;
  viaCookieOnly: boolean;
} {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const username = verifySessionToken(token);
    if (username) {
      return { username, viaCookieOnly: false };
    }
  }

  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (cookieToken) {
    const username = verifySessionToken(cookieToken);
    if (username) {
      return { username, viaCookieOnly: true };
    }
  }

  return { username: null, viaCookieOnly: false };
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
  const { username } = extractAuthFromRequest(req);
  return {
    authenticated: Boolean(username),
    needsSetup: needsFirstRunSetup(),
    username: username || undefined,
    encryptionKeyConfigured: isEncryptionKeyConfigured(),
    envAuthActive: isEnvAuthActive(),
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const { username, viaCookieOnly } = extractAuthFromRequest(req);
  if (!username) {
    res.status(401).json({ error: 'Authentication required' });
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
