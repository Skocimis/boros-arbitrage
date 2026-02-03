import {
  BOROS_API_BASE,
  MARKETS_PAGE_LIMIT,
  CANDLE_CHUNK_SIZE,
  CANDLE_TIMEFRAME,
  CANDLE_CHUNK_DELAY,
} from '../config.js';
import { retry } from '../util/retry.js';
import { sleep } from '../util/sleep.js';
import type { BorosMarket, MarketsListResponse, Candle, ChartResponse } from '../types.js';

export async function fetchMarketsList(skip: number, limit: number): Promise<MarketsListResponse> {
  return retry(async () => {
    const url = `${BOROS_API_BASE}/v1/markets?isWhitelisted=true&skip=${skip}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetchMarketsList failed: ${res.status}`);
    return res.json() as Promise<MarketsListResponse>;
  }, `fetchMarketsList(skip=${skip})`);
}

export async function fetchAllMarketIds(): Promise<number[]> {
  const ids: number[] = [];
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    const data = await fetchMarketsList(skip, MARKETS_PAGE_LIMIT);
    total = data.total;
    for (const m of data.results) {
      ids.push(m.marketId);
    }
    skip += MARKETS_PAGE_LIMIT;
  }

  return ids;
}

export async function fetchMarketDetail(marketId: number): Promise<BorosMarket | null> {
  return retry(async () => {
    const res = await fetch(`${BOROS_API_BASE}/v1/markets/${marketId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`fetchMarketDetail(${marketId}) failed: ${res.status}`);
    return res.json() as Promise<BorosMarket>;
  }, `fetchMarketDetail(${marketId})`);
}

export async function fetchCandles(
  marketId: number,
  startTimestamp: number,
  endTimestamp: number,
): Promise<Candle[]> {
  const all: Candle[] = [];
  let cursor = startTimestamp;
  let foundData = false;

  while (cursor < endTimestamp) {
    const chunkEnd = Math.min(cursor + CANDLE_CHUNK_SIZE, endTimestamp);

    const candles = await retry(async () => {
      const url = `${BOROS_API_BASE}/v1/markets/chart?marketId=${marketId}&timeFrame=${CANDLE_TIMEFRAME}&startTimestamp=${cursor}&endTimestamp=${chunkEnd}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetchCandles(${marketId}) chunk failed: ${res.status}`);
      const data = (await res.json()) as ChartResponse;
      return data.results;
    }, `fetchCandles(${marketId}, chunk@${cursor})`);

    if (candles.length === 0) {
      if (foundData) break; // past the end of available data
      cursor = chunkEnd;    // still searching for where data starts
      continue;
    }

    foundData = true;
    all.push(...candles);

    const lastTs = candles[candles.length - 1].ts;
    cursor = lastTs + 300;

    if (cursor < endTimestamp) {
      await sleep(CANDLE_CHUNK_DELAY);
    }
  }

  return all;
}
