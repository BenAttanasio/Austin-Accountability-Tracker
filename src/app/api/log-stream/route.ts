import { NextResponse } from 'next/server';
import { addLogListener, removeLogListener, getLogBuffer } from '@/lib/scanner';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send existing log buffer
      const buffer = getLogBuffer();
      for (const entry of buffer) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(entry)}\n\n`)
        );
      }

      // Listen for new entries
      const listener = (entry: { timestamp: string; source: string; message: string }) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(entry)}\n\n`)
          );
        } catch {
          removeLogListener(listener);
        }
      };

      addLogListener(listener);

      // Send heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          clearInterval(heartbeat);
          removeLogListener(listener);
        }
      }, 30000);

      // Cleanup happens via error handlers in listener and heartbeat
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
