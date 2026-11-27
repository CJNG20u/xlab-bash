import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const SALT = 'termdock-aes256-gcm-v1';

let cachedKey: Buffer | null = null;
let ephemeralKeyWarningLogged = false;

export function isEncryptionKeyConfigured(): boolean {
  return Boolean(process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.trim().length > 0);
}

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.ENCRYPTION_KEY?.trim();
  if (envKey && envKey.length > 0) {
    cachedKey = crypto.scryptSync(envKey, SALT, 32);
    return cachedKey;
  }

  // Ephemeral in-memory key for unconfigured preview sessions (never persisted or hardcoded)
  if (!ephemeralKeyWarningLogged) {
    ephemeralKeyWarningLogged = true;
    console.warn(
      '[TermDock] ENCRYPTION_KEY is not set. Using an ephemeral in-memory key for this session. Set ENCRYPTION_KEY in .env to persist encrypted SSH credentials across restarts.'
    );
  }
  cachedKey = crypto.randomBytes(32);
  return cachedKey;
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(encoded: string | null | undefined): string | null {
  if (!encoded) return null;
  const parts = encoded.split(':');
  if (parts.length !== 3) return null;
  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const ciphertext = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPasswordHash(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = crypto.createHash('sha256').update(a).digest();
  const bufB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(bufA, bufB);
}
