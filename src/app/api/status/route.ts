import { NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { isScanRunning } from '@/lib/scanner';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = await getDatabase();

    const [lastRun, flagCounts, totalFindings, totalWatchlist] = await Promise.all([
      db.collection('runs').findOne({}, { sort: { started_at: -1 } }),
      db.collection('findings').aggregate([
        { $match: { dismissed: { $ne: true } } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]).toArray(),
      db.collection('findings').countDocuments({ dismissed: { $ne: true } }),
      db.collection('watchlist').countDocuments(),
    ]);

    const counts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
    for (const fc of flagCounts) {
      counts[fc._id as string] = fc.count;
    }

    return NextResponse.json({
      last_run: lastRun || null,
      is_running: isScanRunning(),
      flag_counts: counts,
      total_findings: totalFindings,
      total_watchlist: totalWatchlist,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
