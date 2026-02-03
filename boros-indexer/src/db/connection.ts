import { MongoClient, type Db } from 'mongodb';
import { MONGO_URI, DB_NAME } from '../config.js';
import { log } from '../util/logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connect(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  log.info(`Connected to MongoDB: ${DB_NAME}`);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not connected. Call connect() first.');
  return db;
}

export async function close(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    log.info('MongoDB connection closed');
  }
}
