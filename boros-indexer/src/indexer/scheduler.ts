import { HOURLY_INTERVAL } from '../config.js';
import { indexAllMarkets } from './marketIndexer.js';
import { incrementalCandleUpdate } from './candleIndexer.js';
import { log } from '../util/logger.js';

async function runUpdate(): Promise<void> {
  log.info('=== Hourly update started ===');

  try {
    const markets = await indexAllMarkets();
    const marketIds = markets.map((m) => m.marketId);
    await incrementalCandleUpdate(marketIds);
  } catch (err) {
    log.error('Hourly update failed', err);
  }

  log.info('=== Hourly update complete ===');
}

export function startScheduler(): void {
  log.info(`Scheduler started: updates every ${HOURLY_INTERVAL / 1000 / 60} minutes`);
  setInterval(() => {
    void runUpdate();
  }, HOURLY_INTERVAL);
}
