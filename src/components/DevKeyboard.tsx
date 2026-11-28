import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NUMBERS_LAYER_LAYOUT, SYMBOLS_LAYER_LAYOUT } from '../lib/defaultLayout.ts';
import { resolveKeySequence, type ActiveModifiers } from '../lib/keySequences.ts';
import type { KeyDef, KeyboardLayoutData, ModifierType } from '../types/index.ts';

type ModState = 'off' | 'once' | 'locked';

interface ModifierMap {
  ctrl: ModState;
  alt: ModState;
  shift: ModState;
}

interface PreviewBubble {
  label: string;
  x: number;
  y: number;
  width: number;
}

interface DevKeyboardProps {
  layout: KeyboardLayoutData;
  height: number;
  hapticEnabled: boolean;
  showKeyPreview: boolean;
  onSendSequence: (seq: string) => void;
}

const DOUBLE_TAP_MS = 350;
const REPEAT_DELAY_MS = 380;
const REPEAT_INTERVAL_MS = 55;
const SPACE_SCRUB_THRESHOLD_PX = 14;
const SPACE_SCRUB_STEP_PX = 18;

export const DevKeyboard: React.FC<DevKeyboardProps> = ({
  layout,
  height,
  hapticEnabled,
  showKeyPreview,
  onSendSequence,
}) => {
  const [mods, setMods] = useState<ModifierMap>({ ctrl: 'off', alt: 'off', shift: 'off' });
  // 0 = letters (your layout), 1 = 123 page, 2 = #+= page
  const [page, setPage] = useState<0 | 1 | 2>(0);
  const fnActive = page !== 0;
  const [pressedKeyId, setPressedKeyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewBubble | null>(null);
  const [spaceScrubbing, setSpaceScrubbing] = useState(false);
  const [effectiveHeight, setEffectiveHeight] = useState(height);

  const lastModTapRef = useRef<Record<ModifierType, number>>({ ctrl: 0, alt: 0, shift: 0 });
  const repeatTimeoutRef = useRef<number | null>(null);
  const repeatIntervalRef = useRef<number | null>(null);
  const modsRef = useRef(mods);
  const fnRef = useRef(fnActive);
  modsRef.current = mods;
  fnRef.current = fnActive;

  // Space bar swipe-to-move-cursor tracking
  const spaceSwipeRef = useRef<{
    pointerId: number | null;
    startX: number;
    lastStepX: number;
    didScrub: boolean;
    didRepeat: boolean;
  }>({ pointerId: null, startX: 0, lastStepX: 0, didScrub: false, didRepeat: false });

  // Adapt height smoothly to landscape/short viewports
  useEffect(() => {
    const updateHeight = () => {
      const vh = window.visualViewport?.height || window.innerHeight;
      const isLandscape = window.innerWidth > window.innerHeight && vh < 520;
      const cap = isLandscape ? Math.max(184, Math.floor(vh * 0.50)) : Math.floor(vh * 0.58);
      setEffectiveHeight(Math.min(height, cap));
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    window.visualViewport?.addEventListener('resize', updateHeight);
    return () => {
      window.removeEventListener('resize', updateHeight);
      window.visualViewport?.removeEventListener('resize', updateHeight);
    };
  }, [height]);

  const clearRepeatTimers = useCallback(() => {
    if (repeatTimeoutRef.current !== null) {
      window.clearTimeout(repeatTimeoutRef.current);
      repeatTimeoutRef.current = null;
    }
    if (repeatIntervalRef.current !== null) {
      window.clearInterval(repeatIntervalRef.current);
      repeatIntervalRef.current = null;
    }
  }, []);

  useEffect(() => clearRepeatTimers, [clearRepeatTimers]);

  const vibrate = useCallback(
    (ms = 10) => {
      if (hapticEnabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try {
          navigator.vibrate(ms);
        } catch {
          // ignore
        }
      }
    },
    [hapticEnabled]
  );

  const getActiveMods = (): ActiveModifiers => ({
    ctrl: modsRef.current.ctrl !== 'off',
    alt: modsRef.current.alt !== 'off',
    shift: modsRef.current.shift !== 'off',
    fn: fnRef.current,
  });

  const consumeOneShotModifiers = useCallback(() => {
    setMods((prev) => {
      const next: ModifierMap = {
        ctrl: prev.ctrl === 'once' ? 'off' : prev.ctrl,
        alt: prev.alt === 'once' ? 'off' : prev.alt,
        shift: prev.shift === 'once' ? 'off' : prev.shift,
      };
      if (next.ctrl === prev.ctrl && next.alt === prev.alt && next.shift === prev.shift) {
        return prev;
      }
      return next;
    });
  }, []);

  const handleModifierTap = useCallback(
    (mod: ModifierType) => {
      vibrate(12);
      const now = Date.now();
      const delta = now - lastModTapRef.current[mod];
      lastModTapRef.current[mod] = now;

      setMods((prev) => {
        const cur = prev[mod];
        if (cur === 'locked') {
          return { ...prev, [mod]: 'off' };
        }
        if (delta < DOUBLE_TAP_MS && cur === 'once') {
          return { ...prev, [mod]: 'locked' };
        }
        return { ...prev, [mod]: cur === 'off' ? 'once' : 'off' };
      });
    },
    [vibrate]
  );

  const emitKey = useCallback(
    (key: KeyDef, keepOneShot = false) => {
      const seq = resolveKeySequence(key, getActiveMods());
      if (seq !== null) {
        onSendSequence(seq);
        if (!keepOneShot) {
          consumeOneShotModifiers();
        }
      }
    },
    [consumeOneShotModifiers, onSendSequence]
  );

  const getKeyDisplayLabel = (key: KeyDef): { primary: string; secondary?: string } => {
    const isShift = mods.shift !== 'off';
    if (key.kind === 'fn_toggle') {
      return { primary: key.label || (fnActive ? 'ABC' : '123') };
    }
    if (isShift && key.shiftLabel) {
      return { primary: key.shiftLabel, secondary: key.label };
    }
    return { primary: key.label, secondary: key.shiftLabel };
  };

  const showBubbleForEl = (el: HTMLElement, label: string) => {
    if (!showKeyPreview) return;
    const rect = el.getBoundingClientRect();
    setPreview({
      label,
      x: rect.left + rect.width / 2,
      y: rect.top - 6,
      width: Math.max(rect.width + 10, 42),
    });
  };

  const handleKeyPointerDown = (e: React.PointerEvent<HTMLButtonElement>, key: KeyDef) => {
    e.preventDefault();
    clearRepeatTimers();

    if (key.kind === 'modifier' && key.modifier) {
      handleModifierTap(key.modifier);
      return;
    }

    if (key.kind === 'fn_toggle') {
      vibrate(12);
      if (key.code === 'FnPage2') setPage(2);
      else if (key.code === 'FnPage1') setPage(1);
      else setPage((p) => (p === 0 ? 1 : 0)); // 123 <-> ABC
      return;
    }
    if (key.kind === 'spacer') return;

    setPressedKeyId(key.id);
    vibrate(10);

    // Special handling for Space bar: supports both swipe cursor scrub & hold-to-repeat
    if (key.kind === 'space' || key.code === 'Space') {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      spaceSwipeRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        lastStepX: e.clientX,
        didScrub: false,
        didRepeat: false,
      };
      // Start space repeat only if user holds still without scrubbing
      if (key.repeatable) {
        repeatTimeoutRef.current = window.setTimeout(() => {
          if (!spaceSwipeRef.current.didScrub) {
            spaceSwipeRef.current.didRepeat = true;
            emitKey(key, true);
            repeatIntervalRef.current = window.setInterval(() => {
              if (!spaceSwipeRef.current.didScrub) {
                emitKey(key, true);
              }
            }, REPEAT_INTERVAL_MS);
          }
        }, REPEAT_DELAY_MS);
      }
      return;
    }

    const { primary } = getKeyDisplayLabel(key);
    showBubbleForEl(e.currentTarget, primary);

    // Emit immediately
    emitKey(key, Boolean(key.repeatable));

    // Set up repeat for Backspace, arrows, etc.
    if (key.repeatable) {
      repeatTimeoutRef.current = window.setTimeout(() => {
        repeatIntervalRef.current = window.setInterval(() => {
          vibrate(5);
          emitKey(key, true);
        }, REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    }
  };

  const handleSpacePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const swipe = spaceSwipeRef.current;
    if (swipe.pointerId !== e.pointerId) return;

    const totalDx = e.clientX - swipe.startX;
    if (!swipe.didScrub && Math.abs(totalDx) >= SPACE_SCRUB_THRESHOLD_PX) {
      swipe.didScrub = true;
      swipe.lastStepX = e.clientX;
      clearRepeatTimers();
      setSpaceScrubbing(true);
    }

    if (swipe.didScrub) {
      const stepDx = e.clientX - swipe.lastStepX;
      if (Math.abs(stepDx) >= SPACE_SCRUB_STEP_PX) {
        const steps = Math.trunc(stepDx / SPACE_SCRUB_STEP_PX);
        const seq = steps > 0 ? '\x1b[C' : '\x1b[D';
        const count = Math.abs(steps);
        for (let i = 0; i < count; i++) {
          onSendSequence(seq);
        }
        vibrate(6);
        swipe.lastStepX += steps * SPACE_SCRUB_STEP_PX;
      }
    }
  };

  const handleKeyPointerUp = (e: React.PointerEvent<HTMLButtonElement>, key: KeyDef) => {
    e.preventDefault();
    clearRepeatTimers();

    if (key.kind === 'space' || key.code === 'Space') {
      const swipe = spaceSwipeRef.current;
      if (swipe.pointerId === e.pointerId) {
        if (!swipe.didScrub && !swipe.didRepeat) {
          emitKey(key, false);
        } else if (swipe.didRepeat) {
          consumeOneShotModifiers();
        }
        spaceSwipeRef.current.pointerId = null;
        spaceSwipeRef.current.didScrub = false;
        spaceSwipeRef.current.didRepeat = false;
        setSpaceScrubbing(false);
      }
    } else if (key.repeatable) {
      consumeOneShotModifiers();
    }

    setPressedKeyId(null);
    setPreview(null);
  };

  const handleKeyPointerCancel = () => {
    clearRepeatTimers();
    spaceSwipeRef.current.pointerId = null;
    spaceSwipeRef.current.didScrub = false;
    setSpaceScrubbing(false);
    setPressedKeyId(null);
    setPreview(null);
  };

  const displayedLayout =
    page === 2 ? SYMBOLS_LAYER_LAYOUT : page === 1 ? NUMBERS_LAYER_LAYOUT : layout;
  const rowCount = displayedLayout.rows.length || 4;

  return (
    <div
      className="relative w-full bg-[#09090b] border-t border-zinc-800/90 px-1 pt-2 pb-2 pb-safe select-none shrink-0"
      style={{ height: `${effectiveHeight}px` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Floating key-preview popup */}
      {preview && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full flex items-center justify-center rounded-lg border border-accent bg-zinc-900 text-zinc-50 font-mono-term text-xl font-semibold shadow-2xl"
          style={{
            left: `${preview.x}px`,
            top: `${preview.y}px`,
            minWidth: `${preview.width}px`,
            height: '46px',
            padding: '0 10px',
          }}
        >
          {preview.label}
        </div>
      )}

      <div
        className="h-full w-full grid gap-y-[7px]"
        style={{ gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }}
      >
        {displayedLayout.rows.map((row, rowIdx) => {
          const isFnRow = Boolean(row.scrollable);
          return (
            <div
              key={row.id || `row-${rowIdx}`}
              className={`flex items-stretch gap-x-[5px] min-h-0 ${
                isFnRow ? 'overflow-x-auto no-scrollbar' : 'w-full'
              }`}
            >
              {row.keys.map((key) => {
                if (key.kind === 'spacer') {
                  return (
                    <div
                      key={key.id}
                      aria-hidden="true"
                      style={{ flex: `${key.width ?? 0.5} 1 0%`, minWidth: 0 }}
                    />
                  );
                }
                const isControlRow = rowIdx === 0 && row.id.endsWith('-control');
                const isArrow = key.code.startsWith('Arrow');
                const isMod = key.kind === 'modifier' && key.modifier;
                const modState: ModState = isMod && key.modifier ? mods[key.modifier] : 'off';
                const isFnToggle = key.kind === 'fn_toggle';
                const isSpace = key.kind === 'space' || key.code === 'Space';
                const isPressed = pressedKeyId === key.id;
                const { primary, secondary } = getKeyDisplayLabel(key);

                let colorClass =
                  'bg-[#18181b] text-zinc-100 border-zinc-800/90 active:bg-zinc-700';

                if (key.kind === 'special' || key.kind === 'custom') {
                  colorClass =
                    'bg-[#111114] text-zinc-300 border-zinc-800/80 active:bg-zinc-700';
                }
                if (isControlRow && isArrow) {
                  colorClass = 'bg-[#111114] text-accent border-zinc-800/80 active:bg-zinc-700';
                }

                if (key.code === 'Enter') {
                  colorClass = 'btn-accent-soft active-accent font-semibold';
                }

                if (isMod) {
                  if (modState === 'locked') {
                    colorClass = 'bg-accent-solid font-semibold';
                  } else if (modState === 'once') {
                    colorClass = 'btn-accent-soft font-semibold';
                  } else {
                    colorClass = 'bg-[#111114] text-zinc-300 border-zinc-800/80';
                  }
                }

                if (isFnToggle) {
                  colorClass = 'bg-[#111114] text-accent border-zinc-800/90 font-semibold active:bg-zinc-700';
                }
                if (isSpace && spaceScrubbing) {
                  colorClass = 'btn-accent-soft';
                } else if (isPressed && !isMod && !isFnToggle) {
                  colorClass = 'bg-zinc-700 text-white border-zinc-500';
                }

                const flexWeight = key.width ?? 1;
                const styleObj: React.CSSProperties = isFnRow
                  ? { minWidth: `${Math.round(flexWeight * 40)}px`, flex: `1 0 ${Math.round(flexWeight * 40)}px` }
                  : { flex: `${flexWeight} 1 0%`, minWidth: 0 };

                const isSmallText =
                  primary.length > 2 ||
                  key.code.startsWith('F') ||
                  key.kind === 'modifier' ||
                  key.kind === 'fn_toggle' ||
                  key.code === 'Home' ||
                  key.code === 'End' ||
                  key.code === 'PageUp' ||
                  key.code === 'PageDown' ||
                  key.code === 'Tab' ||
                  key.code === 'Escape';

                return (
                  <button
                    key={key.id}
                    type="button"
                    style={styleObj}
                    onPointerDown={(e) => handleKeyPointerDown(e, key)}
                    onPointerMove={isSpace ? handleSpacePointerMove : undefined}
                    onPointerUp={(e) => handleKeyPointerUp(e, key)}
                    onPointerCancel={handleKeyPointerCancel}
                    onPointerLeave={isSpace ? undefined : handleKeyPointerCancel}
                    className={`dev-key relative rounded-[8px] border flex items-center justify-center leading-none transition-[background-color,border-color,color] duration-75 ${colorClass}`}
                  >
                    {/* Subtle secondary shifted legend on dual-symbol keys */}
                    {!fnActive &&
                      secondary &&
                      key.kind === 'char' &&
                      !/^[a-zA-Z]$/.test(key.label) && (
                        <span className="hidden sm:block absolute top-[2px] right-[4px] text-[9px] text-zinc-500 font-mono-term pointer-events-none">
                          {secondary}
                        </span>
                      )}

                    {/* Main key label */}
                    <span
                      className={`font-mono-term truncate px-0.5 ${
                        isSpace
                          ? 'text-[13px] tracking-wide text-zinc-400'
                          : isArrow || key.code === 'Enter' || key.code === 'Backspace' || key.label === '⇧'
                          ? 'text-[22px] font-semibold'
                          : isSmallText
                          ? 'text-[14px] font-semibold'
                          : 'text-[21px] font-medium'
                      }`}
                    >
                      {isSpace ? (spaceScrubbing ? '← cursor →' : 'space') : primary}
                    </span>

                    {/* Sticky modifier state indicator bar */}
                    {isMod && modState !== 'off' && (
                      <span
                        className="absolute bottom-[2px] left-1/2 -translate-x-1/2 h-[2px] rounded-full"
                        style={{
                          width: modState === 'locked' ? '14px' : '10px',
                          backgroundColor:
                            modState === 'locked' ? 'var(--accent-fg)' : 'var(--accent-text)',
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
