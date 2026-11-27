import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_PC_6ROW_LAYOUT,
  DEFAULT_SETTINGS,
  DEFAULT_SNIPPETS,
} from '../src/lib/defaultLayout.ts';
import type {
  AppSettings,
  AuthType,
  HostPayload,
  HostSummary,
  KeyboardLayoutData,
  KeyboardLayoutRecord,
  SnippetItem,
} from '../src/types/index.ts';
import { decryptSecret, encryptSecret } from './crypto.ts';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'termdock.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS hosts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username TEXT NOT NULL,
    auth_type TEXT NOT NULL CHECK(auth_type IN ('password', 'key')),
    encrypted_password TEXT,
    encrypted_private_key TEXT,
    encrypted_passphrase TEXT,
    host_fingerprint TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS known_hosts (
    host_port TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS snippets (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    command TEXT NOT NULL,
    send_enter INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS keyboard_layouts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    layout_json TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
`);

function seedDefaults() {
  const snippetCount = db.prepare('SELECT COUNT(*) as count FROM snippets').get() as { count: number };
  const seededFlag = db.prepare('SELECT value FROM app_config WHERE key = ?').get('defaults_seeded');

  if (!seededFlag) {
    if (snippetCount.count === 0) {
      const insertSnippet = db.prepare(
        'INSERT INTO snippets (id, label, command, send_enter, sort_order) VALUES (?, ?, ?, ?, ?)'
      );
      for (const s of DEFAULT_SNIPPETS) {
        insertSnippet.run(s.id, s.label, s.command, s.sendEnter ? 1 : 0, s.sortOrder);
      }
    }

    const layoutCount = db.prepare('SELECT COUNT(*) as count FROM keyboard_layouts').get() as {
      count: number;
    };
    if (layoutCount.count === 0) {
      db.prepare(
        'INSERT INTO keyboard_layouts (id, name, layout_json, is_default, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(
        'default-pc-6row',
        'xlab-bash 5-Row Developer',
        JSON.stringify(DEFAULT_PC_6ROW_LAYOUT),
        1,
        Date.now()
      );
    }

    db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(
      'defaults_seeded',
      '1'
    );
  }

  // One-time migration: remove Esc/F-keys row from default layout and enlarge default keyboard height
  const migratedV2 = db
    .prepare('SELECT value FROM app_config WHERE key = ?')
    .get('migration_xlab_v2');
  if (!migratedV2) {
    db.prepare(
      'UPDATE keyboard_layouts SET name = ?, layout_json = ?, updated_at = ? WHERE id = ?'
    ).run(
      'xlab-bash 5-Row Developer',
      JSON.stringify(DEFAULT_PC_6ROW_LAYOUT),
      Date.now(),
      'default-pc-6row'
    );

    const existingSettingsRaw = db
      .prepare('SELECT value FROM app_config WHERE key = ?')
      .get('app_settings') as { value: string } | undefined;
    if (existingSettingsRaw) {
      try {
        const parsed = JSON.parse(existingSettingsRaw.value) as Partial<AppSettings>;
        const patched: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...parsed,
          keyboardHeight:
            !parsed.keyboardHeight || parsed.keyboardHeight === 256
              ? DEFAULT_SETTINGS.keyboardHeight
              : parsed.keyboardHeight,
          terminalTheme: parsed.terminalTheme || DEFAULT_SETTINGS.terminalTheme,
        };
        db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(
          'app_settings',
          JSON.stringify(patched)
        );
      } catch {
        // ignore malformed json
      }
    }

    db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(
      'migration_xlab_v2',
      '1'
    );
  }

  // One-time migration: remove numbers row from main layout (moved into dedicated 123 toggle button)
  const migratedV3 = db
    .prepare('SELECT value FROM app_config WHERE key = ?')
    .get('migration_xlab_v3_num_button');
  if (!migratedV3) {
    db.prepare(
      'UPDATE keyboard_layouts SET name = ?, layout_json = ?, updated_at = ? WHERE id = ?'
    ).run(
      'xlab-bash 4-Row Developer',
      JSON.stringify(DEFAULT_PC_6ROW_LAYOUT),
      Date.now(),
      'default-pc-6row'
    );
    db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(
      'migration_xlab_v3_num_button',
      '1'
    );
  }
}

seedDefaults();

// --- Config & Admin Account ---

export function getConfig(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? row.value : null;
}

export function setConfig(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(key, value);
}

export function getClaimedAdmin(): { username: string; passwordHash: string } | null {
  const raw = getConfig('claimed_admin');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { username?: string; passwordHash?: string };
    if (parsed.username && parsed.passwordHash) {
      return { username: parsed.username, passwordHash: parsed.passwordHash };
    }
    return null;
  } catch {
    return null;
  }
}

export function claimAdminOnce(username: string, passwordHash: string): boolean {
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO app_config (key, value) VALUES (?, ?)'
  );
  const res = stmt.run('claimed_admin', JSON.stringify({ username, passwordHash }));
  return res.changes > 0;
}

// --- Settings ---

export function getSettings(): AppSettings {
  const raw = getConfig('app_settings');
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      terminalTheme:
        typeof parsed.terminalTheme === 'string' && parsed.terminalTheme.trim()
          ? parsed.terminalTheme.trim()
          : DEFAULT_SETTINGS.terminalTheme,
      accentTheme:
        typeof parsed.accentTheme === 'string' && parsed.accentTheme.trim()
          ? parsed.accentTheme.trim()
          : DEFAULT_SETTINGS.accentTheme,
      quickBarItems: Array.isArray(parsed.quickBarItems)
        ? parsed.quickBarItems
        : DEFAULT_SETTINGS.quickBarItems,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings();
  const next: AppSettings = {
    fontSize:
      typeof partial.fontSize === 'number'
        ? Math.min(26, Math.max(9, Math.round(partial.fontSize)))
        : current.fontSize,
    terminalTheme:
      typeof partial.terminalTheme === 'string' && partial.terminalTheme.trim()
        ? partial.terminalTheme.trim().slice(0, 40)
        : current.terminalTheme,
    accentTheme:
      typeof partial.accentTheme === 'string' && partial.accentTheme.trim()
        ? partial.accentTheme.trim().slice(0, 40)
        : current.accentTheme,
    keyboardHeight:
      typeof partial.keyboardHeight === 'number'
        ? Math.min(400, Math.max(190, Math.round(partial.keyboardHeight)))
        : current.keyboardHeight,
    keyboardMode:
      partial.keyboardMode === 'dev' ||
      partial.keyboardMode === 'native' ||
      partial.keyboardMode === 'hidden'
        ? partial.keyboardMode
        : current.keyboardMode,
    hapticEnabled:
      typeof partial.hapticEnabled === 'boolean' ? partial.hapticEnabled : current.hapticEnabled,
    showKeyPreview:
      typeof partial.showKeyPreview === 'boolean' ? partial.showKeyPreview : current.showKeyPreview,
    activeLayoutId:
      typeof partial.activeLayoutId === 'string' && partial.activeLayoutId.trim()
        ? partial.activeLayoutId.trim()
        : current.activeLayoutId,
    quickBarItems: Array.isArray(partial.quickBarItems)
      ? partial.quickBarItems.slice(0, 32).map((item) => ({
          id: String(item.id || crypto.randomUUID()),
          label: String(item.label || '').slice(0, 24),
          sequence: String(item.sequence || '').slice(0, 64),
          category: item.category === 'symbol' ? 'symbol' : 'combo',
        }))
      : current.quickBarItems,
  };
  setConfig('app_settings', JSON.stringify(next));
  return next;
}

// --- Hosts ---

interface HostRow {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: AuthType;
  encrypted_password: string | null;
  encrypted_private_key: string | null;
  encrypted_passphrase: string | null;
  host_fingerprint: string | null;
  created_at: number;
  updated_at: number;
}

function mapHostSummary(row: HostRow): HostSummary {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.auth_type,
    hasPassword: Boolean(row.encrypted_password),
    hasPrivateKey: Boolean(row.encrypted_private_key),
    hasPassphrase: Boolean(row.encrypted_passphrase),
    hostFingerprint: row.host_fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listHosts(): HostSummary[] {
  const rows = db
    .prepare('SELECT * FROM hosts ORDER BY updated_at DESC, name ASC')
    .all() as HostRow[];
  return rows.map(mapHostSummary);
}

export function getHostWithSecrets(id: string): {
  summary: HostSummary;
  password: string | null;
  privateKey: string | null;
  passphrase: string | null;
} | null {
  const row = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow | undefined;
  if (!row) return null;
  return {
    summary: mapHostSummary(row),
    password: decryptSecret(row.encrypted_password),
    privateKey: decryptSecret(row.encrypted_private_key),
    passphrase: decryptSecret(row.encrypted_passphrase),
  };
}

export function createHost(payload: HostPayload): HostSummary {
  const id = crypto.randomUUID();
  const now = Date.now();
  const encPass = payload.password ? encryptSecret(payload.password) : null;
  const encKey = payload.privateKey ? encryptSecret(payload.privateKey) : null;
  const encPassphrase = payload.passphrase ? encryptSecret(payload.passphrase) : null;

  db.prepare(
    `INSERT INTO hosts (
      id, name, host, port, username, auth_type,
      encrypted_password, encrypted_private_key, encrypted_passphrase,
      host_fingerprint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    id,
    payload.name,
    payload.host,
    payload.port,
    payload.username,
    payload.authType,
    encPass,
    encKey,
    encPassphrase,
    now,
    now
  );

  const created = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow;
  return mapHostSummary(created);
}

export function updateHost(id: string, payload: HostPayload): HostSummary | null {
  const existing = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow | undefined;
  if (!existing) return null;

  const now = Date.now();
  const encPass =
    payload.password !== undefined && payload.password !== ''
      ? encryptSecret(payload.password)
      : existing.encrypted_password;
  const encKey =
    payload.privateKey !== undefined && payload.privateKey !== ''
      ? encryptSecret(payload.privateKey)
      : existing.encrypted_private_key;
  const encPassphrase =
    payload.passphrase !== undefined && payload.passphrase !== ''
      ? encryptSecret(payload.passphrase)
      : existing.encrypted_passphrase;

  const nextFingerprint =
    payload.clearFingerprint ||
    payload.host !== existing.host ||
    payload.port !== existing.port
      ? null
      : existing.host_fingerprint;

  db.prepare(
    `UPDATE hosts SET
      name = ?, host = ?, port = ?, username = ?, auth_type = ?,
      encrypted_password = ?, encrypted_private_key = ?, encrypted_passphrase = ?,
      host_fingerprint = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    payload.name,
    payload.host,
    payload.port,
    payload.username,
    payload.authType,
    encPass,
    encKey,
    encPassphrase,
    nextFingerprint,
    now,
    id
  );

  const updated = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id) as HostRow;
  return mapHostSummary(updated);
}

export function deleteHost(id: string): boolean {
  const res = db.prepare('DELETE FROM hosts WHERE id = ?').run(id);
  return res.changes > 0;
}

// --- Known Hosts / Fingerprints ---

export function getKnownFingerprint(host: string, port: number, hostId?: string): string | null {
  if (hostId) {
    const row = db
      .prepare('SELECT host_fingerprint FROM hosts WHERE id = ?')
      .get(hostId) as { host_fingerprint: string | null } | undefined;
    if (row?.host_fingerprint) return row.host_fingerprint;
  }
  const key = `${host.toLowerCase()}:${port}`;
  const known = db
    .prepare('SELECT fingerprint FROM known_hosts WHERE host_port = ?')
    .get(key) as { fingerprint: string } | undefined;
  return known ? known.fingerprint : null;
}

export function saveKnownFingerprint(
  host: string,
  port: number,
  fingerprint: string,
  hostId?: string
): void {
  const now = Date.now();
  const key = `${host.toLowerCase()}:${port}`;
  db.prepare(
    'INSERT OR REPLACE INTO known_hosts (host_port, fingerprint, updated_at) VALUES (?, ?, ?)'
  ).run(key, fingerprint, now);

  if (hostId) {
    db.prepare('UPDATE hosts SET host_fingerprint = ?, updated_at = ? WHERE id = ?').run(
      fingerprint,
      now,
      hostId
    );
  }
}

// --- Snippets ---

interface SnippetRow {
  id: string;
  label: string;
  command: string;
  send_enter: number;
  sort_order: number;
}

export function listSnippets(): SnippetItem[] {
  const rows = db
    .prepare('SELECT * FROM snippets ORDER BY sort_order ASC, label ASC')
    .all() as SnippetRow[];
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    command: r.command,
    sendEnter: r.send_enter === 1,
    sortOrder: r.sort_order,
  }));
}

export function createSnippet(input: {
  label: string;
  command: string;
  sendEnter: boolean;
}): SnippetItem {
  const id = crypto.randomUUID();
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) as m FROM snippets')
    .get() as { m: number };
  const sortOrder = maxOrder.m + 1;
  db.prepare(
    'INSERT INTO snippets (id, label, command, send_enter, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(id, input.label, input.command, input.sendEnter ? 1 : 0, sortOrder);
  return { id, label: input.label, command: input.command, sendEnter: input.sendEnter, sortOrder };
}

export function updateSnippet(
  id: string,
  input: { label: string; command: string; sendEnter: boolean; sortOrder?: number }
): SnippetItem | null {
  const existing = db.prepare('SELECT * FROM snippets WHERE id = ?').get(id) as
    | SnippetRow
    | undefined;
  if (!existing) return null;
  const sortOrder = typeof input.sortOrder === 'number' ? input.sortOrder : existing.sort_order;
  db.prepare(
    'UPDATE snippets SET label = ?, command = ?, send_enter = ?, sort_order = ? WHERE id = ?'
  ).run(input.label, input.command, input.sendEnter ? 1 : 0, sortOrder, id);
  return {
    id,
    label: input.label,
    command: input.command,
    sendEnter: input.sendEnter,
    sortOrder,
  };
}

export function deleteSnippet(id: string): boolean {
  const res = db.prepare('DELETE FROM snippets WHERE id = ?').run(id);
  return res.changes > 0;
}

// --- Keyboard Layouts ---

interface LayoutRow {
  id: string;
  name: string;
  layout_json: string;
  is_default: number;
  updated_at: number;
}

function mapLayout(row: LayoutRow): KeyboardLayoutRecord {
  let layout: KeyboardLayoutData = DEFAULT_PC_6ROW_LAYOUT;
  try {
    layout = JSON.parse(row.layout_json) as KeyboardLayoutData;
  } catch {
    layout = DEFAULT_PC_6ROW_LAYOUT;
  }
  return {
    id: row.id,
    name: row.name,
    layout,
    isDefault: row.is_default === 1,
    updatedAt: row.updated_at,
  };
}

export function listLayouts(): KeyboardLayoutRecord[] {
  const rows = db
    .prepare('SELECT * FROM keyboard_layouts ORDER BY is_default DESC, updated_at DESC')
    .all() as LayoutRow[];
  return rows.map(mapLayout);
}

export function createLayout(name: string, layout: KeyboardLayoutData): KeyboardLayoutRecord {
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(
    'INSERT INTO keyboard_layouts (id, name, layout_json, is_default, updated_at) VALUES (?, ?, ?, 0, ?)'
  ).run(id, name, JSON.stringify(layout), now);
  return { id, name, layout, isDefault: false, updatedAt: now };
}

export function updateLayout(
  id: string,
  name: string,
  layout: KeyboardLayoutData
): KeyboardLayoutRecord | null {
  const existing = db.prepare('SELECT * FROM keyboard_layouts WHERE id = ?').get(id) as
    | LayoutRow
    | undefined;
  if (!existing) return null;
  const now = Date.now();
  db.prepare(
    'UPDATE keyboard_layouts SET name = ?, layout_json = ?, updated_at = ? WHERE id = ?'
  ).run(name, JSON.stringify(layout), now, id);
  return {
    id,
    name,
    layout,
    isDefault: existing.is_default === 1,
    updatedAt: now,
  };
}

export function deleteLayout(id: string): boolean {
  const existing = db.prepare('SELECT is_default FROM keyboard_layouts WHERE id = ?').get(id) as
    | { is_default: number }
    | undefined;
  if (!existing || existing.is_default === 1) return false;
  const res = db.prepare('DELETE FROM keyboard_layouts WHERE id = ?').run(id);
  return res.changes > 0;
}
