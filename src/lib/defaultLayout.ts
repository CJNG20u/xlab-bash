import type { AppSettings, KeyDef, KeyboardLayoutData, KeyboardRow, QuickBarItem } from '../types/index.ts';

export const DEFAULT_QUICK_BAR_ITEMS: QuickBarItem[] = [
  { id: 'qb-esc', label: 'Esc', sequence: '\x1b', category: 'combo' },
  { id: 'qb-ctrl-c', label: 'Ctrl+C', sequence: '\x03', category: 'combo' },
  { id: 'qb-ctrl-d', label: 'Ctrl+D', sequence: '\x04', category: 'combo' },
  { id: 'qb-ctrl-z', label: 'Ctrl+Z', sequence: '\x1a', category: 'combo' },
  { id: 'qb-ctrl-l', label: 'Ctrl+L', sequence: '\x0c', category: 'combo' },
  { id: 'qb-ctrl-r', label: 'Ctrl+R', sequence: '\x12', category: 'combo' },
  { id: 'qb-ctrl-a', label: 'Ctrl+A', sequence: '\x01', category: 'combo' },
  { id: 'qb-ctrl-e', label: 'Ctrl+E', sequence: '\x05', category: 'combo' },
  { id: 'qb-tab', label: 'Tab', sequence: '\t', category: 'combo' },
  { id: 'qb-pipe', label: '|', sequence: '|', category: 'symbol' },
  { id: 'qb-tilde', label: '~', sequence: '~', category: 'symbol' },
  { id: 'qb-slash', label: '/', sequence: '/', category: 'symbol' },
  { id: 'qb-dollar', label: '$', sequence: '$', category: 'symbol' },
];

export const DEFAULT_SETTINGS: AppSettings = {
  fontSize: 14,
  terminalTheme: 'fish-vivid',
  accentTheme: 'spotify-green',
  keyboardHeight: 330,
  keyboardMode: 'dev',
  hapticEnabled: true,
  showKeyPreview: true,
  activeLayoutId: 'default-pc-6row',
  quickBarItems: DEFAULT_QUICK_BAR_ITEMS,
};

/**
 * Big-key layout for phones (thumbs, not styluses).
 *
 * Row 1 is a fixed control row (Esc, Tab, Ctrl, Alt and the arrows) that stays the
 * same on every page, so those keys are always in the same place. Letter rows hold
 * only letters, like a phone keyboard, so every key is wide enough to hit.
 * Numbers and symbols live on the 123 and #+= pages.
 */
const CONTROL_ROW = (prefix: string): KeyboardRow => ({
  id: `${prefix}-control`,
  keys: [
    { id: `${prefix}-esc`, label: 'Esc', code: 'Escape', kind: 'special' },
    { id: `${prefix}-tab`, label: 'Tab', code: 'Tab', kind: 'special' },
    { id: `${prefix}-ctrl`, label: 'Ctrl', code: 'ControlLeft', kind: 'modifier', modifier: 'ctrl', width: 1.15 },
    { id: `${prefix}-alt`, label: 'Alt', code: 'AltLeft', kind: 'modifier', modifier: 'alt' },
    { id: `${prefix}-left`, label: '←', code: 'ArrowLeft', kind: 'special', repeatable: true },
    { id: `${prefix}-up`, label: '↑', code: 'ArrowUp', kind: 'special', repeatable: true },
    { id: `${prefix}-down`, label: '↓', code: 'ArrowDown', kind: 'special', repeatable: true },
    { id: `${prefix}-right`, label: '→', code: 'ArrowRight', kind: 'special', repeatable: true },
  ],
});

const sym = (id: string, label: string, code: string): KeyDef => ({ id, label, code, kind: 'char' });

export const DEFAULT_PC_6ROW_LAYOUT: KeyboardLayoutData = {
  rows: [
    CONTROL_ROW('k'),
    {
      id: 'row-qwerty',
      keys: [
      { id: 'k-q', label: 'q', shiftLabel: 'Q', code: 'KeyQ', kind: 'char' },
      { id: 'k-w', label: 'w', shiftLabel: 'W', code: 'KeyW', kind: 'char' },
      { id: 'k-e', label: 'e', shiftLabel: 'E', code: 'KeyE', kind: 'char' },
      { id: 'k-r', label: 'r', shiftLabel: 'R', code: 'KeyR', kind: 'char' },
      { id: 'k-t', label: 't', shiftLabel: 'T', code: 'KeyT', kind: 'char' },
      { id: 'k-y', label: 'y', shiftLabel: 'Y', code: 'KeyY', kind: 'char' },
      { id: 'k-u', label: 'u', shiftLabel: 'U', code: 'KeyU', kind: 'char' },
      { id: 'k-i', label: 'i', shiftLabel: 'I', code: 'KeyI', kind: 'char' },
      { id: 'k-o', label: 'o', shiftLabel: 'O', code: 'KeyO', kind: 'char' },
      { id: 'k-p', label: 'p', shiftLabel: 'P', code: 'KeyP', kind: 'char' },
      ],
    },
    {
      id: 'row-asdf',
      keys: [
        { id: 'k-pad-l', label: '', code: 'Spacer', kind: 'spacer', width: 0.5 },
      { id: 'k-a', label: 'a', shiftLabel: 'A', code: 'KeyA', kind: 'char' },
      { id: 'k-s', label: 's', shiftLabel: 'S', code: 'KeyS', kind: 'char' },
      { id: 'k-d', label: 'd', shiftLabel: 'D', code: 'KeyD', kind: 'char' },
      { id: 'k-f', label: 'f', shiftLabel: 'F', code: 'KeyF', kind: 'char' },
      { id: 'k-g', label: 'g', shiftLabel: 'G', code: 'KeyG', kind: 'char' },
      { id: 'k-h', label: 'h', shiftLabel: 'H', code: 'KeyH', kind: 'char' },
      { id: 'k-j', label: 'j', shiftLabel: 'J', code: 'KeyJ', kind: 'char' },
      { id: 'k-k', label: 'k', shiftLabel: 'K', code: 'KeyK', kind: 'char' },
      { id: 'k-l', label: 'l', shiftLabel: 'L', code: 'KeyL', kind: 'char' },
        { id: 'k-pad-r', label: '', code: 'Spacer', kind: 'spacer', width: 0.5 },
      ],
    },
    {
      id: 'row-zxcv',
      keys: [
        { id: 'k-shift', label: '⇧', code: 'ShiftLeft', kind: 'modifier', modifier: 'shift', width: 1.5 },
      { id: 'k-z', label: 'z', shiftLabel: 'Z', code: 'KeyZ', kind: 'char' },
      { id: 'k-x', label: 'x', shiftLabel: 'X', code: 'KeyX', kind: 'char' },
      { id: 'k-c', label: 'c', shiftLabel: 'C', code: 'KeyC', kind: 'char' },
      { id: 'k-v', label: 'v', shiftLabel: 'V', code: 'KeyV', kind: 'char' },
      { id: 'k-b', label: 'b', shiftLabel: 'B', code: 'KeyB', kind: 'char' },
      { id: 'k-n', label: 'n', shiftLabel: 'N', code: 'KeyN', kind: 'char' },
      { id: 'k-m', label: 'm', shiftLabel: 'M', code: 'KeyM', kind: 'char' },
        { id: 'k-bksp', label: '⌫', code: 'Backspace', kind: 'special', width: 1.5, repeatable: true },
      ],
    },
    {
      id: 'row-bottom',
      keys: [
        { id: 'k-num-toggle', label: '123', code: 'FnToggle', kind: 'fn_toggle', width: 1.5 },
        { id: 'k-slash', label: '/', shiftLabel: '?', code: 'Slash', kind: 'char' },
        { id: 'k-space', label: 'Space', code: 'Space', kind: 'space', width: 4, repeatable: true },
        { id: 'k-dot', label: '.', shiftLabel: '>', code: 'Period', kind: 'char' },
        { id: 'k-enter', label: '↵', code: 'Enter', kind: 'special', width: 2 },
      ],
    },
  ],
};

/** 123 page: digits and the symbols used most in a shell. */
export const NUMBERS_LAYER_LAYOUT: KeyboardLayoutData = {
  rows: [
    CONTROL_ROW('n'),
    {
      id: 'num-digits',
      keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) =>
        sym(`n-${d}`, d, `Digit${d}`)
      ),
    },
    {
      id: 'num-common',
      keys: [
        sym('n-minus', '-', 'Minus'),
        sym('n-slash', '/', 'Slash'),
        sym('n-colon', ':', 'Colon'),
        sym('n-semi', ';', 'Semicolon'),
        sym('n-lparen', '(', 'LParen'),
        sym('n-rparen', ')', 'RParen'),
        sym('n-dollar', '$', 'Dollar'),
        sym('n-amp', '&', 'Amp'),
        sym('n-pipe', '|', 'Pipe'),
        sym('n-dquote', '"', 'DoubleQuote'),
      ],
    },
    {
      id: 'num-row-3',
      keys: [
        { id: 'n-page2', label: '#+=', code: 'FnPage2', kind: 'fn_toggle', width: 1.5 },
        sym('n-comma', ',', 'Comma'),
        sym('n-dot', '.', 'Period'),
        sym('n-qmark', '?', 'Question'),
        sym('n-bang', '!', 'Exclam'),
        sym('n-quote', "'", 'Quote'),
        sym('n-star', '*', 'Star'),
        sym('n-tilde', '~', 'Tilde'),
        { id: 'n-bksp', label: '⌫', code: 'Backspace', kind: 'special', width: 1.5, repeatable: true },
      ],
    },
    {
      id: 'num-bottom',
      keys: [
        { id: 'n-abc', label: 'ABC', code: 'FnToggle', kind: 'fn_toggle', width: 1.5 },
        sym('n-under', '_', 'Underscore'),
        { id: 'n-space', label: 'Space', code: 'Space', kind: 'space', width: 4, repeatable: true },
        sym('n-eq', '=', 'Equal'),
        { id: 'n-enter', label: '↵', code: 'Enter', kind: 'special', width: 2 },
      ],
    },
  ],
};

/** #+= page: brackets and rarer symbols, plus Home / End / PgUp / PgDn. */
export const SYMBOLS_LAYER_LAYOUT: KeyboardLayoutData = {
  rows: [
    CONTROL_ROW('s'),
    {
      id: 'sym-brackets',
      keys: [
        sym('s-lbr', '[', 'BracketLeft'),
        sym('s-rbr', ']', 'BracketRight'),
        sym('s-lbrace', '{', 'BraceLeft'),
        sym('s-rbrace', '}', 'BraceRight'),
        sym('s-hash', '#', 'Hash'),
        sym('s-pct', '%', 'Percent'),
        sym('s-caret', '^', 'Caret'),
        sym('s-plus', '+', 'Plus'),
        sym('s-lt', '<', 'Less'),
        sym('s-gt', '>', 'Greater'),
      ],
    },
    {
      id: 'sym-misc',
      keys: [
        sym('s-bslash', '\\', 'Backslash'),
        sym('s-grave', '`', 'Backquote'),
        sym('s-at', '@', 'At'),
        sym('s-under', '_', 'Underscore'),
        sym('s-eq', '=', 'Equal'),
        sym('s-pipe', '|', 'Pipe'),
        sym('s-amp', '&', 'Amp'),
        sym('s-dollar', '$', 'Dollar'),
        sym('s-dquote', '"', 'DoubleQuote'),
        sym('s-quote', "'", 'Quote'),
      ],
    },
    {
      id: 'sym-nav',
      keys: [
        { id: 's-page1', label: '123', code: 'FnPage1', kind: 'fn_toggle', width: 1.5 },
        { id: 's-home', label: 'Home', code: 'Home', kind: 'special', width: 1.25 },
        { id: 's-end', label: 'End', code: 'End', kind: 'special', width: 1.25 },
        { id: 's-pgup', label: 'PgUp', code: 'PageUp', kind: 'special', width: 1.25, repeatable: true },
        { id: 's-pgdn', label: 'PgDn', code: 'PageDown', kind: 'special', width: 1.25, repeatable: true },
        { id: 's-bksp', label: '⌫', code: 'Backspace', kind: 'special', width: 1.5, repeatable: true },
      ],
    },
    {
      id: 'sym-bottom',
      keys: [
        { id: 's-abc', label: 'ABC', code: 'FnToggle', kind: 'fn_toggle', width: 1.5 },
        sym('s-minus', '-', 'Minus'),
        { id: 's-space', label: 'Space', code: 'Space', kind: 'space', width: 4, repeatable: true },
        sym('s-colon', ':', 'Colon'),
        { id: 's-enter', label: '↵', code: 'Enter', kind: 'special', width: 2 },
      ],
    },
  ],
};

export const DEFAULT_SNIPPETS = [
  { id: 'snip-qm', label: 'qm list', command: 'qm list', sendEnter: true, sortOrder: 0 },
  { id: 'snip-pct', label: 'pct list', command: 'pct list', sendEnter: true, sortOrder: 1 },
  { id: 'snip-systemctl', label: 'systemctl status', command: 'systemctl status ', sendEnter: false, sortOrder: 2 },
  { id: 'snip-docker', label: 'docker ps', command: 'docker ps', sendEnter: true, sortOrder: 3 },
  { id: 'snip-journal', label: 'journalctl -f', command: 'journalctl -f', sendEnter: true, sortOrder: 4 },
  { id: 'snip-htop', label: 'htop', command: 'htop', sendEnter: true, sortOrder: 5 },
];
