import { v4 as uuidv4 } from 'uuid';
import { Run, Finding, LogEntry, RunType } from '@/types';
import { getDatabase, ensureIndexes } from './mongodb';
import { fetchAllDatasets } from './socrata';
import { runTier1Analysis } from './analysis';
import { runAIReview } from './ai-review';
import { processEscalations, updateEntities } from './escalation';
import { maxSeverity } from './utils';

// Global log buffer for SSE streaming
let currentLogBuffer: LogEntry[] = [];
let logListeners: ((entry: LogEntry) => void)[] = [];

export function addLogListener(listener: (entry: LogEntry) => void) {
  logListeners.push(listener);
}

export function removeLogListener(listener: (entry: LogEntry) => void) {
  logListeners = logListeners.filter(l => l !== listener);
}

export function getLogBuffer(): LogEntry[] {
  return [...currentLogBuffer];
}

function broadcastLog(entry: LogEntry) {
  currentLogBuffer.push(entry);
  // Keep buffer under 1000 entries
  if (currentLogBuffer.length > 1000) {
    currentLogBuffer = currentLogBuffer.slice(-500);
  }
  for (const listener of logListeners) {
    try { listener(entry); } catch { /* ignore */ }
  }
}

let isRunning = false;

export function isScanRunning(): boolean {
  return isRunning;
}

export async function runScan(type: RunType): Promise<Run> {
  if (isRunning) {
    throw new Error('A scan is already running');
  }

  isRunning = true;
  currentLogBuffer = [];
  const runId = uuidv4();
  const db = await getDatabase();

  await ensureIndexes();

  const run: Run = {
    run_id: runId,
    started_at: new Date(),
    completed_at: null,
    type,
    records_fetched: {},
    flags_generated: 0,
    new_watchlist_entries: 0,
    escalations: 0,
    status: 'running',
    log: [],
  };

  await db.collection('runs').insertOne(run);

  const onLog = (entry: LogEntry) => {
    run.log.push(entry);
    broadcastLog(entry);
  };

  try {
    onLog({ timestamp: new Date().toISOString(), source: 'SYSTEM', message: `Starting ${type} scan (run: ${runId})` });

    // Step 1: Fetch data
    const mode = type === 'manual_quick' ? 'quick' : 'full';
    const data = await fetchAllDatasets({ mode, onLog });

    // Record fetch counts
    for (const [key, records] of Object.entries(data)) {
      run.records_fetched[key] = records.length;
    }

    // Step 2: Update entity database
    onLog({ timestamp: new Date().toISOString(), source: 'DB', message: 'Updating entity database...' });
    await updateEntities(data);

    // Step 3: Run Tier 1 analysis
    const flags = runTier1Analysis(data, onLog);

    // Step 4: Run Tier 2 AI review
    const aiResults = await runAIReview(flags, onLog);

    // Step 5: Store findings
    onLog({ timestamp: new Date().toISOString(), source: 'DB', message: `Storing ${flags.length} findings...` });

    const findingsToInsert: Finding[] = flags.map((flag, index) => {
      const aiResult = aiResults.get(index);
      return {
        entity_name: flag.entity_name,
        entity_type: flag.entity_type,
        category: flag.category,
        severity: aiResult ? maxSeverity(flag.severity, aiResult.severity) as Finding['severity'] : flag.severity,
        description: flag.description,
        raw_data: flag.raw_data,
        source_dataset: flag.source_dataset,
        source_url: flag.source_url,
        ai_analysis: aiResult
          ? `**Pattern:** ${aiResult.pattern}\n\n${aiResult.analysis}\n\n**Escalation:** ${aiResult.escalation_note}\n\n**Next Steps:** ${aiResult.next_steps}`
          : null,
        ai_severity: aiResult?.severity || null,
        created_at: new Date(),
        run_id: runId,
      };
    });

    if (findingsToInsert.length > 0) {
      const result = await db.collection('findings').insertMany(findingsToInsert);
      // Update findings with their IDs
      const insertedIds = Object.values(result.insertedIds);
      for (let i = 0; i < findingsToInsert.length; i++) {
        findingsToInsert[i]._id = insertedIds[i];
      }
    }

    // Step 6: Process escalations
    const { newWatchlist, escalations: esc } = await processEscalations(findingsToInsert, onLog);

    // Update run record
    run.flags_generated = flags.length;
    run.new_watchlist_entries = newWatchlist;
    run.escalations = esc;
    run.status = 'completed';
    run.completed_at = new Date();

    await db.collection('runs').updateOne(
      { run_id: runId },
      { $set: run }
    );

    onLog({
      timestamp: new Date().toISOString(),
      source: 'SYSTEM',
      message: `Scan complete. ${flags.length} new flags. ${esc} escalations. ${newWatchlist} new watchlist entries.`,
    });

    return run;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onLog({ timestamp: new Date().toISOString(), source: 'SYSTEM', message: `Scan failed: ${msg}` });

    run.status = 'failed';
    run.completed_at = new Date();
    await db.collection('runs').updateOne(
      { run_id: runId },
      { $set: { status: 'failed', completed_at: new Date(), log: run.log } }
    );

    throw error;
  } finally {
    isRunning = false;
  }
}
