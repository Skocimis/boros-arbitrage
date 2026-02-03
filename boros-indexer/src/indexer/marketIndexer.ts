import { fetchAllMarketIds, fetchMarketDetail } from '../api/borosClient.js';
import { marketsCollection } from '../db/collections.js';
import { MARKET_DETAIL_DELAY } from '../config.js';
import { sleep } from '../util/sleep.js';
import { log } from '../util/logger.js';
import type { BorosMarket, MarketDocument } from '../types.js';

export async function discoverMaxId(): Promise<number> {
  const ids = await fetchAllMarketIds();
  if (ids.length === 0) return 0;
  return Math.max(...ids);
}

export async function indexAllMarkets(): Promise<BorosMarket[]> {
  const maxId = await discoverMaxId();
  log.info(`Market discovery complete. Max market ID: ${maxId}`);

  const markets: BorosMarket[] = [];
  const col = marketsCollection();

  for (let id = 1; id <= maxId; id++) {
    const market = await fetchMarketDetail(id);
    if (!market) {
      continue;
    }

    markets.push(market);

    const now = Date.now();
    await col.updateOne(
      { marketId: id },
      {
        $set: {
          ...market,
          lastUpdatedAt: now,
        } as Partial<MarketDocument>,
        $setOnInsert: {
          startTime: null,
          lastCandleTs: null,
        },
      },
      { upsert: true },
    );

    log.info(`Indexed market ${id}: ${market.metadata.platformName} ${market.metadata.name} [${market.state}]`);

    if (id < maxId) {
      await sleep(MARKET_DETAIL_DELAY);
    }
  }

  log.info(`Market indexing complete. ${markets.length} markets indexed.`);
  return markets;
}
