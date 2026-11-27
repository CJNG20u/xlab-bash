import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Code2,
  Copy,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { DEFAULT_PC_6ROW_LAYOUT } from '../lib/defaultLayout.ts';
import { formatSequenceForDisplay } from '../lib/keySequences.ts';
import type { KeyDef, KeyboardLayoutData, KeyboardLayoutRecord, KeyKind } from '../types/index.ts';
import { DevKeyboard } from './DevKeyboard.tsx';

interface KeyboardLayoutEditorProps {
  layouts: KeyboardLayoutRecord[];
  activeLayoutId: string;
  onLayoutsChange: (layouts: KeyboardLayoutRecord[]) => void;
  onSelectActiveLayout: (id: string) => void;
  onToast: (message: string) => void;
}

export const KeyboardLayoutEditor: React.FC<KeyboardLayoutEditorProps> = ({
  layouts,
  activeLayoutId,
  onLayoutsChange,
  onSelectActiveLayout,
  onToast,
}) => {
  const [editingId, setEditingId] = useState<string>(activeLayoutId);
  const currentRecord =
    layouts.find((l) => l.id === editingId) || layouts[0] || null;

  const [name, setName] = useState(currentRecord?.name || 'xlab-bash 4-Row Developer');
  const [draft, setDraft] = useState<KeyboardLayoutData>(
    currentRecord?.layout || DEFAULT_PC_6ROW_LAYOUT
  );
  const [selectedLoc, setSelectedLoc] = useState<{ rowIdx: number; keyIdx: number } | null>(null);
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testLog, setTestLog] = useState<string[]>([]);

  useEffect(() => {
    const found = layouts.find((l) => l.id === editingId);
    if (found) {
      setName(found.name);
      setDraft(structuredClone(found.layout));
      setSelectedLoc(null);
      setJsonText(JSON.stringify(found.layout, null, 2));
      setJsonError(null);
    }
  }, [editingId, layouts]);

  const selectedKey: KeyDef | null =
    selectedLoc && draft.rows[selectedLoc.rowIdx]?.keys[selectedLoc.keyIdx]
      ? draft.rows[selectedLoc.rowIdx].keys[selectedLoc.keyIdx]
      : null;

  const updateKey = (patch: Partial<KeyDef>) => {
    if (!selectedLoc) return;
    setDraft((prev) => {
      const next = structuredClone(prev);
      const target = next.rows[selectedLoc.rowIdx]?.keys[selectedLoc.keyIdx];
      if (target) {
        Object.assign(target, patch);
      }
      return next;
    });
  };

  const moveKeyHorizontal = (dir: -1 | 1) => {
    if (!selectedLoc) return;
    const { rowIdx, keyIdx } = selectedLoc;
    const row = draft.rows[rowIdx];
    const targetIdx = keyIdx + dir;
    if (!row || targetIdx < 0 || targetIdx >= row.keys.length) return;
    setDraft((prev) => {
      const next = structuredClone(prev);
      const keys = next.rows[rowIdx].keys;
      const [item] = keys.splice(keyIdx, 1);
      keys.splice(targetIdx, 0, item);
      return next;
    });
    setSelectedLoc({ rowIdx, keyIdx: targetIdx });
  };

  const moveKeyVertical = (dir: -1 | 1) => {
    if (!selectedLoc) return;
    const { rowIdx, keyIdx } = selectedLoc;
    const targetRow = rowIdx + dir;
    if (targetRow < 0 || targetRow >= draft.rows.length) return;
    setDraft((prev) => {
      const next = structuredClone(prev);
      const [item] = next.rows[rowIdx].keys.splice(keyIdx, 1);
      next.rows[targetRow].keys.push(item);
      return next;
    });
    setSelectedLoc({ rowIdx: targetRow, keyIdx: draft.rows[targetRow].keys.length });
  };

  const addCustomKeyToRow = (rowIdx: number) => {
    const newKey: KeyDef = {
      id: `custom-${Date.now()}`,
      label: 'Tmux',
      code: 'Custom',
      kind: 'custom',
      sequence: '\\x02',
      width: 1.2,
    };
    setDraft((prev) => {
      const next = structuredClone(prev);
      next.rows[rowIdx].keys.push(newKey);
      return next;
    });
    setSelectedLoc({ rowIdx, keyIdx: draft.rows[rowIdx].keys.length });
  };

  const deleteSelectedKey = () => {
    if (!selectedLoc) return;
    const { rowIdx, keyIdx } = selectedLoc;
    setDraft((prev) => {
      const next = structuredClone(prev);
      next.rows[rowIdx].keys.splice(keyIdx, 1);
      return next;
    });
    setSelectedLoc(null);
  };

  const handleToggleJson = () => {
    if (!jsonMode) {
      setJsonText(JSON.stringify(draft, null, 2));
      setJsonError(null);
      setJsonMode(true);
    } else {
      try {
        const parsed = JSON.parse(jsonText) as KeyboardLayoutData;
        if (!parsed || !Array.isArray(parsed.rows)) {
          throw new Error('JSON must contain a "rows" array.');
        }
        setDraft(parsed);
        setJsonError(null);
        setJsonMode(false);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
      }
    }
  };

  const handleSaveCurrent = async () => {
    let payloadLayout = draft;
    if (jsonMode) {
      try {
        const parsed = JSON.parse(jsonText) as KeyboardLayoutData;
        if (!parsed || !Array.isArray(parsed.rows)) {
          throw new Error('JSON must contain a "rows" array.');
        }
        payloadLayout = parsed;
        setDraft(parsed);
        setJsonError(null);
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : 'Invalid JSON');
        return;
      }
    }

    setSaving(true);
    try {
      const res = await api.updateLayout(editingId, name.trim() || 'Custom Layout', payloadLayout);
      onLayoutsChange(layouts.map((l) => (l.id === res.layout.id ? res.layout : l)));
      onToast('Keyboard layout saved');
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Failed to save layout');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsNew = async () => {
    let payloadLayout = draft;
    if (jsonMode) {
      try {
        payloadLayout = JSON.parse(jsonText) as KeyboardLayoutData;
      } catch {
        setJsonError('Fix JSON syntax before saving.');
        return;
      }
    }
    setSaving(true);
    try {
      const newName = `${name.trim() || 'Layout'} Copy`;
      const res = await api.createLayout(newName, payloadLayout);
      onLayoutsChange([...layouts, res.layout]);
      setEditingId(res.layout.id);
      onSelectActiveLayout(res.layout.id);
      onToast(`Created "${res.layout.name}"`);
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Failed to duplicate layout');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLayout = async () => {
    if (!currentRecord || currentRecord.isDefault) return;
    try {
      await api.deleteLayout(currentRecord.id);
      const nextList = layouts.filter((l) => l.id !== currentRecord.id);
      onLayoutsChange(nextList);
      const fallback = nextList[0]?.id || 'default-pc-6row';
      setEditingId(fallback);
      if (activeLayoutId === currentRecord.id) {
        onSelectActiveLayout(fallback);
      }
      onToast('Layout deleted');
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : 'Cannot delete layout');
    }
  };

  return (
    <div className="space-y-4">
      {/* Layout Selector & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[200px]">
          <select
            value={editingId}
            onChange={(e) => {
              setEditingId(e.target.value);
              onSelectActiveLayout(e.target.value);
            }}
            className="h-9 flex-1 rounded-lg border border-zinc-800 bg-black px-2.5 text-xs text-zinc-100 focus-accent"
          >
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} {l.id === activeLayoutId ? '(Active)' : ''}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Layout name"
            className="h-9 w-36 sm:w-44 rounded-lg border border-zinc-800 bg-black px-2.5 text-xs text-zinc-100 focus-accent"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleToggleJson}
            className={`h-9 px-2.5 rounded-lg border text-xs inline-flex items-center gap-1.5 transition ${
              jsonMode
                ? 'btn-accent-soft'
                : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{jsonMode ? 'Visual' : 'JSON'}</span>
          </button>
          <button
            type="button"
            onClick={handleSaveAsNew}
            disabled={saving}
            title="Duplicate as new layout"
            className="h-9 px-2.5 rounded-lg border border-zinc-800 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800 inline-flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save Copy</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(structuredClone(DEFAULT_PC_6ROW_LAYOUT));
              setJsonText(JSON.stringify(DEFAULT_PC_6ROW_LAYOUT, null, 2));
              setSelectedLoc(null);
            }}
            title="Reset draft to default"
            className="h-9 px-2.5 rounded-lg border border-zinc-800 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800 inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {currentRecord && !currentRecord.isDefault && (
            <button
              type="button"
              onClick={handleDeleteLayout}
              title="Delete layout"
              className="h-9 px-2.5 rounded-lg border border-zinc-800 bg-zinc-900 text-xs text-red-400 hover:bg-red-950/40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleSaveCurrent}
            disabled={saving}
            className="h-9 px-3.5 rounded-lg btn-accent text-xs font-semibold inline-flex items-center gap-1.5 transition"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Editor Body: Visual vs JSON */}
      {jsonMode ? (
        <div className="space-y-2">
          <textarea
            rows={12}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            spellCheck={false}
            className="w-full rounded-xl border border-zinc-800 bg-black p-3 text-xs font-mono-term text-zinc-200 focus-accent"
          />
          {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Rows & Selectable Keys */}
          <div className="rounded-xl border border-zinc-800 bg-black p-2.5 space-y-1.5">
            <div className="text-[11px] text-zinc-500 px-1">
              Tap any key to edit, reorder, or remove. Use + at row end to add a custom key.
            </div>
            {draft.rows.map((row, rowIdx) => (
              <div key={row.id || rowIdx} className="flex items-center gap-1 overflow-x-auto no-scrollbar">
                {row.keys.map((k, keyIdx) => {
                  const isSel =
                    selectedLoc?.rowIdx === rowIdx && selectedLoc?.keyIdx === keyIdx;
                  return (
                    <button
                      key={`${k.id}-${keyIdx}`}
                      type="button"
                      onClick={() => setSelectedLoc({ rowIdx, keyIdx })}
                      className={`h-8 min-w-[30px] px-1.5 rounded border font-mono-term text-[11px] shrink-0 transition ${
                        isSel
                          ? 'bg-accent-solid font-semibold'
                          : 'bg-zinc-900 text-zinc-200 border-zinc-800 hover:border-zinc-600'
                      }`}
                    >
                      {k.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => addCustomKeyToRow(rowIdx)}
                  title={`Add custom key to row ${rowIdx + 1}`}
                  className="h-8 w-7 rounded border border-dashed border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200 flex items-center justify-center shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Selected Key Inspector */}
          {selectedKey && selectedLoc && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-zinc-200">
                  Row {selectedLoc.rowIdx + 1} · Key “{selectedKey.label}”
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveKeyHorizontal(-1)}
                    className="w-7 h-7 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:bg-zinc-800"
                    title="Move left"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveKeyHorizontal(1)}
                    className="w-7 h-7 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:bg-zinc-800"
                    title="Move right"
                  >
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveKeyVertical(-1)}
                    className="w-7 h-7 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:bg-zinc-800"
                    title="Move to previous row"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveKeyVertical(1)}
                    className="w-7 h-7 rounded bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 hover:bg-zinc-800"
                    title="Move to next row"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedKey}
                    className="w-7 h-7 rounded bg-red-950/50 border border-red-900/50 flex items-center justify-center text-red-400 hover:bg-red-900/50 ml-1"
                    title="Delete key"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">Label</label>
                  <input
                    type="text"
                    value={selectedKey.label}
                    onChange={(e) => updateKey({ label: e.target.value })}
                    className="w-full h-8 rounded-lg border border-zinc-800 bg-black px-2 text-xs font-mono-term text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">Shift Label</label>
                  <input
                    type="text"
                    value={selectedKey.shiftLabel || ''}
                    onChange={(e) => updateKey({ shiftLabel: e.target.value || undefined })}
                    className="w-full h-8 rounded-lg border border-zinc-800 bg-black px-2 text-xs font-mono-term text-zinc-100"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">Kind</label>
                  <select
                    value={selectedKey.kind}
                    onChange={(e) => updateKey({ kind: e.target.value as KeyKind })}
                    className="w-full h-8 rounded-lg border border-zinc-800 bg-black px-2 text-xs text-zinc-100"
                  >
                    <option value="char">Character</option>
                    <option value="special">Special</option>
                    <option value="custom">Custom Sequence</option>
                    <option value="modifier">Modifier</option>
                    <option value="space">Space</option>
                    <option value="fn_toggle">Fn Toggle</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">Width Weight</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.6"
                    max="5"
                    value={selectedKey.width ?? 1}
                    onChange={(e) => updateKey({ width: Number(e.target.value) || 1 })}
                    className="w-full h-8 rounded-lg border border-zinc-800 bg-black px-2 text-xs font-mono-term text-zinc-100"
                  />
                </div>
              </div>

              {selectedKey.kind === 'custom' && (
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Custom Sequence (supports \x02, \x1b, \r, \t)
                  </label>
                  <input
                    type="text"
                    value={selectedKey.sequence || ''}
                    onChange={(e) => updateKey({ sequence: e.target.value })}
                    placeholder="\x02"
                    className="w-full h-8 rounded-lg border border-zinc-800 bg-black px-2 text-xs font-mono-term text-accent focus-accent"
                  />
                </div>
              )}

              <label className="inline-flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(selectedKey.repeatable)}
                  onChange={(e) => updateKey({ repeatable: e.target.checked })}
                  className="rounded"
                />
                <span>Repeat key while held</span>
              </label>
            </div>
          )}
        </div>
      )}

      {/* Live Escape Sequence Tester */}
      <div className="rounded-xl border border-zinc-800 bg-black overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-900">
          <span className="text-[11px] font-medium text-zinc-400">
            Interactive Key & Escape Sequence Tester
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono-term text-accent truncate max-w-[200px]">
              {testLog.length > 0 ? testLog.slice(-6).join(' · ') : 'Tap keys below'}
            </span>
            {testLog.length > 0 && (
              <button
                type="button"
                onClick={() => setTestLog([])}
                className="text-[10px] text-zinc-500 hover:text-zinc-200"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <DevKeyboard
          layout={draft}
          height={208}
          hapticEnabled={false}
          showKeyPreview={true}
          onSendSequence={(seq) => {
            setTestLog((prev) => [...prev.slice(-15), formatSequenceForDisplay(seq)]);
          }}
        />
      </div>
    </div>
  );
};
