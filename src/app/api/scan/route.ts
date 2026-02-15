import { NextRequest, NextResponse } from 'next/server';
import { runScan, isScanRunning } from '@/lib/scanner';
import { RunType } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for Pro plan

export async function POST(request: NextRequest) {
  try {
    if (isScanRunning()) {
      return NextResponse.json({ error: 'A scan is already running' }, { status: 409 });
    }

    const body = await request.json();
    const type: RunType = body.type || 'manual_full';

    // Don't await - run in background and return immediately
    const scanPromise = runScan(type);

    // For quick scans, we can try to wait
    if (type === 'manual_quick') {
      try {
        const result = await Promise.race([
          scanPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 55000)),
        ]);
        return NextResponse.json({ success: true, run: result });
      } catch (error) {
        if (error instanceof Error && error.message === 'timeout') {
          return NextResponse.json({
            success: true,
            message: 'Scan started, running in background. Check /api/status for progress.',
          });
        }
        throw error;
      }
    }

    // For full scans, don't wait
    scanPromise.catch(err => {
      console.error('Background scan failed:', err);
    });

    return NextResponse.json({
      success: true,
      message: 'Scan started. Monitor progress via the Live Log tab.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
