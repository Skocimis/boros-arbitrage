import { connect } from './db/connection.js';
import { ensureIndexes } from './db/collections.js';
import { indexAllMarkets } from './indexer/marketIndexer.js';
import { backfillCandles } from './indexer/candleIndexer.js';
import { startScheduler } from './indexer/scheduler.js';
import { startServer } from './server.js';
import { log } from './util/logger.js';

async function main(): Promise<void> {
  log.info('Boros Indexer starting...');

  await connect();
  await ensureIndexes();

  const markets = await indexAllMarkets();
  const marketIds = markets.map((m) => m.marketId);

  await backfillCandles(marketIds);

  startServer();
  startScheduler();

  log.info('Boros Indexer fully operational');
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
