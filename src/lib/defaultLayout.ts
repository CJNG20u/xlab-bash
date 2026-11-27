import type { AppSettings, KeyboardLayoutData, QuickBarItem } from '../types/index.ts';

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
  keyboardHeight: 288,
  keyboardMode: 'dev',
  hapticEnabled: true,
  showKeyPreview: true,
  activeLayoutId: 'default-pc-6row',
  quickBarItems: DEFAULT_QUICK_BAR_ITEMS,
};

/**
 * Primary 4-row mobile developer keyboard (numbers & symbols live in the dedicated `123` button).
 */
export const DEFAULT_PC_6ROW_LAYOUT: KeyboardLayoutData = {
  rows: [
    {
      id: 'row-qwerty',
      keys: [
        { id: 'k-tab', label: 'Tab', code: 'Tab', kind: 'special', width: 1.25 },
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
        { id: 'k-bksp', label: '⌫', code: 'Backspace', kind: 'special', width: 1.4, repeatable: true },
      ],
    },
    {
      id: 'row-asdf',
      keys: [
        { id: 'k-ctrl', label: 'Ctrl', code: 'ControlLeft', kind: 'modifier', modifier: 'ctrl', width: 1.45 },
        { id: 'k-a', label: 'a', shiftLabel: 'A', code: 'KeyA', kind: 'char' },
        { id: 'k-s', label: 's', shiftLabel: 'S', code: 'KeyS', kind: 'char' },
        { id: 'k-d', label: 'd', shiftLabel: 'D', code: 'KeyD', kind: 'char' },
        { id: 'k-f', label: 'f', shiftLabel: 'F', code: 'KeyF', kind: 'char' },
        { id: 'k-g', label: 'g', shiftLabel: 'G', code: 'KeyG', kind: 'char' },
        { id: 'k-h', label: 'h', shiftLabel: 'H', code: 'KeyH', kind: 'char' },
        { id: 'k-j', label: 'j', shiftLabel: 'J', code: 'KeyJ', kind: 'char' },
        { id: 'k-k', label: 'k', shiftLabel: 'K', code: 'KeyK', kind: 'char' },
        { id: 'k-l', label: 'l', shiftLabel: 'L', code: 'KeyL', kind: 'char' },
        { id: 'k-enter', label: '↵', code: 'Enter', kind: 'special', width: 1.65 },
      ],
    },
    {
      id: 'row-zxcv',
      keys: [
        { id: 'k-shift-l', label: '⇧', code: 'ShiftLeft', kind: 'modifier', modifier: 'shift', width: 1.4 },
        { id: 'k-z', label: 'z', shiftLabel: 'Z', code: 'KeyZ', kind: 'char' },
        { id: 'k-x', label: 'x', shiftLabel: 'X', code: 'KeyX', kind: 'char' },
        { id: 'k-c', label: 'c', shiftLabel: 'C', code: 'KeyC', kind: 'char' },
        { id: 'k-v', label: 'v', shiftLabel: 'V', code: 'KeyV', kind: 'char' },
        { id: 'k-b', label: 'b', shiftLabel: 'B', code: 'KeyB', kind: 'char' },
        { id: 'k-n', label: 'n', shiftLabel: 'N', code: 'KeyN', kind: 'char' },
        { id: 'k-m', label: 'm', shiftLabel: 'M', code: 'KeyM', kind: 'char' },
        { id: 'k-comma', label: ',', shiftLabel: '<', code: 'Comma', kind: 'char' },
        { id: 'k-dot', label: '.', shiftLabel: '>', code: 'Period', kind: 'char' },
        { id: 'k-slash', label: '/', shiftLabel: '?', code: 'Slash', kind: 'char' },
        { id: 'k-up', label: '↑', code: 'ArrowUp', kind: 'special', repeatable: true },
        { id: 'k-shift-r', label: '⇧', code: 'ShiftRight', kind: 'modifier', modifier: 'shift', width: 1.25 },
      ],
    },
    {
      id: 'row-bottom',
      keys: [
        { id: 'k-num-toggle', label: '123', code: 'FnToggle', kind: 'fn_toggle', width: 1.45 },
        { id: 'k-alt', label: 'Alt', code: 'AltLeft', kind: 'modifier', modifier: 'alt', width: 1.15 },
        { id: 'k-space', label: 'Space', code: 'Space', kind: 'space', width: 3.3, repeatable: true },
        { id: 'k-home', label: 'Home', code: 'Home', kind: 'special', width: 1.1 },
        { id: 'k-end', label: 'End', code: 'End', kind: 'special', width: 1.05 },
        { id: 'k-left', label: '←', code: 'ArrowLeft', kind: 'special', repeatable: true },
        { id: 'k-down', label: '↓', code: 'ArrowDown', kind: 'special', repeatable: true },
        { id: 'k-right', label: '→', code: 'ArrowRight', kind: 'special', repeatable: true },
        { id: 'k-pgup', label: 'PgU', code: 'PageUp', kind: 'special', width: 1.05 },
        { id: 'k-pgdn', label: 'PgD', code: 'PageDown', kind: 'special', width: 1.05 },
      ],
    },
  ],
};

/**
 * Dedicated Numbers & Symbols layer toggled via the `123` / `ABC` button.
 */
export const NUMBERS_LAYER_LAYOUT: KeyboardLayoutData = {
  rows: [
    {
      id: 'num-row-1',
      keys: [
        { id: 'n-1', label: '1', shiftLabel: '!', code: 'Digit1', kind: 'char' },
        { id: 'n-2', label: '2', shiftLabel: '@', code: 'Digit2', kind: 'char' },
        { id: 'n-3', label: '3', shiftLabel: '#', code: 'Digit3', kind: 'char' },
        { id: 'n-4', label: '4', shiftLabel: '$', code: 'Digit4', kind: 'char' },
        { id: 'n-5', label: '5', shiftLabel: '%', code: 'Digit5', kind: 'char' },
        { id: 'n-6', label: '6', shiftLabel: '^', code: 'Digit6', kind: 'char' },
        { id: 'n-7', label: '7', shiftLabel: '&', code: 'Digit7', kind: 'char' },
        { id: 'n-8', label: '8', shiftLabel: '*', code: 'Digit8', kind: 'char' },
        { id: 'n-9', label: '9', shiftLabel: '(', code: 'Digit9', kind: 'char' },
        { id: 'n-0', label: '0', shiftLabel: ')', code: 'Digit0', kind: 'char' },
        { id: 'n-bksp', label: '⌫', code: 'Backspace', kind: 'special', width: 1.45, repeatable: true },
      ],
    },
    {
      id: 'num-row-2',
      keys: [
        { id: 'n-bang', label: '!', code: 'Exclam', kind: 'char' },
        { id: 'n-at', label: '@', code: 'At', kind: 'char' },
        { id: 'n-hash', label: '#', code: 'Hash', kind: 'char' },
        { id: 'n-dollar', label: '$', code: 'Dollar', kind: 'char' },
        { id: 'n-pct', label: '%', code: 'Percent', kind: 'char' },
        { id: 'n-caret', label: '^', code: 'Caret', kind: 'char' },
        { id: 'n-amp', label: '&', code: 'Amp', kind: 'char' },
        { id: 'n-star', label: '*', code: 'Star', kind: 'char' },
        { id: 'n-lparen', label: '(', code: 'LParen', kind: 'char' },
        { id: 'n-rparen', label: ')', code: 'RParen', kind: 'char' },
        { id: 'n-minus', label: '-', shiftLabel: '_', code: 'Minus', kind: 'char' },
        { id: 'n-enter', label: '↵', code: 'Enter', kind: 'special', width: 1.45 },
      ],
    },
    {
      id: 'num-row-3',
      keys: [
        { id: 'n-grave', label: '`', code: 'Backquote', kind: 'char' },
        { id: 'n-tilde', label: '~', code: 'Tilde', kind: 'char' },
        { id: 'n-under', label: '_', code: 'Underscore', kind: 'char' },
        { id: 'n-eq', label: '=', code: 'Equal', kind: 'char' },
        { id: 'n-plus', label: '+', code: 'Plus', kind: 'char' },
        { id: 'n-lbr', label: '[', code: 'BracketLeft', kind: 'char' },
        { id: 'n-rbr', label: ']', code: 'BracketRight', kind: 'char' },
        { id: 'n-lbrace', label: '{', code: 'BraceLeft', kind: 'char' },
        { id: 'n-rbrace', label: '}', code: 'BraceRight', kind: 'char' },
        { id: 'n-bslash', label: '\\', code: 'Backslash', kind: 'char' },
        { id: 'n-pipe', label: '|', code: 'Pipe', kind: 'char' },
        { id: 'n-colon', label: ':', code: 'Colon', kind: 'char' },
        { id: 'n-dquote', label: '"', code: 'DoubleQuote', kind: 'char' },
      ],
    },
    {
      id: 'num-row-4',
      keys: [
        { id: 'n-abc-toggle', label: 'ABC', code: 'FnToggle', kind: 'fn_toggle', width: 1.45 },
        { id: 'n-ctrl', label: 'Ctrl', code: 'ControlLeft', kind: 'modifier', modifier: 'ctrl', width: 1.2 },
        { id: 'n-semi', label: ';', code: 'Semicolon', kind: 'char' },
        { id: 'n-quote', label: "'", code: 'Quote', kind: 'char' },
        { id: 'n-lt', label: '<', code: 'Less', kind: 'char' },
        { id: 'n-gt', label: '>', code: 'Greater', kind: 'char' },
        { id: 'n-qmark', label: '?', code: 'Question', kind: 'char' },
        { id: 'n-space', label: 'Space', code: 'Space', kind: 'space', width: 2.3, repeatable: true },
        { id: 'n-left', label: '←', code: 'ArrowLeft', kind: 'special', repeatable: true },
        { id: 'n-down', label: '↓', code: 'ArrowDown', kind: 'special', repeatable: true },
        { id: 'n-right', label: '→', code: 'ArrowRight', kind: 'special', repeatable: true },
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
