export const BOROS_API_BASE = 'https://api.boros.finance/core';

export const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://127.0.0.1:27017';
export const DB_NAME = 'boros_indexer';
export const PORT = parseInt(process.env.PORT ?? '3001', 10);

// Rate limiting delays (ms)
export const MARKET_DETAIL_DELAY = 100;
export const CANDLE_CHUNK_DELAY = 50;
export const CANDLE_MARKET_DELAY = 200;

// Candle fetching
export const CANDLE_CHUNK_SIZE = 150_000; // 500 candles * 5min * 60s
export const CANDLE_TIMEFRAME = '5m';

// Retry settings
export const RETRY_ATTEMPTS = 3;
export const RETRY_BASE_DELAY = 1000;

// Scheduler
export const HOURLY_INTERVAL = 60 * 60 * 1000;

// Pagination
export const MARKETS_PAGE_LIMIT = 100;

// Initial backfill lookback (seconds)
export const INITIAL_LOOKBACK = 365 * 24 * 60 * 60; // 1 year
