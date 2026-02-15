import { MongoClient, Db } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI || '';
const DB_NAME = 'austin_accountability';

if (!MONGODB_URI) {
  console.warn('MONGODB_URI not set. Database operations will fail.');
}

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getDatabase(): Promise<Db> {
  if (cachedDb && cachedClient) {
    return cachedDb;
  }

  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10,
    minPoolSize: 1,
    maxIdleTimeMS: 60000,
  });

  await client.connect();
  const db = client.db(DB_NAME);

  cachedClient = client;
  cachedDb = db;

  return db;
}

export async function ensureIndexes(): Promise<void> {
  const db = await getDatabase();

  // Findings indexes
  await db.collection('findings').createIndex({ entity_name: 1 });
  await db.collection('findings').createIndex({ category: 1 });
  await db.collection('findings').createIndex({ severity: 1 });
  await db.collection('findings').createIndex({ created_at: -1 });
  await db.collection('findings').createIndex({ run_id: 1 });

  // Watchlist indexes
  await db.collection('watchlist').createIndex({ entity_name: 1 }, { unique: true });
  await db.collection('watchlist').createIndex({ flag_count: -1 });
  await db.collection('watchlist').createIndex({ highest_severity: 1 });

  // Entities indexes
  await db.collection('entities').createIndex({ name: 1 }, { unique: true });
  await db.collection('entities').createIndex({ type: 1 });

  // Runs indexes
  await db.collection('runs').createIndex({ run_id: 1 }, { unique: true });
  await db.collection('runs').createIndex({ started_at: -1 });
}
