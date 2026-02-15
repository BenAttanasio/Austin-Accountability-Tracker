import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/mongodb';
import { ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const severity = searchParams.get('severity');
    const category = searchParams.get('category');
    searchParams.get('department'); // reserved for future use
    const watchlistOnly = searchParams.get('watchlist') === 'true';
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const sortBy = searchParams.get('sort') || 'created_at';
    const sortDir = searchParams.get('dir') === 'asc' ? 1 : -1;

    const db = await getDatabase();
    const filter: Record<string, unknown> = { dismissed: { $ne: true } };

    if (severity) filter.severity = severity;
    if (category) filter.category = category;

    if (watchlistOnly) {
      const watchlistNames = await db.collection('watchlist')
        .find({}, { projection: { entity_name: 1 } })
        .toArray();
      filter.entity_name = { $in: watchlistNames.map(w => w.entity_name) };
    }

    const [findings, total] = await Promise.all([
      db.collection('findings')
        .find(filter)
        .sort({ [sortBy]: sortDir })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('findings').countDocuments(filter),
    ]);

    return NextResponse.json({ findings, total, limit, offset });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, action, reason, note } = body;

    if (!id) {
      return NextResponse.json({ error: 'Finding ID required' }, { status: 400 });
    }

    const db = await getDatabase();

    if (action === 'dismiss') {
      await db.collection('findings').updateOne(
        { _id: new ObjectId(id) },
        {
          $set: {
            dismissed: true,
            dismissed_reason: reason || '',
            dismissed_at: new Date(),
          },
        }
      );
    } else if (action === 'note') {
      await db.collection('findings').updateOne(
        { _id: new ObjectId(id) },
        { $set: { admin_note: note } }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
