import express from 'express';
import { marketsCollection } from './db/collections.js';
import { PORT } from './config.js';
import { log } from './util/logger.js';

export function startServer(): void {
  const app = express();

  app.get('/get-markets', async (_req, res) => {
    try {
      const markets = await marketsCollection()
        .find(
          {},
          { projection: { _id: 0, lastCandleTs: 0, lastUpdatedAt: 0 } },
        )
        .sort({ marketId: 1 })
        .toArray();

      res.json(markets);
    } catch (err) {
      log.error('GET /get-markets failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.listen(PORT, () => {
    log.info(`Server listening on port ${PORT}`);
  });
}
