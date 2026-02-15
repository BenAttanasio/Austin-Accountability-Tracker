'use client';

import { useEffect, useState } from 'react';
import SeverityBadge from './SeverityBadge';
import { useAuth } from './AuthContext';

interface StatusData {
  last_run: Record<string, unknown> | null;
  is_running: boolean;
  flag_counts: Record<string, number>;
  total_findings: number;
  total_watchlist: number;
}

interface FindingData {
  _id: string;
  entity_name: string;
  severity: string;
  category: string;
  description: string;
  created_at: string;
  ai_analysis?: string;
}

export default function DashboardTab({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { isAdmin } = useAuth();
  const [status, setStatus] = useState<StatusData | null>(null);
  const [recentFlags, setRecentFlags] = useState<FindingData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [statusRes, findingsRes] = await Promise.all([
          fetch('/api/status'),
          fetch('/api/findings?limit=10&sort=created_at&dir=desc'),
        ]);

        if (statusRes.ok) setStatus(await statusRes.json());
        if (findingsRes.ok) {
          const data = await findingsRes.json();
          setRecentFlags(data.findings || []);
        }
      } catch {} finally {
        setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted font-mono text-sm">Loading dashboard...</div>
      </div>
    );
  }

  const isEmpty = !status || status.total_findings === 0;

  if (isEmpty) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4 opacity-20">◻</div>
          <h2 className="text-xl font-semibold mb-2">No Data Yet</h2>
          <p className="text-muted text-sm mb-6">
            Run your first scan to begin monitoring Austin city government spending data.
            The daily cron will also populate data automatically at 3 AM Central.
          </p>
          {isAdmin && (
            <button
              onClick={() => onNavigate('log')}
              className="px-4 py-2 bg-accent text-white rounded text-sm font-medium hover:bg-accent/80 transition-colors"
            >
              Go to Live Log to Monitor Scans
            </button>
          )}
        </div>
      </div>
    );
  }

  const fc = status!.flag_counts;
  const totalFlags = (fc.CRITICAL || 0) + (fc.HIGH || 0) + (fc.MEDIUM || 0) + (fc.LOW || 0);

  // Category counts from recent flags
  const categoryCounts: Record<string, number> = {};
  for (const f of recentFlags) {
    categoryCounts[f.category] = (categoryCounts[f.category] || 0) + 1;
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard label="Total Findings" value={status!.total_findings} />
        <SummaryCard label="CRITICAL" value={fc.CRITICAL || 0} color="text-critical" />
        <SummaryCard label="HIGH" value={fc.HIGH || 0} color="text-high" />
        <SummaryCard label="MEDIUM" value={fc.MEDIUM || 0} color="text-medium" />
        <SummaryCard label="Watchlist" value={status!.total_watchlist} color="text-accent" />
      </div>

      {/* Severity Distribution Bar */}
      <div className="bg-surface border border-border rounded p-4">
        <h3 className="text-sm font-medium text-muted mb-3">Severity Distribution</h3>
        <div className="flex h-8 rounded overflow-hidden">
          {fc.CRITICAL > 0 && (
            <div
              className="bg-critical flex items-center justify-center text-xs font-mono text-white"
              style={{ width: `${(fc.CRITICAL / totalFlags) * 100}%` }}
            >
              {fc.CRITICAL}
            </div>
          )}
          {fc.HIGH > 0 && (
            <div
              className="bg-high flex items-center justify-center text-xs font-mono text-white"
              style={{ width: `${(fc.HIGH / totalFlags) * 100}%` }}
            >
              {fc.HIGH}
            </div>
          )}
          {fc.MEDIUM > 0 && (
            <div
              className="bg-medium flex items-center justify-center text-xs font-mono text-black"
              style={{ width: `${(fc.MEDIUM / totalFlags) * 100}%` }}
            >
              {fc.MEDIUM}
            </div>
          )}
          {fc.LOW > 0 && (
            <div
              className="bg-low flex items-center justify-center text-xs font-mono text-white"
              style={{ width: `${(fc.LOW / totalFlags) * 100}%` }}
            >
              {fc.LOW}
            </div>
          )}
        </div>
        <div className="flex gap-4 mt-2 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-critical rounded-sm" /> Critical</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-high rounded-sm" /> High</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-medium rounded-sm" /> Medium</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-low rounded-sm" /> Low</span>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="bg-surface border border-border rounded p-4">
        <h3 className="text-sm font-medium text-muted mb-3">Flags by Category</h3>
        <div className="space-y-2">
          {Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => (
              <div key={cat} className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted w-40 truncate">
                  {cat.replace(/_/g, ' ').toUpperCase()}
                </span>
                <div className="flex-1 bg-surface-2 rounded-full h-5 overflow-hidden">
                  <div
                    className="bg-accent/40 h-full rounded-full flex items-center justify-end pr-2"
                    style={{ width: `${Math.max((count / totalFlags) * 100, 10)}%` }}
                  >
                    <span className="text-xs font-mono text-accent">{count}</span>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Top Findings */}
      <div className="bg-surface border border-border rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted">Most Recent Findings</h3>
          <button
            onClick={() => onNavigate('flags')}
            className="text-xs text-accent hover:underline"
          >
            View all →
          </button>
        </div>
        <div className="space-y-2">
          {recentFlags.map((f) => (
            <div
              key={f._id}
              className="flex items-start gap-3 py-2 border-b border-border/30 last:border-0"
            >
              <SeverityBadge severity={f.severity} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{f.entity_name}</div>
                <div className="text-xs text-muted truncate">{f.description}</div>
              </div>
              <span className="text-xs text-muted font-mono shrink-0">
                {f.category.replace(/_/g, ' ')}
              </span>
            </div>
          ))}
          {recentFlags.length === 0 && (
            <div className="text-center text-muted text-sm py-4">No findings yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-surface border border-border rounded p-4">
      <div className="text-xs text-muted uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-2xl font-mono font-bold ${color || 'text-foreground'}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
