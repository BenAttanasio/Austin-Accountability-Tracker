import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    const db = await getDatabase();

    const [entries, total] = await Promise.all([
      db.collection('watchlist')
        .find({})
        .sort({ flag_count: -1, highest_severity: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('watchlist').countDocuments(),
    ]);

    return NextResponse.json({ entries, total, limit, offset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { entity_name, notes } = body;

    if (!entity_name) {
      return NextResponse.json({ error: 'Entity name required' }, { status: 400 });
    }

    const db = await getDatabase();

    await db.collection('watchlist').updateOne(
      { entity_name },
      { $set: { notes } }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
