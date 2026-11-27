import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Secrets used to sign sessions and encrypt saved SSH credentials.
 *
 * If ENCRYPTION_KEY / JWT_SECRET are set in the environment they win.
 * Otherwise a random value is generated once and kept in DATA_DIR/secrets.json
 * (mode 0600), so the app works with zero config and saved hosts survive restarts.
 */

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const SECRETS_PATH = path.join(DATA_DIR, 'secrets.json');

interface StoredSecrets {
  encryptionKey?: string;
  jwtSecret?: string;
}

let cache: StoredSecrets | null = null;

function loadStored(): StoredSecrets {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(SECRETS_PATH, 'utf8')) as StoredSecrets;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(next: StoredSecrets): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${SECRETS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SECRETS_PATH);
  cache = next;
}

function getOrCreate(field: keyof StoredSecrets, envValue: string | undefined, minLength: number): string {
  const fromEnv = envValue?.trim();
  if (fromEnv && fromEnv.length >= minLength) return fromEnv;

  const stored = loadStored();
  const existing = stored[field];
  if (existing && existing.length >= minLength) return existing;

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    persist({ ...stored, [field]: generated });
    console.log(`[xlab-bash] Generated ${field} and saved it to ${SECRETS_PATH}`);
  } catch (err) {
    console.warn(
      `[xlab-bash] Could not save ${field} to ${SECRETS_PATH} (${(err as Error).message}). ` +
        'It will change on restart; set it in .env instead.'
    );
    cache = { ...stored, [field]: generated };
  }
  return generated;
}

export function getEncryptionSecret(): string {
  return getOrCreate('encryptionKey', process.env.ENCRYPTION_KEY, 1);
}

export function getJwtSecret(): string {
  return getOrCreate('jwtSecret', process.env.JWT_SECRET, 16);
}

/** True when the vault key is stable across restarts (env or saved file). */
export function isEncryptionKeyPersistent(): boolean {
  if (process.env.ENCRYPTION_KEY?.trim()) return true;
  getEncryptionSecret();
  return fs.existsSync(SECRETS_PATH);
}
