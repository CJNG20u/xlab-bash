import { WifiOff } from 'lucide-react';
import React from 'react';
import { useOnlineStatus } from '../hooks/usePWAInstall.ts';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-zinc-950/95 px-3.5 py-2 text-xs font-medium text-amber-300 shadow-xl"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Network offline — SSH sessions will reconnect when back online</span>
    </div>
  );
};
