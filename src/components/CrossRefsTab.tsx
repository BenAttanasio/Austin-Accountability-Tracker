'use client';

import { useEffect, useState } from 'react';
import SeverityBadge from './SeverityBadge';

interface Finding {
  _id: string;
  entity_name: string;
  severity: string;
  category: string;
  description: string;
  raw_data: Record<string, unknown>;
  source_url: string;
}

type SubTab = 'donor_vendor' | 'lobbyist_vendor' | 'network';

export default function CrossRefsTab() {
  const [subTab, setSubTab] = useState<SubTab>('donor_vendor');
  const [donorMatches, setDonorMatches] = useState<Finding[]>([]);
  const [lobbyistMatches, setLobbyistMatches] = useState<Finding[]>([]);
  const [watchlistEntities, setWatchlistEntities] = useState<Array<{ entity_name: string; related_entities: string[]; flag_count: number; highest_severity: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        const [donorRes, lobbyistRes, watchlistRes] = await Promise.all([
          fetch('/api/findings?category=donor_vendor_match&limit=200'),
          fetch('/api/findings?category=lobbyist_vendor_match&limit=200'),
          fetch('/api/watchlist?limit=200'),
        ]);

        if (donorRes.ok) {
          const data = await donorRes.json();
          setDonorMatches(data.findings || []);
        }
        if (lobbyistRes.ok) {
          const data = await lobbyistRes.json();
          setLobbyistMatches(data.findings || []);
        }
        if (watchlistRes.ok) {
          const data = await watchlistRes.json();
          setWatchlistEntities(data.entries || []);
        }
      } catch {} finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const renderMatchTable = (matches: Finding[], type: 'donor' | 'lobbyist') => {
    if (matches.length === 0) {
      return (
        <div className="text-center text-muted py-12">
          No {type === 'donor' ? 'donor-vendor' : 'lobbyist-vendor'} matches found yet.
          Run a scan to detect cross-references.
        </div>
      );
    }

    return (
      <table className="w-full data-table">
        <thead className="sticky top-0 bg-surface z-10">
          <tr>
            <th>Severity</th>
            <th>{type === 'donor' ? 'Donor Name' : 'Client Name'}</th>
            <th>Vendor Name</th>
            <th>Confidence</th>
            <th>{type === 'donor' ? 'Donated' : 'Lobbying'}</th>
            <th>Contracts</th>
            <th>Departments</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m) => {
            const d = m.raw_data;
            return (
              <tr key={m._id}>
                <td><SeverityBadge severity={m.severity} /></td>
                <td className="font-medium">{String(d.donor_name || d.client_name || m.entity_name)}</td>
                <td>{String(d.vendor_name || '')}</td>
                <td className="font-mono text-sm">
                  <span className={`${Number(d.match_confidence) >= 95 ? 'text-critical' : Number(d.match_confidence) >= 90 ? 'text-high' : 'text-medium'}`}>
                    {String(d.match_confidence)}%
                  </span>
                </td>
                <td className="font-mono text-sm">
                  {d.donation_total ? `$${Number(d.donation_total).toLocaleString()}` : '-'}
                </td>
                <td className="font-mono text-sm">
                  ${Number(d.contract_total || 0).toLocaleString()}
                </td>
                <td className="text-xs text-muted max-w-xs truncate">
                  {Array.isArray(d.departments) ? (d.departments as string[]).join(', ') : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const renderNetwork = () => {
    const connected = watchlistEntities.filter(e => e.related_entities && e.related_entities.length > 0);

    if (connected.length === 0) {
      return (
        <div className="text-center text-muted py-12">
          No entity network connections detected yet.
          Connections form when flagged entities share addresses, contacts, or other identifiers.
        </div>
      );
    }

    return (
      <div className="space-y-4 p-4">
        {connected.map((entity) => (
          <div key={entity.entity_name} className="bg-surface-2 border border-border rounded p-4">
            <div className="flex items-center gap-3 mb-3">
              <SeverityBadge severity={entity.highest_severity} />
              <span className="font-medium">{entity.entity_name}</span>
              <span className="text-xs text-muted font-mono">
                {entity.flag_count} flags
              </span>
            </div>
            <div className="pl-4 border-l-2 border-accent/30 space-y-1">
              {entity.related_entities.map((rel) => (
                <div key={rel} className="flex items-center gap-2 text-sm">
                  <span className="text-accent">↳</span>
                  <span>{rel}</span>
                  {watchlistEntities.find(w => w.entity_name === rel) && (
                    <span className="text-xs text-critical font-mono">(also flagged)</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Sub-tabs */}
      <div className="flex border-b border-border bg-surface">
        {([
          { id: 'donor_vendor', label: 'Donor-Vendor Matches' },
          { id: 'lobbyist_vendor', label: 'Lobbyist-Vendor Matches' },
          { id: 'network', label: 'Entity Network' },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
              subTab === tab.id
                ? 'border-accent text-accent'
                : 'border-transparent text-muted hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.id === 'donor_vendor' && donorMatches.length > 0 && (
              <span className="ml-2 text-xs font-mono bg-surface-2 rounded px-1.5 py-0.5">
                {donorMatches.length}
              </span>
            )}
            {tab.id === 'lobbyist_vendor' && lobbyistMatches.length > 0 && (
              <span className="ml-2 text-xs font-mono bg-surface-2 rounded px-1.5 py-0.5">
                {lobbyistMatches.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-muted font-mono text-sm">Loading...</span>
          </div>
        ) : (
          <>
            {subTab === 'donor_vendor' && renderMatchTable(donorMatches, 'donor')}
            {subTab === 'lobbyist_vendor' && renderMatchTable(lobbyistMatches, 'lobbyist')}
            {subTab === 'network' && renderNetwork()}
          </>
        )}
      </div>
    </div>
  );
}
