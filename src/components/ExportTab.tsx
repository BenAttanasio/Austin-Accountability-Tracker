'use client';

import { useState } from 'react';

export default function ExportTab() {
  const [generating, setGenerating] = useState(false);

  const downloadReport = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/export?format=md');
      if (!res.ok) throw new Error('Failed to generate report');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `austin-accountability-report-${new Date().toISOString().split('T')[0]}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setGenerating(false);
    }
  };

  const downloadCSV = async () => {
    try {
      const res = await fetch('/api/export?format=csv');
      if (!res.ok) throw new Error('Failed to generate CSV');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `austin-accountability-findings-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('CSV export failed:', err);
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <div className="max-w-lg text-center space-y-8">
        <div>
          <h2 className="text-xl font-semibold mb-2">Export Data</h2>
          <p className="text-muted text-sm">
            Generate investigation reports and download raw data for further analysis.
          </p>
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
