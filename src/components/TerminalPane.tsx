import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
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
import { writeClipboard } from '../lib/clipboard.ts';
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
  /** Paste from the clipboard */
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
    // true when the paste sheet is confirming a multi-line clipboard paste
    const paneRef = useRef<HTMLDivElement | null>(null);
    // Invisible text field slipped under the finger when you touch an empty spot,
    // so a long-press there gets Android's own "Paste" menu (works on plain HTTP too).
    const pasteCatcherRef = useRef<HTMLTextAreaElement | null>(null);
    // Transparent, cell-aligned text copy of the screen slipped under the finger when
    // you touch text, so a long-press there gets the phone's own selection + Copy.
    const selectLayerRef = useRef<HTMLDivElement | null>(null);

    // Touch pinch-to-zoom & long-press-to-paste state
    const pinchStartDistRef = useRef<number | null>(null);
    const pinchStartSizeRef = useRef<number>(fontSize);

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

      term?.writeln(
        `\x1b[36m[xlab-bash]\x1b[0m Connecting to \x1b[1m${session.subtitle || session.title}\x1b[0m...`
      );

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

      let wsOpened = false;
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
        wsOpened = true;
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
            termRef.current?.writeln(`\x1b[38;5;248m${msg.message}\x1b[0m`);
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

      ws.onerror = () => {
        // Detailed error handling happens in onclose right after onerror.
      };

      ws.onclose = (ev) => {
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
        } else if (!wsOpened && !hadTerminalError) {
          const msg = `WebSocket connection to backend failed (code ${ev.code || 1006}). Reload or tap Reconnect.`;
          onStatusChange(session.id, 'error', { errorMessage: msg });
          termRef.current?.writeln(`\r\n\x1b[31m[xlab-bash] ${msg}\x1b[0m`);
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
      window.requestAnimationFrame(() => fitAndResize());

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

    // On touch screens a long-press also fires "contextmenu"; xterm would answer it by
    // focusing its hidden textarea, which steals the long-press from our copy/paste layers.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const onContextMenu = (e: Event) => {
        const pointerType = (e as PointerEvent).pointerType;
        if (pointerType === 'touch' || pointerType === 'pen' || window.matchMedia('(pointer: coarse)').matches) {
          e.stopPropagation(); // not preventDefault: the phone still shows its own menu
        }
      };
      container.addEventListener('contextmenu', onContextMenu, true);
      return () => container.removeEventListener('contextmenu', onContextMenu, true);
    }, []);

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

    // Paste goes through xterm's paste() so bracketed-paste mode and line
    // endings are handled like a desktop terminal (modern bash/zsh won't run
    // a multi-line paste until you press Enter).
    const pasteText = useCallback(
      (text: string) => {
        if (!text) return;
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
        // Clipboard read blocked (plain HTTP or permission denied)
      }
      onToast('Long-press an empty spot in the terminal and tap Paste');
    }, [onToast, pasteText]);

    const pasteTextRef = useRef(pasteText);
    pasteTextRef.current = pasteText;
    const onToastRef = useRef(onToast);
    onToastRef.current = onToast;
    const pasteRef = useRef(triggerPaste);
    pasteRef.current = triggerPaste;

    // Long-press = phone-native copy / paste, with no extra screens:
    //  - finger on text: a transparent text copy of the screen (aligned cell by cell)
    //    is placed under it, so the phone's long-press selects real text with its own
    //    handles, magnifier and Copy menu
    //  - finger on an empty spot: an invisible text field is placed under it, so the
    //    phone shows its own "Paste" menu (works on plain HTTP too)
    // Both are placed synchronously on touchstart, before the browser decides what
    // the long-press hits, and removed again after a plain tap or scroll.
    useEffect(() => {
      const container = containerRef.current;
      const pane = paneRef.current;
      const catcher = pasteCatcherRef.current;
      const layer = selectLayerRef.current;
      if (!container || !pane || !catcher || !layer) return;

      let fingerDown = false;
      let touchStartedAt = 0;
      const measureCanvas = document.createElement('canvas');

      const hideCatcher = () => {
        catcher.style.display = 'none';
        catcher.value = '';
      };
      const layerHasSelection = () => {
        const sel = window.getSelection();
        return Boolean(sel && !sel.isCollapsed && sel.anchorNode && layer.contains(sel.anchorNode));
      };
      const hideLayer = () => {
        if (layer.style.display === 'none') return;
        if (layerHasSelection()) window.getSelection()?.removeAllRanges();
        layer.style.display = 'none';
        layer.replaceChildren();
      };

      const grid = () => {
        const term = termRef.current;
        const screen = container.querySelector('.xterm-screen') as HTMLElement | null;
        if (!term || !screen) return null;
        const rect = screen.getBoundingClientRect();
        if (!rect.width || !rect.height) return null;
        return { term, rect, cellW: rect.width / term.cols, cellH: rect.height / term.rows };
      };

      const isBlankAt = (clientX: number, clientY: number): boolean => {
        const g = grid();
        if (!g) return false;
        const row = Math.floor((clientY - g.rect.top) / g.cellH);
        const col = Math.floor((clientX - g.rect.left) / g.cellW);
        if (row < 0 || col < 0 || row >= g.term.rows || col >= g.term.cols) return true;
        const line = g.term.buffer.active.getLine(g.term.buffer.active.viewportY + row);
        return (line?.getCell(col)?.getChars() ?? '').trim() === '';
      };

      const showLayer = () => {
        const g = grid();
        if (!g) return;
        const { term, rect, cellW, cellH } = g;
        const p = pane.getBoundingClientRect();
        const fontSize = term.options.fontSize ?? 14;
        const fontFamily = term.options.fontFamily ?? 'monospace';
        const fontWeight = String(term.options.fontWeight ?? 'normal');
        // Stretch each character to exactly one cell
        const ctx = measureCanvas.getContext('2d');
        let charW = cellW;
        if (ctx) {
          ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
          charW = ctx.measureText('W'.repeat(40)).width / 40;
        }
        Object.assign(layer.style, {
          display: 'block',
          left: `${rect.left - p.left}px`,
          top: `${rect.top - p.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          fontFamily,
          fontSize: `${fontSize}px`,
          fontWeight,
          letterSpacing: `${cellW - charW}px`,
          lineHeight: `${cellH}px`,
        });
        const buf = term.buffer.active;
        const rows: HTMLDivElement[] = [];
        for (let y = 0; y < term.rows; y++) {
          const line = buf.getLine(buf.viewportY + y);
          const div = document.createElement('div');
          div.style.height = `${cellH}px`;
          // Untrimmed so every character sits on its own cell
          div.textContent = line ? line.translateToString(false) : '';
          if (line?.isWrapped) div.dataset.wrapped = '1';
          rows.push(div);
        }
        layer.replaceChildren(...rows);
      };

      const onTouchStart = (e: TouchEvent) => {
        fingerDown = true;
        touchStartedAt = Date.now();
        if (e.touches.length !== 1) {
          if (document.activeElement !== catcher) hideCatcher();
          hideLayer();
          return;
        }
        const t = e.touches[0];
        const p = pane.getBoundingClientRect();
        if (isBlankAt(t.clientX, t.clientY)) {
          hideLayer();
          catcher.style.left = `${t.clientX - p.left - 28}px`;
          catcher.style.top = `${t.clientY - p.top - 28}px`;
          catcher.style.display = 'block';
        } else {
          if (document.activeElement !== catcher) hideCatcher();
          showLayer();
        }
      };

      // After a plain tap or a scroll, nothing may stay in the way. A quick tap is
      // cleared right away (before its click is delivered, so taps still reach the
      // terminal); after a long-press the phone's menu may be open, so wait for it.
      const onTouchEnd = (e: TouchEvent) => {
        if (e.touches.length > 0) return;
        fingerDown = false;
        const wasTap = Date.now() - touchStartedAt < 450;
        if (wasTap) {
          if (document.activeElement !== catcher) hideCatcher();
          if (!layerHasSelection()) hideLayer();
          return;
        }
        window.setTimeout(() => {
          if (!layerHasSelection()) hideLayer();
        }, 0);
      };

      // Selection cleared (tap elsewhere, Copy done): put the live terminal back
      const onSelectionChange = () => {
        if (!fingerDown && layer.style.display !== 'none' && !layerHasSelection()) hideLayer();
      };

      // Copy: wrapped rows join back into one line, trailing padding is trimmed
      const onCopy = (e: ClipboardEvent) => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const rowEls = Array.from(layer.children) as HTMLElement[];
        const parts: string[] = [];
        let any = false;
        rowEls.forEach((row, i) => {
          if (!range.intersectsNode(row)) return;
          const text = row.textContent || '';
          let start = 0;
          let end = text.length;
          if (row.contains(range.startContainer)) start = range.startOffset;
          if (row.contains(range.endContainer)) end = range.endOffset;
          let piece = text.slice(start, end);
          const nextWraps = rowEls[i + 1]?.dataset.wrapped === '1';
          if (!nextWraps) piece = piece.replace(/\s+$/, '');
          if (any && row.dataset.wrapped !== '1') parts.push('\n');
          parts.push(piece);
          any = true;
        });
        if (!any) return;
        e.preventDefault();
        e.clipboardData?.setData('text/plain', parts.join(''));
        onToastRef.current('Copied');
        window.setTimeout(hideLayer, 0);
      };

      const finishPaste = (text: string) => {
        if (text) pasteTextRef.current(text);
        catcher.blur();
        hideCatcher();
      };
      const onPaste = (e: ClipboardEvent) => {
        e.preventDefault();
        finishPaste(e.clipboardData?.getData('text/plain') || '');
      };
      // Keyboard clipboard chips (Gboard) insert text instead of firing paste
      const onInput = () => finishPaste(catcher.value);

      const opts = { capture: true, passive: true } as const;
      container.addEventListener('touchstart', onTouchStart, opts);
      container.addEventListener('touchend', onTouchEnd, opts);
      container.addEventListener('touchcancel', onTouchEnd, opts);
      layer.addEventListener('touchstart', onTouchStart, opts);
      layer.addEventListener('touchend', onTouchEnd, opts);
      layer.addEventListener('touchcancel', onTouchEnd, opts);
      layer.addEventListener('copy', onCopy);
      document.addEventListener('selectionchange', onSelectionChange);
      catcher.addEventListener('paste', onPaste);
      catcher.addEventListener('input', onInput);
      catcher.addEventListener('blur', hideCatcher);
      catcher.addEventListener('touchstart', onTouchStart, opts);
      catcher.addEventListener('touchend', onTouchEnd, opts);
      return () => {
        container.removeEventListener('touchstart', onTouchStart, true);
        container.removeEventListener('touchend', onTouchEnd, true);
        container.removeEventListener('touchcancel', onTouchEnd, true);
        layer.removeEventListener('touchstart', onTouchStart, true);
        layer.removeEventListener('touchend', onTouchEnd, true);
        layer.removeEventListener('touchcancel', onTouchEnd, true);
        layer.removeEventListener('copy', onCopy);
        document.removeEventListener('selectionchange', onSelectionChange);
        catcher.removeEventListener('paste', onPaste);
        catcher.removeEventListener('input', onInput);
        catcher.removeEventListener('blur', hideCatcher);
        catcher.removeEventListener('touchstart', onTouchStart, true);
        catcher.removeEventListener('touchend', onTouchEnd, true);
      };
    }, []);

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
        sendRaw,
        session.id,
        syncTextareaInputMode,
        triggerPaste,
      ]
    );

    // Two-finger pinch zooms the font
    const handleTouchStart = (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDistRef.current = Math.hypot(dx, dy);
        pinchStartSizeRef.current = fontSizeRef.current;
        return;
      }

      pinchStartDistRef.current = null;
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
      }
    };

    const handleTouchEnd = () => {
      pinchStartDistRef.current = null;
    };

    const handleSearchNext = () => {
      if (searchQuery) searchAddonRef.current?.findNext(searchQuery);
    };
    const handleSearchPrev = () => {
      if (searchQuery) searchAddonRef.current?.findPrevious(searchQuery);
    };

    return (
      <div
        ref={paneRef}
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

        {/* Live Connecting / Host Key Verifying Bar */}
        {(session.status === 'connecting' || session.status === 'verifying') && (
          <div className="z-20 flex items-center justify-between gap-3 px-3 py-2 bg-zinc-950 border-b border-zinc-800 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
              <span className="text-zinc-200 truncate font-mono-term">
                {session.status === 'verifying'
                  ? `Confirm host key fingerprint for ${session.subtitle}...`
                  : `Connecting to ${session.subtitle || session.title}...`}
              </span>
            </div>
          </div>
        )}

        {/* Reconnect / Error Floating Bar */}
        {(session.status === 'reconnecting' ||
          session.status === 'disconnected' ||
          session.status === 'error') && (
          <div className="z-20 flex items-start sm:items-center justify-between gap-3 px-3 py-2.5 bg-zinc-950 border-b border-zinc-800 text-xs">
            <span className="text-zinc-200 leading-relaxed break-words">
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
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md btn-accent font-semibold shrink-0 transition"
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

        {/* Transparent selectable copy of the screen for native long-press Copy (see effect above) */}
        <div
          ref={selectLayerRef}
          className="xb-select-layer"
          aria-hidden="true"
          style={{ display: 'none', position: 'absolute', zIndex: 24 }}
        />

        {/* Invisible paste target placed under the finger on empty spots (see effect above) */}
        <textarea
          ref={pasteCatcherRef}
          aria-hidden="true"
          tabIndex={-1}
          inputMode="none"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          style={{
            display: 'none',
            position: 'absolute',
            zIndex: 25,
            width: 56,
            height: 56,
            opacity: 0.01,
            color: 'transparent',
            caretColor: 'transparent',
            background: 'transparent',
            border: 0,
            outline: 'none',
            resize: 'none',
            fontSize: 16,
            padding: 0,
          }}
        />
      </div>
    );
  }
);

TerminalPane.displayName = 'TerminalPane';
