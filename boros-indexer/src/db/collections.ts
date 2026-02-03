import type { Collection } from 'mongodb';
import { getDb } from './connection.js';
import { log } from '../util/logger.js';
import type { MarketDocument, CandleDocument } from '../types.js';

export function marketsCollection(): Collection<MarketDocument> {
  return getDb().collection<MarketDocument>('markets');
}

export function candlesCollection(): Collection<CandleDocument> {
  return getDb().collection<CandleDocument>('candles');
}

export async function ensureIndexes(): Promise<void> {
  const markets = marketsCollection();
  const candles = candlesCollection();

  await markets.createIndex({ marketId: 1 }, { unique: true });
  await markets.createIndex({ 'metadata.platformName': 1, 'metadata.name': 1 });

  await candles.createIndex({ marketId: 1, ts: 1 }, { unique: true });
  await candles.createIndex({ marketId: 1, ts: -1 });

  log.info('Database indexes ensured');
}
