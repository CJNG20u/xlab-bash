import type { Terminal } from '@xterm/xterm';
import { Check, ClipboardPaste, Copy, CornerDownLeft, X } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/*
 * Mobile text selection for the terminal.
 *
 * xterm.js draws on a canvas, so the phone can't select its text natively.
 * This sheet shows the same buffer as real DOM text, so Android/iOS give you
 * their own long-press selection: drag handles, magnifier, word snapping and
 * the system Copy menu. Wrapped rows are joined back into their logical line
 * so long commands and URLs copy in one piece.
 */

const MAX_LINES = 5000;

export interface SelectAnchor {
  /** Absolute buffer row (scrollback included) the user long-pressed */
  row: number;
  /** Column within that row */
  col: number;
}

interface LogicalLine {
  text: string;
  /** First absolute buffer row of this line (for mapping a press position) */
  startRow: number;
}

function readBuffer(term: Terminal): LogicalLine[] {
  const buf = term.buffer.active;
  const lines: LogicalLine[] = [];
  const first = Math.max(0, buf.length - MAX_LINES * 2);
  for (let y = first; y < buf.length; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    // A row that wraps into the next one keeps its trailing spaces (they're real text)
    const wrapsOn = buf.getLine(y + 1)?.isWrapped ?? false;
    const text = line.translateToString(!wrapsOn);
    if (line.isWrapped && lines.length > 0) {
      lines[lines.length - 1].text += text;
    } else {
      lines.push({ text, startRow: y });
    }
  }
  // Drop the empty rows below the prompt
  while (lines.length > 1 && lines[lines.length - 1].text.trim() === '') lines.pop();
  return lines.slice(-MAX_LINES);
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand
  }
  // Plain-HTTP fallback: copy via a temporary textarea
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export { writeClipboard };

interface TextSelectSheetProps {
  term: Terminal;
  fontSize: number;
  anchor: SelectAnchor | null;
  onClose: () => void;
  onPaste: () => void;
  /** Type text into the shell (no Enter) */
  onSendText: (text: string) => void;
  onToast: (message: string) => void;
}

export const TextSelectSheet: React.FC<TextSelectSheetProps> = ({
  term,
  fontSize,
  anchor,
  onClose,
  onPaste,
  onSendText,
  onToast,
}) => {
  const lines = useMemo(() => readBuffer(term), [term]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [selection, setSelection] = useState('');
  const [copied, setCopied] = useState(false);

  // Which logical line / character the long-press landed on
  const anchorTarget = useMemo(() => {
    if (!anchor) return null;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startRow <= anchor.row) idx = i;
      else break;
    }
    if (idx < 0) return null;
    const offset = (anchor.row - lines[idx].startRow) * term.cols + anchor.col;
    return { idx, offset };
  }, [anchor, lines, term.cols]);

  // Start at the pressed line (or the bottom) and pre-select the word under the finger
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (!anchorTarget) {
      scroller.scrollTop = scroller.scrollHeight;
      return;
    }
    const el = lineRefs.current[anchorTarget.idx];
    if (!el) return;
    el.scrollIntoView({ block: 'center' });

    const text = lines[anchorTarget.idx].text;
    const at = Math.min(anchorTarget.offset, Math.max(0, text.length - 1));
    if (!text.trim()) return;
    const isWordChar = (c: string) => /[^\s"'`()<>[\]{}|;,]/.test(c);
    if (!isWordChar(text[at] || ' ')) return;
    let start = at;
    let end = at + 1;
    while (start > 0 && isWordChar(text[start - 1])) start--;
    while (end < text.length && isWordChar(text[end])) end++;
    const node = el.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [anchorTarget, lines]);

  // Track what's selected inside the sheet
  useEffect(() => {
    const onSel = () => {
      const sel = window.getSelection();
      const scroller = scrollRef.current;
      if (!sel || !scroller || sel.rangeCount === 0 || !scroller.contains(sel.anchorNode)) {
        setSelection('');
        return;
      }
      setSelection(sel.toString());
    };
    document.addEventListener('selectionchange', onSel);
    onSel();
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const close = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const copy = async (text: string, label: string) => {
    if (!text) return;
    const ok = await writeClipboard(text);
    if (ok) {
      if (navigator.vibrate) {
        try {
          navigator.vibrate(12);
        } catch {
          // ignore
        }
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
      onToast(label);
    } else {
      onToast('Copy blocked by the browser — use the phone’s own Copy button');
    }
  };

  const visibleText = () => {
    const buf = term.buffer.active;
    const out: string[] = [];
    for (let y = buf.viewportY; y < buf.viewportY + term.rows; y++) {
      out.push(buf.getLine(y)?.translateToString(true) ?? '');
    }
    return out.join('\n').replace(/\s+$/, '');
  };

  const btn =
    'h-9 px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 shrink-0 transition disabled:opacity-40';

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-black" role="dialog" aria-label="Select text">
      {/* Action bar */}
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-b border-zinc-800 bg-[#09090b] overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={close}
          className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900"
          aria-label="Back to terminal"
        >
          <X className="w-4 h-4" />
        </button>
        <button
          type="button"
          disabled={!selection}
          onClick={() => copy(selection, `Copied ${selection.length} characters`)}
          className={`${btn} btn-accent-soft`}
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          Copy
        </button>
        <button
          type="button"
          disabled={!selection}
          onClick={() => {
            onSendText(selection.replace(/\n+$/, ''));
            close();
          }}
          className={`${btn} border-zinc-800 text-zinc-200 hover:bg-zinc-900`}
          title="Type the selection into the shell (without Enter)"
        >
          <CornerDownLeft className="w-3.5 h-3.5" />
          Insert
        </button>
        <button
          type="button"
          onClick={() => copy(visibleText(), 'Copied screen')}
          className={`${btn} border-zinc-800 text-zinc-200 hover:bg-zinc-900`}
        >
          Copy screen
        </button>
        <button
          type="button"
          onClick={() => copy(lines.map((l) => l.text.replace(/\s+$/, '')).join('\n'), 'Copied all output')}
          className={`${btn} border-zinc-800 text-zinc-200 hover:bg-zinc-900`}
        >
          Copy all
        </button>
        <button
          type="button"
          onClick={() => {
            close();
            onPaste();
          }}
          className={`${btn} border-zinc-800 text-zinc-200 hover:bg-zinc-900`}
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          Paste
        </button>
      </div>

      <div className="shrink-0 px-3 py-1 text-[11px] text-zinc-500 inline-flex items-center gap-1.5 border-b border-zinc-900">
        {selection
          ? `${selection.length} characters selected`
          : 'Long-press a word, then drag the handles to select'}
      </div>

      {/* Selectable copy of the terminal buffer */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto px-2 py-1 select-text"
        style={{
          fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: `${fontSize}px`,
          lineHeight: 1.24,
          WebkitUserSelect: 'text',
          userSelect: 'text',
          WebkitTouchCallout: 'default',
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            ref={(el) => {
              lineRefs.current[i] = el;
            }}
            className="whitespace-pre-wrap break-all text-zinc-200 min-h-[1.24em]"
          >
            {line.text || '​'}
          </div>
        ))}
      </div>
    </div>
  );
};
