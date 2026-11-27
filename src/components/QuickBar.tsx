import { ClipboardPaste, CornerDownLeft, Plus } from 'lucide-react';
import React from 'react';
import { unescapeSequence } from '../lib/keySequences.ts';
import type { QuickBarItem, SnippetItem } from '../types/index.ts';

interface QuickBarProps {
  items: QuickBarItem[];
  snippets: SnippetItem[];
  hapticEnabled: boolean;
  onSendSequence: (seq: string) => void;
  onOpenSnippetsSettings: () => void;
  onPaste: () => void;
}

export const QuickBar: React.FC<QuickBarProps> = ({
  items,
  snippets,
  hapticEnabled,
  onSendSequence,
  onOpenSnippetsSettings,
  onPaste,
}) => {
  const triggerHaptic = () => {
    if (hapticEnabled && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(10);
      } catch {
        // ignore unsupported browsers
      }
    }
  };

  const handleQuickTap = (e: React.PointerEvent, item: QuickBarItem) => {
    e.preventDefault();
    triggerHaptic();
    onSendSequence(unescapeSequence(item.sequence));
  };

  const handleSnippetTap = (snippet: SnippetItem) => {
    triggerHaptic();
    const payload = snippet.sendEnter ? `${snippet.command}\r` : snippet.command;
    onSendSequence(payload);
  };

  return (
    <div className="w-full bg-[#09090b] border-t border-zinc-800/90 select-none shrink-0">
      {/* Row 1: One-tap combos & shell symbols */}
      <div className="flex items-center gap-1 px-1.5 py-1 overflow-x-auto no-scrollbar border-b border-zinc-900">
        {/* Paste helper (click so the browser grants clipboard access) */}
        <button
          type="button"
          onClick={() => {
            triggerHaptic();
            onPaste();
          }}
          className="dev-key shrink-0 h-8 px-2 rounded-md bg-zinc-950 border border-zinc-800/90 text-zinc-200 hover:bg-zinc-900 inline-flex items-center gap-1 text-[12px] active-accent"
          aria-label="Paste"
          title="Paste clipboard"
        >
          <ClipboardPaste className="w-3.5 h-3.5 text-accent" />
          <span>Paste</span>
        </button>
        <span className="w-px h-5 bg-zinc-800 shrink-0 mx-0.5" aria-hidden="true" />
        {items.map((item) => {
          const isSymbol = item.category === 'symbol';
          return (
            <button
              key={item.id}
              type="button"
              onPointerDown={(e) => handleQuickTap(e, item)}
              className={`dev-key shrink-0 h-8 rounded-md font-mono-term text-[12px] font-medium transition-colors active:scale-[0.95] active-accent ${
                isSymbol
                  ? 'min-w-[34px] px-2.5 bg-zinc-900 text-zinc-200 border border-zinc-800 hover:bg-zinc-800'
                  : 'px-2.5 bg-zinc-950 text-accent border border-zinc-800/90 hover:bg-zinc-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Row 2: Swipeable user-defined snippets */}
      <div className="flex items-center gap-1.5 px-1.5 py-1 overflow-x-auto no-scrollbar">
        {snippets.map((snippet) => (
          <button
            key={snippet.id}
            type="button"
            onClick={() => handleSnippetTap(snippet)}
            title={`${snippet.command}${snippet.sendEnter ? ' [Enter]' : ''}`}
            className="dev-key shrink-0 h-7 px-2.5 rounded-md bg-zinc-900/90 border border-zinc-800/80 text-[11px] font-mono-term text-zinc-200 hover:bg-zinc-800 active-accent inline-flex items-center gap-1 transition-colors"
          >
            <span className="max-w-[150px] truncate">{snippet.label}</span>
            {snippet.sendEnter && (
              <CornerDownLeft className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
            )}
          </button>
        ))}

        <button
          type="button"
          onClick={onOpenSnippetsSettings}
          title="Manage snippets"
          aria-label="Manage snippets"
          className="dev-key shrink-0 h-7 px-2 rounded-md border border-dashed border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-600 inline-flex items-center gap-1 text-[11px] transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span>Edit</span>
        </button>
      </div>
    </div>
  );
};
