import type { Market, Candle } from './types.ts';

const BOROS_URL = 'https://api.boros.finance/core';

interface ChartResponse {
  results: Candle[];
}

export async function fetchAllMarkets(): Promise<Market[]> {
  const res = await fetch('/indexer/get-markets');
  if (!res.ok) throw new Error(`Indexer responded with ${res.status}`);
  return res.json();
}

export async function fetchMarketDetail(marketId: number): Promise<Market> {
  const res = await fetch(`${BOROS_URL}/v1/markets/${marketId}`);
  if (!res.ok) throw new Error(`Market ${marketId}: ${res.status}`);
  return res.json();
}

export async function fetchChartData(
  marketId: number,
  startTimestamp: number,
  endTimestamp: number
): Promise<Candle[]> {
  const chunkSize = 150_000; // 500 candles * 5min * 60s
  const all: Candle[] = [];
  let cursor = startTimestamp;

  while (cursor < endTimestamp) {
    const chunkEnd = Math.min(cursor + chunkSize, endTimestamp);
    const params = new URLSearchParams({
      marketId: String(marketId),
      timeFrame: '5m',
      startTimestamp: String(cursor),
      endTimestamp: String(chunkEnd),
    });

    const res = await fetch(`${BOROS_URL}/v1/markets/chart?${params}`);
    if (res.status === 400) break; // range past available data
    if (!res.ok) throw new Error(`Chart API: ${res.status}`);
    const data: ChartResponse = await res.json();

    if (data.results.length === 0) break;
    all.push(...data.results);

    const lastTs = data.results[data.results.length - 1].ts;
    cursor = lastTs + 300;
  }

  return all;
}
