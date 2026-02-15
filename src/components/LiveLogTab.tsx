'use client';

import { useEffect, useState, useRef } from 'react';

interface LogEntry {
  timestamp: string;
  source: string;
  message: string;
}

const SOURCE_COLORS: Record<string, string> = {
  SOCRATA: 'text-accent',
  ANALYSIS: 'text-purple-400',
  AI: 'text-emerald-400',
  DB: 'text-yellow-400',
  CRON: 'text-cyan-400',
  SYSTEM: 'text-foreground',
  FLAG: 'text-critical',
};

export default function LiveLogTab() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Load historical logs from last run
    const loadHistory = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          const data = await res.json();
          if (data.last_run?.log) {
            setLogs(data.last_run.log);
          }
        }
      } catch {}
    };

    loadHistory();

    // Listen for real-time log entries streamed from the scan endpoint
    const handleLogEntry = (e: Event) => {
      const entry = (e as CustomEvent).detail as LogEntry;
      setConnected(true);
      setLogs(prev => {
        const updated = [...prev, entry];
        return updated.length > 2000 ? updated.slice(-1000) : updated;
      });
    };

    const handleScanComplete = () => {
      setConnected(false);
    };

    window.addEventListener('scan-log', handleLogEntry);
    window.addEventListener('scan-complete', handleScanComplete);

    return () => {
      window.removeEventListener('scan-log', handleLogEntry);
      window.removeEventListener('scan-complete', handleScanComplete);
    };
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100);
  };

  const filteredLogs = filter
    ? logs.filter(l => l.source === filter)
    : logs;

  const formatTimestamp = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString('en-US', {
        timeZone: 'America/Chicago',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-surface">
        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs ${connected ? 'text-clean' : 'text-muted'}`}>
            <span className={`w-2 h-2 rounded-full ${connected ? 'bg-clean pulse-dot' : 'bg-muted'}`} />
            {connected ? 'Connected' : 'Disconnected'}
          </div>

          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="bg-surface-2 border border-border text-xs rounded px-2 py-1 text-foreground"
          >
            <option value="">All Sources</option>
            <option value="SOCRATA">SOCRATA</option>
            <option value="ANALYSIS">ANALYSIS</option>
            <option value="AI">AI</option>
            <option value="DB">DB</option>
            <option value="FLAG">FLAG</option>
            <option value="SYSTEM">SYSTEM</option>
            <option value="CRON">CRON</option>
          </select>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-muted font-mono">{filteredLogs.length} entries</span>
          <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={e => setAutoScroll(e.target.checked)}
              className="accent-accent"
            />
            Auto-scroll
          </label>
          <button
            onClick={() => setLogs([])}
            className="text-xs text-muted hover:text-foreground px-2 py-1 border border-border rounded"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log output */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-background font-mono text-xs p-4 space-y-0.5"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-center text-muted py-12">
            <div className="text-2xl mb-2 opacity-20">▤</div>
            <p>No log entries yet.</p>
            <p className="mt-1">Start a scan to see real-time activity.</p>
          </div>
        ) : (
          filteredLogs.map((entry, i) => (
            <div key={i} className="log-line flex gap-2 py-0.5 hover:bg-surface/50">
              <span className="text-muted shrink-0">[{formatTimestamp(entry.timestamp)}]</span>
              <span className={`shrink-0 w-20 text-right ${SOURCE_COLORS[entry.source] || 'text-muted'}`}>
                [{entry.source}]
              </span>
              <span className={
                entry.source === 'FLAG' ? 'text-critical' :
                entry.message.includes('complete') || entry.message.includes('Complete') ? 'text-clean' :
                entry.message.includes('Error') || entry.message.includes('failed') ? 'text-critical' :
                'text-foreground/80'
              }>
                {entry.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
