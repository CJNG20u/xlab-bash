import { AlertTriangle, ShieldCheck } from 'lucide-react';
import React from 'react';
import type { HostKeyPrompt } from '../types/index.ts';

interface HostKeyModalProps {
  prompt: HostKeyPrompt;
  onAccept: () => void;
  onReject: () => void;
}

export const HostKeyModal: React.FC<HostKeyModalProps> = ({ prompt, onAccept, onReject }) => {
  const isChanged = prompt.status === 'changed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
      <div
        className={`w-full max-w-md rounded-2xl border bg-zinc-950 p-6 ${
          isChanged ? 'border-red-500/60' : 'border-zinc-800'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              isChanged ? 'bg-red-950/70 text-red-400' : 'bg-emerald-950/70 text-emerald-400'
            }`}
          >
            {isChanged ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <ShieldCheck className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-100">
              {isChanged ? 'Host Key Changed' : 'Verify Host Fingerprint'}
            </h2>
            <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
              {isChanged
                ? 'WARNING: The remote host identification has changed. This could indicate a server reinstall or a man-in-the-middle attack.'
                : 'First connection to this host. Confirm the SHA-256 fingerprint matches your server before continuing.'}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-800 bg-black p-3.5 space-y-2.5">
          <div>
            <div className="text-[11px] text-zinc-500">Host</div>
            <div className="text-sm font-mono-term text-zinc-100 break-all">
              {prompt.host}:{prompt.port}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-zinc-500">
              {isChanged ? 'New Fingerprint (SHA-256)' : 'Fingerprint (SHA-256)'}
            </div>
            <div className="text-xs font-mono-term text-emerald-300 break-all select-all">
              {prompt.fingerprint}
            </div>
          </div>

          {isChanged && prompt.previousFingerprint && (
            <div>
              <div className="text-[11px] text-red-400">Previously Trusted Fingerprint</div>
              <div className="text-xs font-mono-term text-zinc-400 break-all">
                {prompt.previousFingerprint}
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onReject}
            className="h-11 rounded-xl border border-zinc-700 bg-zinc-900 text-sm font-medium text-zinc-200 hover:bg-zinc-800 transition"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={onAccept}
            className={`h-11 rounded-xl text-sm font-semibold transition ${
              isChanged
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'btn-accent'
            }`}
          >
            {isChanged ? 'Trust New Key' : 'Trust & Connect'}
          </button>
        </div>
      </div>
    </div>
  );
};
