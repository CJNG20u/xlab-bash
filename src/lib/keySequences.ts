import type { KeyDef } from '../types/index.ts';

export interface ActiveModifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  fn: boolean;
}

/**
 * Computes xterm CSI modifier parameter:
 * 1 + (shift ? 1 : 0) + (alt ? 2 : 0) + (ctrl ? 4 : 0)
 * Returns null if no modifiers are active.
 */
function xtermModifierParam(mods: ActiveModifiers): number | null {
  const param = 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
  return param > 1 ? param : null;
}

/**
 * Unescapes user-entered custom escape notations like \x1b, \r, \n, \t, \x03.
 */
export function unescapeSequence(raw: string): string {
  return raw
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\e/g, '\x1b')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/**
 * Formats an escape sequence into a human-readable representation for the key tester.
 */
export function formatSequenceForDisplay(seq: string): string {
  return Array.from(seq)
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code === 0x1b) return 'ESC';
      if (code === 0x0d) return 'CR';
      if (code === 0x0a) return 'LF';
      if (code === 0x09) return 'TAB';
      if (code === 0x7f) return 'DEL';
      if (code === 0x20) return 'SPC';
      if (code < 0x20) return `^${String.fromCharCode(code + 64)}`;
      return ch;
    })
    .join(' ');
}

/**
 * Converts a virtual key press plus active modifiers into the exact xterm-256color
 * escape sequence to stream into the remote ssh2 PTY shell.
 */
export function resolveKeySequence(key: KeyDef, mods: ActiveModifiers): string | null {
  if (key.kind === 'modifier' || key.kind === 'fn_toggle') {
    return null;
  }

  // Custom key with literal/escaped sequence
  if (key.kind === 'custom' && key.sequence) {
    const seq = unescapeSequence(key.sequence);
    return mods.alt && !seq.startsWith('\x1b') ? `\x1b${seq}` : seq;
  }

  // Fn/Sym layer override
  if (mods.fn && key.fnSequence) {
    const base = unescapeSequence(key.fnSequence);
    if (mods.ctrl && base.length === 1) {
      const ctrlSeq = applyCtrlToChar(base);
      if (ctrlSeq !== null) {
        return mods.alt ? `\x1b${ctrlSeq}` : ctrlSeq;
      }
    }
    return mods.alt && !base.startsWith('\x1b') ? `\x1b${base}` : base;
  }

  const modParam = xtermModifierParam(mods);

  // Space key
  if (key.kind === 'space' || key.code === 'Space') {
    if (mods.ctrl) {
      return mods.alt ? '\x1b\x00' : '\x00';
    }
    return mods.alt ? '\x1b ' : ' ';
  }

  // Special & Navigation & Function keys
  switch (key.code) {
    case 'Escape':
      return '\x1b';
    case 'Enter':
      return mods.alt ? '\x1b\r' : '\r';
    case 'Tab':
      if (mods.shift) return '\x1b[Z';
      return mods.alt ? '\x1b\t' : '\t';
    case 'Backspace':
      if (mods.ctrl) return mods.alt ? '\x1b\x08' : '\x08';
      return mods.alt ? '\x1b\x7f' : '\x7f';
    case 'Delete':
      return modParam ? `\x1b[3;${modParam}~` : '\x1b[3~';
    case 'Insert':
      return modParam ? `\x1b[2;${modParam}~` : '\x1b[2~';
    case 'ArrowUp':
      return modParam ? `\x1b[1;${modParam}A` : '\x1b[A';
    case 'ArrowDown':
      return modParam ? `\x1b[1;${modParam}B` : '\x1b[B';
    case 'ArrowRight':
      return modParam ? `\x1b[1;${modParam}C` : '\x1b[C';
    case 'ArrowLeft':
      return modParam ? `\x1b[1;${modParam}D` : '\x1b[D';
    case 'Home':
      return modParam ? `\x1b[1;${modParam}H` : '\x1b[H';
    case 'End':
      return modParam ? `\x1b[1;${modParam}F` : '\x1b[F';
    case 'PageUp':
      return modParam ? `\x1b[5;${modParam}~` : '\x1b[5~';
    case 'PageDown':
      return modParam ? `\x1b[6;${modParam}~` : '\x1b[6~';
    case 'F1':
      return modParam ? `\x1b[1;${modParam}P` : '\x1bOP';
    case 'F2':
      return modParam ? `\x1b[1;${modParam}Q` : '\x1bOQ';
    case 'F3':
      return modParam ? `\x1b[1;${modParam}R` : '\x1bOR';
    case 'F4':
      return modParam ? `\x1b[1;${modParam}S` : '\x1bOS';
    case 'F5':
      return modParam ? `\x1b[15;${modParam}~` : '\x1b[15~';
    case 'F6':
      return modParam ? `\x1b[17;${modParam}~` : '\x1b[17~';
    case 'F7':
      return modParam ? `\x1b[18;${modParam}~` : '\x1b[18~';
    case 'F8':
      return modParam ? `\x1b[19;${modParam}~` : '\x1b[19~';
    case 'F9':
      return modParam ? `\x1b[20;${modParam}~` : '\x1b[20~';
    case 'F10':
      return modParam ? `\x1b[21;${modParam}~` : '\x1b[21~';
    case 'F11':
      return modParam ? `\x1b[23;${modParam}~` : '\x1b[23~';
    case 'F12':
      return modParam ? `\x1b[24;${modParam}~` : '\x1b[24~';
    default:
      break;
  }

  // Printable character keys
  const ch = mods.shift && key.shiftLabel ? key.shiftLabel : key.label;

  if (mods.ctrl) {
    const ctrlChar = applyCtrlToChar(key.label);
    if (ctrlChar !== null) {
      return mods.alt ? `\x1b${ctrlChar}` : ctrlChar;
    }
  }

  if (mods.alt) {
    return `\x1b${ch}`;
  }

  return ch;
}

function applyCtrlToChar(ch: string): string | null {
  if (!ch || ch.length !== 1) return null;
  const lower = ch.toLowerCase();
  const code = lower.charCodeAt(0);
  // a-z -> 0x01 - 0x1A
  if (code >= 97 && code <= 122) {
    return String.fromCharCode(code - 96);
  }
  switch (ch) {
    case '@':
    case '2':
    case ' ':
      return '\x00';
    case '[':
    case '3':
      return '\x1b';
    case '\\':
    case '4':
      return '\x1c';
    case ']':
    case '5':
      return '\x1d';
    case '^':
    case '6':
      return '\x1e';
    case '_':
    case '-':
    case '7':
    case '/':
      return '\x1f';
    case '?':
    case '8':
      return '\x7f';
    default:
      return null;
  }
}
