import { NextRequest, NextResponse } from 'next/server';
import { runScan, isScanRunning, addLogListener, removeLogListener } from '@/lib/scanner';
import { RunType, LogEntry } from '@/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes for Pro plan

export async function POST(request: NextRequest) {
  try {
    if (isScanRunning()) {
      return NextResponse.json({ error: 'A scan is already running' }, { status: 409 });
    }

    const body = await request.json();
    const type: RunType = body.type || 'manual_full';

    // Stream logs back in real-time via SSE.
    // The scan runs inside this same handler, so in-memory log listeners work.
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        const sendEvent = (data: Record<string, unknown>) => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Stream closed by client
          }
        };

        // Listen for all log entries broadcast during this scan
        const listener = (entry: LogEntry) => {
          sendEvent({ type: 'log', entry });
        };
        addLogListener(listener);

        // Run the scan within this same execution context
        runScan(type)
          .then((run) => {
            sendEvent({ type: 'complete', run_id: run.run_id, flags: run.flags_generated });
          })
          .catch((error) => {
            const msg = error instanceof Error ? error.message : String(error);
            sendEvent({ type: 'error', message: msg });
          })
          .finally(() => {
            removeLogListener(listener);
            try { controller.close(); } catch { /* already closed */ }
          });
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
