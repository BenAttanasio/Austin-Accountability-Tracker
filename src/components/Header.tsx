'use client';

import { useEffect, useState } from 'react';
import SeverityBadge from './SeverityBadge';

interface StatusData {
  last_run: { completed_at: string; status: string } | null;
  is_running: boolean;
  flag_counts: Record<string, number>;
  total_findings: number;
  total_watchlist: number;
}

export default function Header() {
  const [status, setStatus] = useState<StatusData | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/status');
        if (res.ok) {
          setStatus(await res.json());
        }
      } catch {}
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const lastScan = status?.last_run?.completed_at
    ? new Date(status.last_run.completed_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })
    : 'Never';

  return (
    <header className="h-14 border-b border-border bg-surface flex items-center justify-between px-6 shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-semibold tracking-tight">
          <span className="text-foreground">Austin</span>{' '}
          <span className="text-accent">Accountability</span>{' '}
          <span className="text-foreground">Tracker</span>
        </h1>
        {status?.is_running && (
          <span className="flex items-center gap-1.5 text-xs text-medium font-mono">
            <span className="w-2 h-2 rounded-full bg-medium pulse-dot" />
            SCANNING
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs text-muted">
        <span>Last scan: {lastScan}</span>
        {status && (
          <div className="flex items-center gap-2">
            {status.flag_counts.CRITICAL > 0 && (
              <SeverityBadge severity="CRITICAL" />
            )}
            {status.flag_counts.HIGH > 0 && (
              <span className="font-mono text-high">{status.flag_counts.HIGH} HIGH</span>
            )}
            <span className="font-mono">{status.total_findings} flags</span>
          </div>
        )}
      </div>
    </header>
  );
}
