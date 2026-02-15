'use client';

import { useState, useCallback } from 'react';
import { useAuth } from './AuthContext';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: '◻' },
  { id: 'flags', label: 'Flags', icon: '⚑' },
  { id: 'crossrefs', label: 'Cross-Refs', icon: '⬡' },
  { id: 'watchlist', label: 'Watchlist', icon: '◉' },
  { id: 'log', label: 'Live Log', icon: '▤' },
  { id: 'export', label: 'Export', icon: '↓' },
];

export default function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const { isAdmin } = useAuth();
  const [scanning, setScanning] = useState(false);

  const startScan = useCallback(async (type: 'manual_full' | 'manual_quick') => {
    setScanning(true);
    onTabChange('log');

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });

      if (!response.body) {
        console.error('No stream body in scan response');
        return;
      }

      // Read the SSE stream and dispatch log entries as custom DOM events
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const line = part.trim();
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'log' && data.entry) {
                window.dispatchEvent(new CustomEvent('scan-log', { detail: data.entry }));
              } else if (data.type === 'complete') {
                window.dispatchEvent(new CustomEvent('scan-complete', { detail: data }));
              } else if (data.type === 'error') {
                window.dispatchEvent(new CustomEvent('scan-log', {
                  detail: { timestamp: new Date().toISOString(), source: 'SYSTEM', message: `Scan error: ${data.message}` },
                }));
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setScanning(false);
    }
  }, [onTabChange]);

  return (
    <aside className="w-56 border-r border-border bg-surface flex flex-col shrink-0">
      <nav className="flex-1 py-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
              activeTab === tab.id
                ? 'bg-accent/10 text-accent border-r-2 border-accent'
                : 'text-muted hover:text-foreground hover:bg-surface-2'
            }`}
          >
            <span className="text-base font-mono">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {isAdmin && (
        <div className="p-4 border-t border-border space-y-2">
          <button
            onClick={() => startScan('manual_full')}
            disabled={scanning}
            className="w-full px-3 py-2 bg-accent/20 text-accent border border-accent/30 text-sm font-medium rounded hover:bg-accent/30 transition-colors disabled:opacity-50"
          >
            {scanning ? 'Running...' : 'Run Full Scan'}
          </button>
          <button
            onClick={() => startScan('manual_quick')}
            disabled={scanning}
            className="w-full px-3 py-2 bg-surface-2 text-foreground border border-border text-sm rounded hover:bg-border/30 transition-colors disabled:opacity-50"
          >
            Quick Scan (30 days)
          </button>
        </div>
      )}

      <div className="p-4 border-t border-border">
        <div className="text-xs text-muted space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-clean" />
            Data fresh (&lt;24h)
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-medium" />
            Data aging (2-7d)
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-critical" />
            Data stale (&gt;7d)
          </div>
        </div>
      </div>
    </aside>
  );
}
