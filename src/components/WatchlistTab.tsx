'use client';

import { useEffect, useState } from 'react';
import SeverityBadge from './SeverityBadge';
import { useAuth } from './AuthContext';

interface WatchlistEntry {
  _id: string;
  entity_name: string;
  entity_type: string;
  flag_count: number;
  first_seen: string;
  last_seen: string;
  highest_severity: string;
  related_entities: string[];
  notes: string;
}

interface Finding {
  _id: string;
  category: string;
  severity: string;
  description: string;
  created_at: string;
}

export default function WatchlistTab() {
  const { isAdmin } = useAuth();
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entityFindings, setEntityFindings] = useState<Finding[]>([]);
  const [noteText, setNoteText] = useState('');

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/watchlist?limit=200');
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch {} finally {
      setLoading(false);
    }
  };

  const handleExpand = async (entry: WatchlistEntry) => {
    if (expanded === entry.entity_name) {
      setExpanded(null);
      return;
    }
    setExpanded(entry.entity_name);
    setNoteText(entry.notes || '');

    // Load findings for this entity
    try {
      const res = await fetch(`/api/findings?limit=50&sort=created_at&dir=desc`);
      if (res.ok) {
        const data = await res.json();
        setEntityFindings(
          (data.findings || []).filter((f: Finding & { entity_name: string }) =>
            f.entity_name === entry.entity_name
          )
        );
      }
    } catch {}
  };

  const saveNote = async (entityName: string) => {
    await fetch('/api/watchlist', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entity_name: entityName, notes: noteText }),
    });
    loadEntries();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-muted font-mono text-sm">Loading watchlist...</span>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-4xl mb-4 opacity-20">◉</div>
          <h2 className="text-xl font-semibold mb-2">Watchlist Empty</h2>
          <p className="text-muted text-sm">
            Entities are automatically added when flagged during scans.
          </p>
        </div>
      </div>
    );
  }

  const priorityEntries = entries.filter(
    e => e.flag_count >= 3 || e.highest_severity === 'CRITICAL'
  );

  return (
    <div className="flex flex-col h-full overflow-auto">
      {/* Priority Investigations */}
      {priorityEntries.length > 0 && (
        <div className="p-4 border-b border-border bg-critical/5">
          <h3 className="text-sm font-semibold text-critical mb-2">
            Priority Investigations ({priorityEntries.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {priorityEntries.map((e) => (
              <span
                key={e.entity_name}
                className="px-2 py-1 bg-critical/10 border border-critical/30 rounded text-xs font-mono text-critical cursor-pointer hover:bg-critical/20"
                onClick={() => handleExpand(e)}
              >
                {e.entity_name} ({e.flag_count})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Main table */}
      <table className="w-full data-table">
        <thead className="sticky top-0 bg-surface z-10">
          <tr>
            <th>Severity</th>
            <th>Entity</th>
            <th>Type</th>
            <th>Flags</th>
            <th>First Seen</th>
            <th>Last Seen</th>
            <th>Related</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <>
              <tr
                key={e.entity_name}
                className="cursor-pointer"
                onClick={() => handleExpand(e)}
              >
                <td><SeverityBadge severity={e.highest_severity} /></td>
                <td className="font-medium">
                  {e.entity_name}
                  {e.flag_count >= 3 && (
                    <span className="ml-2 text-xs text-critical font-mono">PRIORITY</span>
                  )}
                </td>
                <td className="text-xs text-muted font-mono">{e.entity_type}</td>
                <td className="font-mono font-bold">{e.flag_count}</td>
                <td className="text-xs text-muted font-mono">
                  {new Date(e.first_seen).toLocaleDateString()}
                </td>
                <td className="text-xs text-muted font-mono">
                  {new Date(e.last_seen).toLocaleDateString()}
                </td>
                <td className="text-xs text-muted">
                  {e.related_entities?.length || 0} connected
                </td>
              </tr>
              {expanded === e.entity_name && (
                <tr key={`${e.entity_name}-detail`}>
                  <td colSpan={7} className="bg-surface-2 p-4">
                    <div className="space-y-4">
                      {/* Related entities */}
                      {e.related_entities?.length > 0 && (
                        <div>
                          <div className="text-xs text-muted uppercase tracking-wider mb-2">
                            Related Entities
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {e.related_entities.map((rel) => (
                              <span key={rel} className="px-2 py-1 bg-accent/10 border border-accent/30 rounded text-xs">
                                {rel}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Timeline */}
                      <div>
                        <div className="text-xs text-muted uppercase tracking-wider mb-2">
                          Flag History
                        </div>
                        <div className="space-y-2">
                          {entityFindings.map((f) => (
                            <div key={f._id} className="flex items-start gap-3 py-1">
                              <SeverityBadge severity={f.severity} />
                              <span className="text-xs font-mono text-muted">
                                {new Date(f.created_at).toLocaleDateString()}
                              </span>
                              <span className="text-sm flex-1">{f.description}</span>
                            </div>
                          ))}
                          {entityFindings.length === 0 && (
                            <span className="text-muted text-sm">Loading history...</span>
                          )}
                        </div>
                      </div>

                      {/* Admin notes */}
                      {isAdmin && (
                        <div>
                          <div className="text-xs text-muted uppercase tracking-wider mb-2">
                            Admin Notes
                          </div>
                          <div className="flex gap-2">
                            <textarea
                              value={noteText}
                              onChange={ev => setNoteText(ev.target.value)}
                              className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm resize-none"
                              rows={2}
                              placeholder="Add investigation notes..."
                            />
                            <button
                              onClick={() => saveNote(e.entity_name)}
                              className="px-3 py-2 bg-accent/20 text-accent border border-accent/30 rounded text-sm hover:bg-accent/30"
                            >
                              Save
                            </button>
                          </div>
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
    </div>
  );
}
