import { fetchCandles } from '../api/borosClient.js';
import { marketsCollection, candlesCollection } from '../db/collections.js';
import { CANDLE_MARKET_DELAY, INITIAL_LOOKBACK } from '../config.js';
import { sleep } from '../util/sleep.js';
import { log } from '../util/logger.js';
import type { MarketDocument, CandleDocument } from '../types.js';

async function upsertCandles(candles: CandleDocument[]): Promise<void> {
  if (candles.length === 0) return;

  const col = candlesCollection();
  const ops = candles.map((c) => ({
    updateOne: {
      filter: { marketId: c.marketId, ts: c.ts },
      update: { $set: c },
      upsert: true,
    },
  }));

  const batchSize = 500;
  for (let i = 0; i < ops.length; i += batchSize) {
    await col.bulkWrite(ops.slice(i, i + batchSize), { ordered: false });
  }
}

async function updateMarketCandleMeta(marketId: number): Promise<void> {
  const col = candlesCollection();
  const markets = marketsCollection();

  const earliest = await col.findOne(
    { marketId },
    { sort: { ts: 1 }, projection: { ts: 1 } },
  );
  const latest = await col.findOne(
    { marketId },
    { sort: { ts: -1 }, projection: { ts: 1 } },
  );

  await markets.updateOne(
    { marketId },
    {
      $set: {
        startTime: earliest?.ts ?? null,
        lastCandleTs: latest?.ts ?? null,
      },
    },
  );
}

export async function backfillCandles(marketIds: number[]): Promise<void> {
  log.info(`Starting candle backfill for ${marketIds.length} markets`);
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < marketIds.length; i++) {
    const marketId = marketIds[i];

    try {
      const doc = await marketsCollection().findOne({ marketId }) as MarketDocument | null;
      const startFrom = doc?.lastCandleTs
        ? doc.lastCandleTs + 300
        : now - INITIAL_LOOKBACK;

      if (startFrom >= now) {
        log.info(`Market ${marketId}: candles already up to date`);
        continue;
      }

      const candles = await fetchCandles(marketId, startFrom, now);

      if (candles.length > 0) {
        const docs: CandleDocument[] = candles.map((c) => ({ ...c, marketId }));
        await upsertCandles(docs);
        await updateMarketCandleMeta(marketId);
        log.info(`Market ${marketId}: backfilled ${candles.length} candles`);
      } else {
        log.info(`Market ${marketId}: no candle data available`);
      }
    } catch (err) {
      log.error(`Market ${marketId}: candle backfill failed`, err);
    }

    if (i < marketIds.length - 1) {
      await sleep(CANDLE_MARKET_DELAY);
    }
  }

  log.info('Candle backfill complete');
}

export async function incrementalCandleUpdate(marketIds: number[]): Promise<void> {
  log.info(`Starting incremental candle update for ${marketIds.length} markets`);
  const now = Math.floor(Date.now() / 1000);

  for (let i = 0; i < marketIds.length; i++) {
    const marketId = marketIds[i];

    try {
      const doc = await marketsCollection().findOne({ marketId }) as MarketDocument | null;
      const startFrom = doc?.lastCandleTs
        ? doc.lastCandleTs + 300
        : now - INITIAL_LOOKBACK;

      if (startFrom >= now) continue;

      const candles = await fetchCandles(marketId, startFrom, now);

      if (candles.length > 0) {
        const docs: CandleDocument[] = candles.map((c) => ({ ...c, marketId }));
        await upsertCandles(docs);
        await updateMarketCandleMeta(marketId);
        log.info(`Market ${marketId}: added ${candles.length} new candles`);
      }
    } catch (err) {
      log.error(`Market ${marketId}: incremental update failed`, err);
    }

    if (i < marketIds.length - 1) {
      await sleep(CANDLE_MARKET_DELAY);
    }
  }

  log.info('Incremental candle update complete');
}
