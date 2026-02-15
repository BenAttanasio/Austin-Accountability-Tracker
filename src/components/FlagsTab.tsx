'use client';

import { useEffect, useState, useCallback } from 'react';
import SeverityBadge from './SeverityBadge';
import { useAuth } from './AuthContext';

interface Finding {
  _id: string;
  entity_name: string;
  entity_type: string;
  category: string;
  severity: string;
  description: string;
  raw_data: Record<string, unknown>;
  source_dataset: string;
  source_url: string;
  ai_analysis: string | null;
  created_at: string;
  run_id: string;
}

export default function FlagsTab() {
  const { isAdmin } = useAuth();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState('');

  // Filters
  const [severity, setSeverity] = useState('');
  const [category, setCategory] = useState('');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const loadFindings = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: pageSize.toString(),
        offset: (page * pageSize).toString(),
        sort: sortBy,
        dir: sortDir,
      });
      if (severity) params.set('severity', severity);
      if (category) params.set('category', category);
      if (watchlistOnly) params.set('watchlist', 'true');

      const res = await fetch(`/api/findings?${params}`);
      if (res.ok) {
        const data = await res.json();
        setFindings(data.findings || []);
        setTotal(data.total || 0);
      }
    } catch {} finally {
      setLoading(false);
    }
  }, [severity, category, watchlistOnly, sortBy, sortDir, page]);

  useEffect(() => {
    loadFindings();
  }, [loadFindings]);

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const handleDismiss = async (id: string) => {
    if (!dismissReason.trim()) return;
    await fetch('/api/findings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'dismiss', reason: dismissReason }),
    });
    setDismissReason('');
    setExpanded(null);
    loadFindings();
  };

  const SortHeader = ({ field, children }: { field: string; children: React.ReactNode }) => (
    <th
      className="cursor-pointer select-none hover:text-foreground"
      onClick={() => handleSort(field)}
    >
      {children}
      {sortBy === field && (
        <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
      )}
    </th>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <div className="p-4 border-b border-border bg-surface flex flex-wrap gap-3 items-center">
        <select
          value={severity}
          onChange={e => { setSeverity(e.target.value); setPage(0); }}
          className="bg-surface-2 border border-border text-sm rounded px-3 py-1.5 text-foreground"
        >
          <option value="">All Severities</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="HIGH">HIGH</option>
          <option value="MEDIUM">MEDIUM</option>
          <option value="LOW">LOW</option>
        </select>

        <select
          value={category}
          onChange={e => { setCategory(e.target.value); setPage(0); }}
          className="bg-surface-2 border border-border text-sm rounded px-3 py-1.5 text-foreground"
        >
          <option value="">All Categories</option>
          <option value="address_cluster">Address Cluster</option>
          <option value="vendor_anomaly">Vendor Anomaly</option>
          <option value="spending_spike">Spending Spike</option>
          <option value="donor_vendor_match">Donor-Vendor Match</option>
          <option value="lobbyist_vendor_match">Lobbyist-Vendor Match</option>
          <option value="duplicate_payment">Duplicate Payment</option>
          <option value="contract_amendment">Contract Amendment</option>
          <option value="vague_description">Vague Description</option>
          <option value="similar_names">Similar Names</option>
        </select>

        <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={watchlistOnly}
            onChange={e => { setWatchlistOnly(e.target.checked); setPage(0); }}
            className="accent-accent"
          />
          Watchlist only
        </label>

        <span className="ml-auto text-xs text-muted font-mono">
          {total.toLocaleString()} findings
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-muted font-mono text-sm">Loading...</span>
          </div>
        ) : (
          <table className="w-full data-table">
            <thead className="sticky top-0 bg-surface z-10">
              <tr>
                <SortHeader field="severity">Severity</SortHeader>
                <th>Category</th>
                <SortHeader field="entity_name">Entity</SortHeader>
                <th>Description</th>
                <SortHeader field="created_at">Flagged</SortHeader>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <>
                  <tr
                    key={f._id}
                    className="cursor-pointer"
                    onClick={() => setExpanded(expanded === f._id ? null : f._id)}
                  >
                    <td><SeverityBadge severity={f.severity} /></td>
                    <td className="font-mono text-xs text-muted">
                      {f.category.replace(/_/g, ' ')}
                    </td>
                    <td className="font-medium">{f.entity_name}</td>
                    <td className="max-w-md truncate text-muted">{f.description}</td>
                    <td className="font-mono text-xs text-muted whitespace-nowrap">
                      {new Date(f.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                  {expanded === f._id && (
                    <tr key={`${f._id}-detail`}>
                      <td colSpan={5} className="bg-surface-2 p-4">
                        <div className="space-y-3">
                          <div>
                            <div className="text-xs text-muted uppercase tracking-wider mb-1">Description</div>
                            <div className="text-sm">{f.description}</div>
                          </div>

                          {f.ai_analysis && (
                            <div>
                              <div className="text-xs text-muted uppercase tracking-wider mb-1">AI Analysis</div>
                              <div className="text-sm whitespace-pre-wrap bg-background rounded p-3 border border-border">
                                {f.ai_analysis}
                              </div>
                            </div>
                          )}

                          <div>
                            <div className="text-xs text-muted uppercase tracking-wider mb-1">Raw Data</div>
                            <pre className="text-xs font-mono bg-background rounded p-3 border border-border overflow-x-auto">
                              {JSON.stringify(f.raw_data, null, 2)}
                            </pre>
                          </div>

                          <div className="flex gap-4 text-xs">
                            <a
                              href={f.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent hover:underline"
                            >
                              View source data →
                            </a>
                            <span className="text-muted">Dataset: {f.source_dataset}</span>
                            <span className="text-muted">Run: {f.run_id?.substring(0, 8)}</span>
                          </div>

                          {isAdmin && (
                            <div className="flex gap-2 items-center pt-2 border-t border-border">
                              <input
                                type="text"
                                placeholder="Reason for dismissal..."
                                value={dismissReason}
                                onChange={e => setDismissReason(e.target.value)}
                                className="flex-1 bg-background border border-border rounded px-3 py-1.5 text-sm"
                              />
                              <button
                                onClick={() => handleDismiss(f._id)}
                                className="px-3 py-1.5 bg-critical/20 text-critical border border-critical/30 rounded text-sm hover:bg-critical/30"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="p-3 border-t border-border bg-surface flex items-center justify-between">
          <button
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 text-sm bg-surface-2 border border-border rounded disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-xs text-muted font-mono">
            Page {page + 1} of {Math.ceil(total / pageSize)}
          </span>
          <button
            disabled={(page + 1) * pageSize >= total}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 text-sm bg-surface-2 border border-border rounded disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
