import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { Finding, WatchlistEntry } from '@/types';
// utils available for formatting

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get('format') || 'csv';
  const severitiesParam = searchParams.get('severities'); // comma-separated: "CRITICAL,HIGH"
  const entityName = searchParams.get('entity'); // for single-entity export
  const findingIds = searchParams.get('ids'); // comma-separated finding IDs

  try {
    const db = await getDatabase();
    const filter: Record<string, unknown> = { dismissed: { $ne: true } };

    // Severity filter
    if (severitiesParam) {
      const severities = severitiesParam.split(',').map(s => s.trim().toUpperCase());
      filter.severity = { $in: severities };
    }

    // Single entity filter — use watchlist history for complete coverage,
    // since the same entity can appear with different name formatting across scans.
    if (entityName) {
      const { ObjectId } = await import('mongodb');
      const watchlistEntry = await db.collection('watchlist').findOne({ entity_name: entityName });
      if (watchlistEntry?.history?.length) {
        // Use the definitive list of finding IDs from the watchlist
        const historyIds = watchlistEntry.history
          .map((id: string | { toString(): string }) => {
            try { return new ObjectId(String(id)); } catch { return null; }
          })
          .filter(Boolean);
        filter._id = { $in: historyIds };
      } else {
        // Fallback: case-insensitive regex match
        filter.entity_name = { $regex: new RegExp(`^${entityName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
      }
    }

    // Specific finding IDs filter
    if (findingIds) {
      const { ObjectId } = await import('mongodb');
      const ids = findingIds.split(',').map(id => {
        try { return new ObjectId(id.trim()); } catch { return null; }
      }).filter(Boolean);
      if (ids.length > 0) {
        filter._id = { $in: ids };
      }
    }

    const findings = await db.collection<Finding>('findings')
      .find(filter)
      .sort({ severity: -1, created_at: -1 })
      .toArray();
    const watchlist = await db.collection<WatchlistEntry>('watchlist')
      .find({})
      .sort({ flag_count: -1 })
      .toArray();

    if (format === 'csv') {
      return generateCSV(findings);
    } else {
      const isTargeted = !!(entityName || findingIds);
      return await generateReport(findings, watchlist, isTargeted);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function generateCSV(findings: Finding[]): NextResponse {
  const headers = [
    'Entity Name', 'Entity Type', 'Category', 'Severity', 'Description',
    'AI Analysis', 'Source Dataset', 'Source URL', 'Created At', 'Run ID',
  ];

  const rows = findings.map(f => [
    `"${(f.entity_name || '').replace(/"/g, '""')}"`,
    f.entity_type,
    f.category,
    f.severity,
    `"${(f.description || '').replace(/"/g, '""')}"`,
    `"${(f.ai_analysis || '').replace(/"/g, '""')}"`,
    f.source_dataset,
    f.source_url,
    f.created_at?.toISOString() || '',
    f.run_id,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="austin-accountability-findings-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
}

async function generateReport(findings: Finding[], watchlist: WatchlistEntry[], isTargeted = false): Promise<NextResponse> {
  const today = new Date().toISOString().split('T')[0];
  const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
  const highCount = findings.filter(f => f.severity === 'HIGH').length;
  const mediumCount = findings.filter(f => f.severity === 'MEDIUM').length;
  const lowCount = findings.filter(f => f.severity === 'LOW').length;

  // Determine unique entities for targeted reports
  const uniqueEntities = [...new Set(findings.map(f => f.entity_name))];
  const reportTitle = isTargeted && uniqueEntities.length <= 3
    ? `Targeted Report: ${uniqueEntities.join(', ')}`
    : 'Investigation Report';

  let report = `# Austin Accountability Tracker - ${reportTitle}\n\n`;
  report += `**Generated:** ${today}\n\n`;
  if (isTargeted) {
    report += `**Scope:** ${findings.length} findings for ${uniqueEntities.length} entit${uniqueEntities.length === 1 ? 'y' : 'ies'}\n\n`;
  }
  report += `---\n\n`;

  // Executive Summary
  report += `## Executive Summary\n\n`;
  report += `This report contains **${findings.length} findings** from automated monitoring of Austin, TX city government open data.\n\n`;
  report += `- **CRITICAL:** ${criticalCount}\n`;
  report += `- **HIGH:** ${highCount}\n`;
  report += `- **MEDIUM:** ${mediumCount}\n`;
  report += `- **LOW:** ${lowCount}\n`;
  if (!isTargeted) {
    report += `- **Watchlist Entities:** ${watchlist.length}\n`;
    report += `- **Priority Investigations (3+ flags or CRITICAL):** ${watchlist.filter(w => w.flag_count >= 3 || w.highest_severity === 'CRITICAL').length}\n`;
  }
  report += `\n`;

  // If we have AI, generate a narrative summary
  if (ANTHROPIC_API_KEY && findings.length > 0) {
    try {
      const summaryPrompt = `Based on these ${findings.length} flags from Austin city government data monitoring, write a 2-3 paragraph executive summary highlighting the most important patterns and the entities that warrant the most immediate attention. Be direct and specific about dollar amounts and connections.\n\nTop findings:\n${findings.slice(0, 30).map(f => `- [${f.severity}] ${f.description}`).join('\n')}`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{ role: 'user', content: summaryPrompt }],
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const summary = result.content?.[0]?.text || '';
        if (summary) {
          report += summary + '\n\n';
        }
      }
    } catch {
      // AI summary failed, continue without it
    }
  }

  report += `---\n\n`;

  // Findings by severity
  const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  for (const sev of severityOrder) {
    const sevFindings = findings.filter(f => f.severity === sev);
    if (sevFindings.length === 0) continue;

    report += `## ${sev} Findings (${sevFindings.length})\n\n`;

    // Group by entity
    const byEntity = new Map<string, Finding[]>();
    for (const f of sevFindings) {
      if (!byEntity.has(f.entity_name)) byEntity.set(f.entity_name, []);
      byEntity.get(f.entity_name)!.push(f);
    }

    for (const [entity, entityFindings] of byEntity) {
      report += `### ${entity}\n\n`;
      report += `- **Type:** ${entityFindings[0].entity_type}\n`;
      report += `- **Flags:** ${entityFindings.length}\n\n`;

      for (const f of entityFindings) {
        report += `#### ${f.category.replace(/_/g, ' ').toUpperCase()}\n\n`;
        report += `${f.description}\n\n`;
        report += `- **Source:** [${f.source_dataset}](${f.source_url})\n`;
        report += `- **Flagged:** ${f.created_at?.toISOString().split('T')[0] || 'unknown'}\n`;

        if (f.ai_analysis) {
          report += `\n**AI Analysis:**\n${f.ai_analysis}\n`;
        }

        report += `\n`;
      }
    }
  }

  // Cross-reference section
  const crossRefs = findings.filter(f =>
    f.category === 'donor_vendor_match' || f.category === 'lobbyist_vendor_match'
  );

  if (crossRefs.length > 0) {
    report += `## Cross-References\n\n`;
    report += `| Type | Entity 1 | Entity 2 | Confidence | Details |\n`;
    report += `|------|----------|----------|------------|----------|\n`;

    for (const cr of crossRefs) {
      const d = cr.raw_data as Record<string, unknown>;
      report += `| ${cr.category.replace(/_/g, ' ')} | ${d.donor_name || d.client_name} | ${d.vendor_name} | ${d.match_confidence}% | ${cr.description.substring(0, 80)}... |\n`;
    }
    report += `\n`;
  }

  // Methodology
  report += `## Methodology\n\n`;
  report += `This report is generated by the Austin Accountability Tracker, which monitors the following public data sources via the Austin, TX Open Data Portal (data.austintexas.gov):\n\n`;
  report += `- City contracts and purchase orders\n`;
  report += `- eCheckbook payment data\n`;
  report += `- Operating budget vs expenditures\n`;
  report += `- Campaign finance contributions, expenditures, and loans\n`;
  report += `- Lobbyist client registrations\n\n`;
  report += `Automated checks include: vendor address clustering, spending spike detection, campaign-to-contract cross-referencing, duplicate payment detection, contract amendment tracking, and vague description flagging.\n\n`;

  // Disclaimer
  report += `## Disclaimer\n\n`;
  report += `This report is generated from public government data via automated analysis. Flags indicate statistical anomalies or pattern matches, **not confirmed wrongdoing**. All data sourced from data.austintexas.gov public APIs. This tool is designed to surface items worthy of further human review by investigative journalists, city auditors, and concerned citizens.\n`;

  return new NextResponse(report, {
    headers: {
      'Content-Type': 'text/markdown',
      'Content-Disposition': `attachment; filename="austin-accountability-report-${today}.md"`,
    },
  });
}
