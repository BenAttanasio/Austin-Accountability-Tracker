'use client';

import { useState } from 'react';

const SEVERITY_LEVELS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function ExportTab() {
  const [generating, setGenerating] = useState(false);
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(
    new Set(SEVERITY_LEVELS)
  );

  const toggleSeverity = (sev: string) => {
    setSelectedSeverities(prev => {
      const next = new Set(prev);
      if (next.has(sev)) {
        // Don't allow deselecting all
        if (next.size > 1) next.delete(sev);
      } else {
        next.add(sev);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedSeverities(new Set(SEVERITY_LEVELS));

  const buildSeverityParams = () => {
    if (selectedSeverities.size === SEVERITY_LEVELS.length) return '';
    return '&severities=' + Array.from(selectedSeverities).join(',');
  };

  const downloadReport = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`/api/export?format=md${buildSeverityParams()}`);
      if (!res.ok) throw new Error('Failed to generate report');

      const blob = await res.blob();
      downloadBlob(blob, `austin-accountability-report-${new Date().toISOString().split('T')[0]}.md`);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const downloadCSV = async () => {
    try {
      const res = await fetch(`/api/export?format=csv${buildSeverityParams()}`);
      if (!res.ok) throw new Error('Failed to generate CSV');

      const blob = await res.blob();
      downloadBlob(blob, `austin-accountability-findings-${new Date().toISOString().split('T')[0]}.csv`);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
  };

  const severityColors: Record<string, string> = {
    CRITICAL: 'bg-critical/20 border-critical/40 text-critical',
    HIGH: 'bg-high/20 border-high/40 text-high',
    MEDIUM: 'bg-medium/20 border-medium/40 text-medium',
    LOW: 'bg-low/20 border-low/40 text-low',
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-2xl text-center space-y-8">
        <div>
          <h2 className="text-xl font-semibold mb-2">Export Data</h2>
          <p className="text-muted text-sm">
            Generate investigation reports and download raw data for further analysis.
          </p>
        </div>

        {/* Severity filter */}
        <div className="bg-surface border border-border rounded p-4 text-left">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold">Include Severities</div>
            <button
              onClick={selectAll}
              className="text-xs text-accent hover:underline"
            >
              Select All
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {SEVERITY_LEVELS.map(sev => (
              <label
                key={sev}
                className={`flex items-center gap-2 px-3 py-1.5 rounded border cursor-pointer text-xs font-mono transition-colors ${
                  selectedSeverities.has(sev)
                    ? severityColors[sev] || 'bg-surface-2 border-border'
                    : 'bg-surface-2 border-border text-muted opacity-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedSeverities.has(sev)}
                  onChange={() => toggleSeverity(sev)}
                  className="accent-accent"
                />
                {sev}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Investigation Report */}
          <div className="bg-surface border border-border rounded p-6 text-left">
            <div className="text-lg font-semibold mb-2">Investigation Report</div>
            <p className="text-muted text-xs mb-4">
              AI-generated comprehensive report with executive summary, detailed findings,
              cross-references, and recommended next steps for investigators.
            </p>
            <button
              onClick={downloadReport}
              disabled={generating}
              className="w-full px-4 py-2 bg-accent text-white rounded text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-50"
            >
              {generating ? 'Generating...' : 'Generate Report (.md)'}
            </button>
          </div>

          {/* Raw CSV */}
          <div className="bg-surface border border-border rounded p-6 text-left">
            <div className="text-lg font-semibold mb-2">Raw Data (CSV)</div>
            <p className="text-muted text-xs mb-4">
              All findings exported as CSV with every field. Suitable for import into
              spreadsheets, databases, or other analysis tools.
            </p>
            <button
              onClick={downloadCSV}
              className="w-full px-4 py-2 bg-surface-2 border border-border text-foreground rounded text-sm font-medium hover:bg-border/30 transition-colors"
            >
              Download CSV
            </button>
          </div>
        </div>

        <p className="text-xs text-muted">
          All data sourced from data.austintexas.gov public APIs. Flags indicate anomalies, not confirmed wrongdoing.
        </p>
      </div>
    </div>
  );
}
