import { AnalysisFlag, Finding, WatchlistEntry, LogEntry, Severity } from '@/types';
import { getDatabase } from './mongodb';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const BATCH_SIZE = 50;
const MAX_FLAGS_FOR_AI = 200; // cap to control cost/time

const SYSTEM_PROMPT = `You are a forensic financial auditor analyzing Austin, TX city government open data. You have been given flagged transactions that triggered automated anomaly detection, along with the entity's historical flag data if any exists. For each flag or group of related flags, provide:

1. SEVERITY: LOW / MEDIUM / HIGH / CRITICAL
2. PATTERN: What type of issue this represents (shell company network, conflict of interest, bid rigging, payment fraud, political patronage, spending irregularity, data quality issue)
3. ANALYSIS: A direct, plain-English explanation of why this is suspicious. Be specific about dollar amounts, dates, and connections. Do not hedge. If something looks like fraud, say it looks like fraud.
4. ESCALATION NOTE: If this entity has been flagged before, explicitly comment on whether the pattern is worsening.
5. NEXT STEPS: What a human investigator, journalist, or auditor should look at next. Be specific: name the records to pull, the questions to ask, the connections to verify.

You are writing for an audience of investigative journalists, city auditors, and concerned citizens. Be direct and factual.

Respond in JSON format as an array of objects with keys: severity, pattern, analysis, escalation_note, next_steps. Each object corresponds to one flag in the input.`;

interface AIReviewResult {
  severity: Severity;
  pattern: string;
  analysis: string;
  escalation_note: string;
  next_steps: string;
}

async function getEntityHistory(entityName: string): Promise<{
  watchlist: WatchlistEntry | null;
  findings: Finding[];
}> {
  const db = await getDatabase();
  const watchlist = await db.collection<WatchlistEntry>('watchlist').findOne({ entity_name: entityName });
  const findings = await db.collection<Finding>('findings')
    .find({ entity_name: entityName })
    .sort({ created_at: -1 })
    .limit(20)
    .toArray();
  return { watchlist, findings };
}

async function callClaude(flags: AnalysisFlag[], histories: Map<string, { watchlist: WatchlistEntry | null; findings: Finding[] }>): Promise<AIReviewResult[]> {
  if (!ANTHROPIC_API_KEY) return [];

  const flagsWithHistory = flags.map(flag => {
    const history = histories.get(flag.entity_name);
    return {
      ...flag,
      entity_history: history ? {
        flag_count: history.watchlist?.flag_count || 0,
        highest_severity: history.watchlist?.highest_severity || 'NONE',
        first_seen: history.watchlist?.first_seen || null,
        related_entities: history.watchlist?.related_entities || [],
        previous_findings: history.findings.map(f => ({
          category: f.category,
          severity: f.severity,
          description: f.description,
          created_at: f.created_at,
        })),
      } : null,
    };
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: `Analyze these ${flags.length} flagged items from Austin city government data:\n\n${JSON.stringify(flagsWithHistory, null, 2)}`,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const result = await response.json();
  const content = result.content?.[0]?.text || '';

  // Parse JSON from response (may be wrapped in markdown code blocks)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    return JSON.parse(jsonMatch[0]) as AIReviewResult[];
  } catch {
    return [];
  }
}

export async function runAIReview(
  flags: AnalysisFlag[],
  onLog?: (entry: LogEntry) => void
): Promise<Map<number, AIReviewResult>> {
  const results = new Map<number, AIReviewResult>();

  if (!ANTHROPIC_API_KEY) {
    onLog?.({
      timestamp: new Date().toISOString(),
      source: 'AI',
      message: 'ANTHROPIC_API_KEY not set. Skipping AI review.',
    });
    return results;
  }

  // Prioritize flags by severity so the most important get reviewed first,
  // then cap at MAX_FLAGS_FOR_AI to control cost.
  const SEVERITY_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const indexedFlags = flags.map((f, i) => ({ flag: f, originalIndex: i }));
  indexedFlags.sort((a, b) => (SEVERITY_RANK[b.flag.severity] || 0) - (SEVERITY_RANK[a.flag.severity] || 0));
  const prioritized = indexedFlags.slice(0, MAX_FLAGS_FOR_AI);

  const skipped = flags.length - prioritized.length;
  if (skipped > 0) {
    onLog?.({
      timestamp: new Date().toISOString(),
      source: 'AI',
      message: `Prioritized top ${prioritized.length} flags by severity (skipping ${skipped} lower-priority flags)`,
    });
  }

  onLog?.({
    timestamp: new Date().toISOString(),
    source: 'AI',
    message: `Sending ${prioritized.length} flags to Claude for review...`,
  });

  // Collect histories for all entities in the prioritized set
  const entityNames = [...new Set(prioritized.map(p => p.flag.entity_name))];
  const histories = new Map<string, { watchlist: WatchlistEntry | null; findings: Finding[] }>();

  for (const name of entityNames) {
    histories.set(name, await getEntityHistory(name));
  }

  // Process in batches
  const flagsToReview = prioritized.map(p => p.flag);
  for (let i = 0; i < flagsToReview.length; i += BATCH_SIZE) {
    const batch = flagsToReview.slice(i, i + BATCH_SIZE);

    try {
      const batchResults = await callClaude(batch, histories);

      for (let j = 0; j < batchResults.length && j < batch.length; j++) {
        // Map back to the original flag index
        results.set(prioritized[i + j].originalIndex, batchResults[j]);
      }

      onLog?.({
        timestamp: new Date().toISOString(),
        source: 'AI',
        message: `Batch ${Math.floor(i / BATCH_SIZE) + 1} complete: reviewed ${batch.length} flags`,
      });
    } catch (error) {
      onLog?.({
        timestamp: new Date().toISOString(),
        source: 'AI',
        message: `AI review batch error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const r of results.values()) {
    severityCounts[r.severity] = (severityCounts[r.severity] || 0) + 1;
  }

  onLog?.({
    timestamp: new Date().toISOString(),
    source: 'AI',
    message: `Analysis complete: ${severityCounts.CRITICAL} CRITICAL, ${severityCounts.HIGH} HIGH, ${severityCounts.MEDIUM} MEDIUM, ${severityCounts.LOW} LOW`,
  });

  return results;
}
