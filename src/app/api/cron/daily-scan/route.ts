import { NextRequest, NextResponse } from 'next/server';
import { runScan } from '@/lib/scanner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Verify cron authorization
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const run = await runScan('daily_cron');
    return NextResponse.json({
      success: true,
      run_id: run.run_id,
      flags_generated: run.flags_generated,
      escalations: run.escalations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
