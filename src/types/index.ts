export type AuthType = 'password' | 'key';

export interface HostSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
  hostFingerprint: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface HostPayload {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  clearFingerprint?: boolean;
}

export interface SnippetItem {
  id: string;
  label: string;
  command: string;
  sendEnter: boolean;
  sortOrder: number;
}

export interface QuickBarItem {
  id: string;
  label: string;
  sequence: string;
  category?: 'combo' | 'symbol';
}

export type KeyKind =
  | 'char'
  | 'modifier'
  | 'fn_toggle'
  | 'special'
  | 'space'
  | 'custom';

export type ModifierType = 'ctrl' | 'alt' | 'shift';

export interface KeyDef {
  id: string;
  label: string;
  shiftLabel?: string;
  fnLabel?: string;
  fnSequence?: string;
  code: string;
  kind: KeyKind;
  modifier?: ModifierType;
  sequence?: string;
  width?: number; // relative flex weight, default 1
  repeatable?: boolean;
}

export interface KeyboardRow {
  id: string;
  scrollable?: boolean;
  keys: KeyDef[];
}

export interface KeyboardLayoutData {
  rows: KeyboardRow[];
}

export interface KeyboardLayoutRecord {
  id: string;
  name: string;
  layout: KeyboardLayoutData;
  isDefault: boolean;
  updatedAt: number;
}

export type KeyboardMode = 'dev' | 'native' | 'hidden';

export interface AppSettings {
  fontSize: number;
  terminalTheme: string;
  accentTheme: string;
  keyboardHeight: number;
  keyboardMode: KeyboardMode;
  hapticEnabled: boolean;
  showKeyPreview: boolean;
  activeLayoutId: string;
  quickBarItems: QuickBarItem[];
}

export interface AuthStatus {
  authenticated: boolean;
  needsSetup: boolean;
  username?: string;
  encryptionKeyConfigured: boolean;
  envAuthActive: boolean;
  /** Why this browser's previous login was refused (expired / revoked / invalid) */
  signedOutReason?: string;
}

export interface HostKeyPrompt {
  host: string;
  port: number;
  fingerprint: string;
  status: 'new' | 'changed';
  previousFingerprint?: string | null;
}

export type ConnectionState =
  | 'connecting'
  | 'verifying'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export interface QuickConnectTarget {
  name: string;
  host: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface TerminalSession {
  id: string;
  title: string;
  subtitle: string;
  hostId?: string;
  quickTarget?: QuickConnectTarget;
  status: ConnectionState;
  errorMessage?: string;
  reconnectAttempt: number;
  hostKeyPrompt: HostKeyPrompt | null;
  /** Server-side shell key; lets the tab re-attach after drops and page reloads. */
  sessionKey?: string;
}

/** A shell kept alive on the server (attached or waiting for the browser to return). */
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

export interface RemoteEntry {
  name: string;
  type: 'dir' | 'file' | 'link' | 'other';
  size: number;
  mtime: number;
  mode: number;
}

export interface RemoteListing {
  path: string;
  parent: string | null;
  entries: RemoteEntry[];
}
