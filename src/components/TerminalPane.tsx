import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { api } from '../lib/api.ts';
import { type SelectAnchor, TextSelectSheet, writeClipboard } from './TextSelectSheet.tsx';
import { getTerminalTheme } from '../lib/terminalThemes.ts';
import type {
  ConnectionState,
  HostKeyPrompt,
  KeyboardMode,
  TerminalSession,
} from '../types/index.ts';

export interface TerminalPaneHandle {
  sendData: (data: string) => void;
  focusTerminal: (allowNativeKeyboard?: boolean) => void;
  fit: () => void;
  toggleSearch: () => void;
  reconnect: () => void;
  respondHostKey: (accept: boolean) => void;
  /** Open the touch-friendly text selection sheet */
  openSelect: () => void;
  /** Paste from the clipboard (multi-line pastes ask first) */
  paste: () => void;
}

interface TerminalPaneProps {
  session: TerminalSession;
  isActive: boolean;
  fontSize: number;
  terminalTheme: string;
  keyboardMode: KeyboardMode;
  onFontSizeChange: (nextSize: number) => void;
  onStatusChange: (
    sessionId: string,
    status: ConnectionState,
    extra?: { errorMessage?: string; reconnectAttempt?: number }
  ) => void;
  onHostKeyPrompt: (sessionId: string, prompt: HostKeyPrompt | null) => void;
  onSessionKey: (sessionId: string, sessionKey: string | undefined) => void;
  onToast: (message: string) => void;
}

export const TerminalPane = forwardRef<TerminalPaneHandle, TerminalPaneProps>(
  (
    {
      session,
      isActive,
      fontSize,
      terminalTheme,
      keyboardMode,
      onFontSizeChange,
      onStatusChange,
      onHostKeyPrompt,
      onSessionKey,
      onToast,
    },
    ref
  ) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const termRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const searchAddonRef = useRef<SearchAddon | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimerRef = useRef<number | null>(null);
    const reconnectAttemptRef = useRef(0);
    const manualCloseRef = useRef(false);
    // Server-side shell this tab is bound to, and how many output characters we've rendered.
    const sessionKeyRef = useRef<string | undefined>(session.sessionKey);
    const seqRef = useRef(0);
    const fontSizeRef = useRef(fontSize);
    fontSizeRef.current = fontSize;

    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [pasteSheetOpen, setPasteSheetOpen] = useState(false);
    const [manualPasteText, setManualPasteText] = useState('');
    // true when the paste sheet is confirming a multi-line clipboard paste
    const [pasteNeedsConfirm, setPasteNeedsConfirm] = useState(false);
    const [selectOpen, setSelectOpen] = useState(false);
    const [selectAnchor, setSelectAnchor] = useState<SelectAnchor | null>(null);

    // Touch pinch-to-zoom & long-press-to-paste state
    const pinchStartDistRef = useRef<number | null>(null);
    const pinchStartSizeRef = useRef<number>(fontSize);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

    const syncTextareaInputMode = useCallback(
      (mode: KeyboardMode) => {
        const textarea = containerRef.current?.querySelector(
          '.xterm-helper-textarea'
        ) as HTMLTextAreaElement | null;
        if (!textarea) return;
        textarea.setAttribute('autocomplete', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('spellcheck', 'false');
        if (mode === 'native') {
          textarea.removeAttribute('inputmode');
          textarea.inputMode = 'text';
        } else {
          textarea.setAttribute('inputmode', 'none');
          textarea.inputMode = 'none';
        }
      },
      []
    );

    const sendRaw = useCallback((data: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    }, []);

    const fitAndResize = useCallback(() => {
      const fitAddon = fitAddonRef.current;
      const term = termRef.current;
      if (!fitAddon || !term) return;
      try {
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {
        // container hidden or zero-sized
      }
    }, []);

    const clearReconnectTimer = useCallback(() => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    }, []);

    const connectSocket = useCallback(async () => {
      clearReconnectTimer();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // ignore
        }
        wsRef.current = null;
      }

      const term = termRef.current;
      onStatusChange(session.id, 'connecting', {
        errorMessage: undefined,
        reconnectAttempt: reconnectAttemptRef.current,
      });

      let ticket = '';
      try {
        const res = await api.issueWsTicket();
        ticket = res.ticket;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to authenticate WebSocket.';
        onStatusChange(session.id, 'error', { errorMessage: msg });
        term?.writeln(`\r\n\x1b[31m[xlab-bash] ${msg}\x1b[0m`);
        return;
      }

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws/ssh?ticket=${encodeURIComponent(ticket)}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      let hadConnected = false;
      let hadTerminalError = false;
      let heartbeat: number | null = null;

      let sessionEnded = false; // remote shell exited / taken over: don't reconnect

      const sendConnect = (): boolean => {
        const cols = termRef.current?.cols || 80;
        const rows = termRef.current?.rows || 24;
        if (session.hostId) {
          ws.send(JSON.stringify({ type: 'connect', hostId: session.hostId, cols, rows }));
          return true;
        }
        if (session.quickTarget) {
          ws.send(
            JSON.stringify({
              type: 'connect',
              host: session.quickTarget.host,
              port: session.quickTarget.port,
              username: session.quickTarget.username,
              authType: session.quickTarget.authType,
              password: session.quickTarget.password,
              privateKey: session.quickTarget.privateKey,
              passphrase: session.quickTarget.passphrase,
              label: session.title,
              cols,
              rows,
            })
          );
          return true;
        }
        return false;
      };

      ws.onopen = () => {
        const cols = termRef.current?.cols || 80;
        const rows = termRef.current?.rows || 24;

        if (sessionKeyRef.current) {
          // Re-attach to the shell that kept running on the server
          ws.send(
            JSON.stringify({
              type: 'attach',
              sessionKey: sessionKeyRef.current,
              since: seqRef.current,
              cols,
              rows,
            })
          );
        } else {
          sendConnect();
        }

        heartbeat = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25_000);
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (msg.type === 'data' && typeof msg.data === 'string') {
          termRef.current?.write(msg.data);
          if (typeof msg.seq === 'number') seqRef.current = msg.seq;
          return;
        }

        if (msg.type === 'session' && typeof msg.sessionKey === 'string') {
          sessionKeyRef.current = msg.sessionKey;
          onSessionKey(session.id, msg.sessionKey);
          if (msg.resumed) {
            hadConnected = true;
          }
          return;
        }

        if (msg.type === 'session-expired') {
          sessionKeyRef.current = undefined;
          seqRef.current = 0;
          onSessionKey(session.id, undefined);
          if (sendConnect()) {
            termRef.current?.writeln(
              `\r\n\x1b[33m[xlab-bash] The previous shell has ended. Starting a new one...\x1b[0m`
            );
          } else {
            hadTerminalError = true;
            const text = 'This session has ended on the server. Close the tab and connect again.';
            onStatusChange(session.id, 'error', { errorMessage: text });
            termRef.current?.writeln(`\r\n\x1b[31m[xlab-bash] ${text}\x1b[0m`);
            ws.close();
          }
          return;
        }

        if (msg.type === 'status') {
          if (msg.status === 'connected') {
            hadConnected = true;
            reconnectAttemptRef.current = 0;
            onHostKeyPrompt(session.id, null);
            onStatusChange(session.id, 'connected', {
              errorMessage: undefined,
              reconnectAttempt: 0,
            });
            window.setTimeout(fitAndResize, 60);
          } else if (msg.status === 'connecting' && typeof msg.message === 'string') {
            termRef.current?.writeln(`\x1b[90m${msg.message}\x1b[0m`);
          }
          return;
        }

        if (msg.type === 'hostkey') {
          onStatusChange(session.id, 'verifying');
          onHostKeyPrompt(session.id, {
            host: String(msg.host || ''),
            port: Number(msg.port || 22),
            fingerprint: String(msg.fingerprint || ''),
            status: msg.status === 'changed' ? 'changed' : 'new',
            previousFingerprint:
              typeof msg.previousFingerprint === 'string' ? msg.previousFingerprint : null,
          });
          return;
        }

        if (msg.type === 'error') {
          hadTerminalError = true;
          const errorText = String(msg.message || 'SSH connection error');
          onHostKeyPrompt(session.id, null);
          onStatusChange(session.id, 'error', { errorMessage: errorText });
          termRef.current?.writeln(`\r\n\x1b[31m[SSH Error] ${errorText}\x1b[0m`);
          return;
        }

        if (msg.type === 'closed') {
          const reason = String(msg.message || 'Connection closed.');
          termRef.current?.writeln(`\r\n\x1b[33m[Session Closed] ${reason}\x1b[0m`);
          if (msg.final || msg.taken) {
            sessionEnded = true;
            if (msg.final) {
              sessionKeyRef.current = undefined;
              onSessionKey(session.id, undefined);
            }
          }
        }
      };

      ws.onclose = () => {
        if (heartbeat !== null) {
          window.clearInterval(heartbeat);
          heartbeat = null;
        }
        onHostKeyPrompt(session.id, null);

        if (manualCloseRef.current) return;

        // Auto-reconnect on unexpected drops; the shell is still running on the server
        // and is re-attached with everything it printed in the meantime.
        if (!sessionEnded && !hadTerminalError && (hadConnected || sessionKeyRef.current)) {
          const attempt = reconnectAttemptRef.current + 1;
          reconnectAttemptRef.current = attempt;
          const delayMs = Math.min(12_000, 1500 * Math.pow(1.6, attempt - 1));
          onStatusChange(session.id, 'reconnecting', { reconnectAttempt: attempt });
          termRef.current?.writeln(
            `\r\n\x1b[33m[xlab-bash] Connection dropped. Reconnecting in ${(delayMs / 1000).toFixed(1)}s (attempt ${attempt})...\x1b[0m`
          );
          reconnectTimerRef.current = window.setTimeout(() => {
            if (!manualCloseRef.current) {
              connectSocket();
            }
          }, delayMs);
        } else if (!hadTerminalError) {
          onStatusChange(session.id, 'disconnected');
        }
      };
    }, [clearReconnectTimer, fitAndResize, onHostKeyPrompt, onSessionKey, onStatusChange, session]);

    // Mount xterm.js instance once per session
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: 'block',
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: fontSizeRef.current,
        fontWeight: '500',
        fontWeightBold: '700',
        letterSpacing: 0.2,
        lineHeight: 1.24,
        scrollback: 10_000,
        convertEol: false,
        allowProposedApi: true,
        theme: getTerminalTheme(terminalTheme),
      });

      const fitAddon = new FitAddon();
      const searchAddon = new SearchAddon();
      const webLinksAddon = new WebLinksAddon();

      term.loadAddon(fitAddon);
      term.loadAddon(searchAddon);
      term.loadAddon(webLinksAddon);

      term.open(container);
      fitAddon.fit();

      termRef.current = term;
      fitAddonRef.current = fitAddon;
      searchAddonRef.current = searchAddon;

      syncTextareaInputMode(keyboardMode);

      const dataDisp = term.onData((data) => {
        sendRaw(data);
      });

      // Copy on select
      const selDisp = term.onSelectionChange(() => {
        const selected = term.getSelection();
        if (selected && selected.length > 0) {
          writeClipboard(selected).then((ok) => {
            if (ok) onToast('Copied selection');
          });
        }
      });

      // Desktop shortcuts: Ctrl+Shift+C copies the selection, Ctrl+Shift+V pastes
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== 'keydown' || !ev.ctrlKey || !ev.shiftKey) return true;
        const key = ev.key.toLowerCase();
        if (key === 'c') {
          const selected = term.getSelection();
          if (selected) {
            writeClipboard(selected).then((ok) => ok && onToast('Copied selection'));
          }
          ev.preventDefault();
          return false;
        }
        if (key === 'v') {
          ev.preventDefault();
          pasteRef.current();
          return false;
        }
        return true;
      });

      // Resize observer for viewport / orientation / keyboard open-close
      const ro = new ResizeObserver(() => {
        fitAndResize();
      });
      ro.observe(container);

      const onWindowResize = () => fitAndResize();
      window.addEventListener('resize', onWindowResize);
      window.addEventListener('orientationchange', onWindowResize);
      window.visualViewport?.addEventListener('resize', onWindowResize);

      manualCloseRef.current = false;
      connectSocket();

      return () => {
        manualCloseRef.current = true;
        clearReconnectTimer();
        ro.disconnect();
        window.removeEventListener('resize', onWindowResize);
        window.removeEventListener('orientationchange', onWindowResize);
        window.visualViewport?.removeEventListener('resize', onWindowResize);
        dataDisp.dispose();
        selDisp.dispose();
        if (wsRef.current) {
          try {
            // Tab closed on purpose: end the shell instead of leaving it running
            if (wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'close' }));
            }
            wsRef.current.close();
          } catch {
            // ignore
          }
          wsRef.current = null;
        }
        term.dispose();
        termRef.current = null;
        fitAddonRef.current = null;
        searchAddonRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.id]);

    // Phone woke up / network came back: re-attach right away instead of waiting
    // for the backoff timer (the shell kept running on the server).
    useEffect(() => {
      const kick = () => {
        if (document.visibilityState !== 'visible' || manualCloseRef.current) return;
        const ws = wsRef.current;
        const dead = !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING;
        if (dead && (reconnectTimerRef.current !== null || sessionKeyRef.current)) {
          reconnectAttemptRef.current = 0;
          connectSocket();
        }
      };
      document.addEventListener('visibilitychange', kick);
      window.addEventListener('online', kick);
      return () => {
        document.removeEventListener('visibilitychange', kick);
        window.removeEventListener('online', kick);
      };
    }, [connectSocket]);

    // Sync fontSize updates
    useEffect(() => {
      const term = termRef.current;
      if (!term) return;
      term.options.fontSize = fontSize;
      fitAndResize();
    }, [fontSize, fitAndResize]);

    // Sync Fish / OLED color theme live
    useEffect(() => {
      const term = termRef.current;
      if (!term) return;
      term.options.theme = getTerminalTheme(terminalTheme);
    }, [terminalTheme]);

    // Sync keyboard mode inputmode="none" vs native
    useEffect(() => {
      syncTextareaInputMode(keyboardMode);
      if (isActive) {
        window.setTimeout(fitAndResize, 60);
      }
    }, [keyboardMode, isActive, syncTextareaInputMode, fitAndResize]);

    // Refit whenever tab becomes active
    useEffect(() => {
      if (isActive) {
        window.setTimeout(fitAndResize, 40);
      }
    }, [isActive, fitAndResize]);

    useImperativeHandle(
      ref,
      () => ({
        sendData: (data: string) => sendRaw(data),
        focusTerminal: (allowNativeKeyboard = false) => {
          syncTextareaInputMode(allowNativeKeyboard ? 'native' : keyboardMode);
          termRef.current?.focus();
        },
        fit: fitAndResize,
        toggleSearch: () => setSearchOpen((prev) => !prev),
        reconnect: () => {
          reconnectAttemptRef.current = 0;
          connectSocket();
        },
        openSelect: () => openSelectAt(),
        paste: () => triggerPaste(),
        respondHostKey: (accept: boolean) => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'hostkey:decision', accept }));
          }
          onHostKeyPrompt(session.id, null);
        },
      }),
      [
        connectSocket,
        fitAndResize,
        keyboardMode,
        onHostKeyPrompt,
        openSelectAt,
        sendRaw,
        session.id,
        syncTextareaInputMode,
        triggerPaste,
      ]
    );

    // Paste goes through xterm's paste() so bracketed-paste mode and line
    // endings are handled like a desktop terminal. Multi-line text could run
    // several commands at once, so it's shown for review first.
    const pasteText = useCallback(
      (text: string, confirmed = false) => {
        if (!text) return;
        if (!confirmed && /[\r\n]/.test(text.replace(/[\r\n]+$/, ''))) {
          setManualPasteText(text);
          setPasteNeedsConfirm(true);
          setPasteSheetOpen(true);
          return;
        }
        const term = termRef.current;
        if (term) {
          term.paste(text);
        } else {
          sendRaw(text);
        }
        onToast('Pasted');
      },
      [onToast, sendRaw]
    );

    const triggerPaste = useCallback(async () => {
      try {
        if (navigator.clipboard?.readText) {
          const text = await navigator.clipboard.readText();
          if (text) {
            pasteText(text);
            return;
          }
        }
      } catch {
        // Clipboard read blocked (plain HTTP or permission denied): use the paste sheet
      }
      setManualPasteText('');
      setPasteNeedsConfirm(false);
      setPasteSheetOpen(true);
    }, [pasteText]);

    const pasteRef = useRef(triggerPaste);
    pasteRef.current = triggerPaste;

    /** Open selection mode, optionally at the screen point the user long-pressed. */
    const openSelectAt = useCallback((clientX?: number, clientY?: number) => {
      const term = termRef.current;
      if (!term) return;
      let anchor: SelectAnchor | null = null;
      const screen = containerRef.current?.querySelector('.xterm-screen') as HTMLElement | null;
      if (screen && clientX !== undefined && clientY !== undefined) {
        const rect = screen.getBoundingClientRect();
        const cellH = rect.height / term.rows;
        const cellW = rect.width / term.cols;
        const rowInView = Math.floor((clientY - rect.top) / cellH);
        const col = Math.floor((clientX - rect.left) / cellW);
        if (rowInView >= 0 && rowInView < term.rows && col >= 0) {
          anchor = { row: term.buffer.active.viewportY + rowInView, col: Math.min(col, term.cols - 1) };
        }
      }
      term.blur();
      setSelectAnchor(anchor);
      setSelectOpen(true);
    }, []);

    const clearLongPress = () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      longPressStartRef.current = null;
    };

    const handleTouchStart = (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        clearLongPress();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDistRef.current = Math.hypot(dx, dy);
        pinchStartSizeRef.current = fontSizeRef.current;
        return;
      }

      if (e.touches.length === 1) {
        pinchStartDistRef.current = null;
        const t = e.touches[0];
        longPressStartRef.current = { x: t.clientX, y: t.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
          if (navigator.vibrate) {
            try {
              navigator.vibrate(18);
            } catch {
              // ignore
            }
          }
          // Long-press works like any phone app: select the word under the finger
          const start = longPressStartRef.current;
          openSelectAt(start?.x, start?.y);
        }, 500);
      }
    };

    const handleTouchMove = (e: React.TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const ratio = dist / pinchStartDistRef.current;
        const nextSize = Math.min(26, Math.max(9, Math.round(pinchStartSizeRef.current * ratio)));
        if (nextSize !== fontSizeRef.current) {
          onFontSizeChange(nextSize);
        }
        return;
      }

      if (e.touches.length === 1 && longPressStartRef.current) {
        const t = e.touches[0];
        const moved = Math.hypot(
          t.clientX - longPressStartRef.current.x,
          t.clientY - longPressStartRef.current.y
        );
        if (moved > 10) {
          clearLongPress();
        }
      }
    };

    const handleTouchEnd = () => {
      pinchStartDistRef.current = null;
      clearLongPress();
    };

    const handleSearchNext = () => {
      if (searchQuery) searchAddonRef.current?.findNext(searchQuery);
    };
    const handleSearchPrev = () => {
      if (searchQuery) searchAddonRef.current?.findPrevious(searchQuery);
    };

    return (
      <div
        className={`relative flex-1 min-h-0 w-full bg-black ${isActive ? 'flex flex-col' : 'hidden'}`}
      >
        {/* Search Overlay */}
        {searchOpen && (
          <div className="absolute top-2 right-2 z-30 flex items-center gap-1 rounded-xl border border-zinc-700 bg-zinc-950/95 px-2.5 py-1.5 shadow-xl">
            <Search className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value) {
                  searchAddonRef.current?.findNext(e.target.value);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.shiftKey ? handleSearchPrev() : handleSearchNext();
                } else if (e.key === 'Escape') {
                  setSearchOpen(false);
                }
              }}
              placeholder="Find in terminal..."
              className="w-36 sm:w-48 bg-transparent text-xs font-mono-term text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSearchPrev}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              aria-label="Previous match"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleSearchNext}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              aria-label="Next match"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              aria-label="Close search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Reconnect / Error Floating Bar */}
        {(session.status === 'reconnecting' ||
          session.status === 'disconnected' ||
          session.status === 'error') && (
          <div className="z-20 flex items-center justify-between gap-3 px-3 py-2 bg-zinc-950 border-b border-zinc-800 text-xs">
            <span className="text-zinc-300 truncate">
              {session.status === 'reconnecting'
                ? `Reconnecting (attempt ${session.reconnectAttempt})...`
                : session.errorMessage || 'Session disconnected'}
            </span>
            <button
              type="button"
              onClick={() => {
                reconnectAttemptRef.current = 0;
                connectSocket();
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md btn-accent font-semibold shrink-0 transition"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Reconnect</span>
            </button>
          </div>
        )}

        {/* xterm.js pure black viewport */}
        <div
          ref={containerRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onClick={() => {
            syncTextareaInputMode(keyboardMode);
            if (keyboardMode === 'native') {
              termRef.current?.focus();
            }
          }}
          className="flex-1 min-h-0 w-full bg-black overflow-hidden"
        />

        {/* Touch-friendly text selection (native phone selection handles) */}
        {selectOpen && termRef.current && (
          <TextSelectSheet
            term={termRef.current}
            fontSize={fontSize}
            anchor={selectAnchor}
            onClose={() => {
              setSelectOpen(false);
              setSelectAnchor(null);
            }}
            onPaste={triggerPaste}
            onSendText={(text) => pasteText(text, true)}
            onToast={onToast}
          />
        )}

        {/* Fallback Paste Modal when browser blocks navigator.clipboard.readText() */}
        {pasteSheetOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                  <ClipboardPaste className="w-4 h-4 text-accent" />
                  <span>{pasteNeedsConfirm ? 'Paste multiple lines?' : 'Paste into Terminal'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPasteSheetOpen(false);
                    setPasteNeedsConfirm(false);
                  }}
                  className="p-1 text-zinc-400 hover:text-zinc-100"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {pasteNeedsConfirm && (
                <p className="mt-2 text-xs text-amber-400/90">
                  This text has {manualPasteText.split(/\r\n|\r|\n/).length} lines and may run several
                  commands. Check it, edit if needed, then send.
                </p>
              )}
              <textarea
                autoFocus={!pasteNeedsConfirm}
                rows={pasteNeedsConfirm ? 7 : 4}
                value={manualPasteText}
                onChange={(e) => setManualPasteText(e.target.value)}
                placeholder="Long-press here and tap Paste..."
                className="mt-3 w-full rounded-xl border border-zinc-800 bg-black p-3 text-xs font-mono-term text-zinc-100 placeholder:text-zinc-600 focus-accent"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPasteSheetOpen(false);
                    setPasteNeedsConfirm(false);
                  }}
                  className="h-9 px-3.5 rounded-lg border border-zinc-800 text-xs text-zinc-300 hover:bg-zinc-900"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (manualPasteText) {
                      pasteText(manualPasteText, true);
                    }
                    setPasteSheetOpen(false);
                    setPasteNeedsConfirm(false);
                  }}
                  className="h-9 px-4 rounded-lg btn-accent text-xs font-semibold transition"
                >
                  Send to Shell
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

TerminalPane.displayName = 'TerminalPane';
