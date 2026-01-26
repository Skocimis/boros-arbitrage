/**
 * @file arbitrage-monitor.ts
 * @description Real-time monitoring dashboard for Boros Yield Unit (YU) arbitrage opportunities.
 *   Tracks cross-exchange Implied APR spreads, calculates slippage impact,
 *   and saves snapshots of the best opportunities at various liquidity levels.
 *
 * @usage
 *   npm run monitor
 *   npx tsx src/arbitrage-monitor.ts
 *
 * @dependencies
 *   - axios: HTTP client for Boros API calls
 *   - dotenv: Environment variable management
 *   - fs/path: File system operations for snapshot persistence
 *
 * @behavior
 *   1. Fetches all Boros markets from API every 60 seconds
 *   2. Identifies arbitrage pairs (same asset, different platforms)
 *   3. Tracks current and historical max Implied APR spread for each pair
 *   4. Fetches order books for each opportunity
 *   5. Calculates TSI (Total Slippage Impact) at three size thresholds ($0, $100k, $1M)
 *   6. Computes VWAP-based "real APY" accounting for execution slippage
 *   7. Saves best snapshots to ./snapshots/{shortId}-{longId}/ directory
 *   8. Displays live console table with current opportunities
 *
 * @notes
 *   - Arbitrage profit = High Implied APR (short YU) - Low Implied APR (long YU)
 *   - TSI = |longExecApr - longMid| + |shortMid - shortExecApr|
 *   - Snapshots categorized by TSI threshold (<0.3%, <0.5%, any) and size ($0, $100k, $1M)
 *   - Uses VWAP (volume-weighted average price) for realistic execution estimates
 *   - Only "Normal" state markets are included (excludes CloseOnly, Paused, Settled)
 *   - Asset prices hardcoded: BTC=$100k, ETH=$3k, BNB=$1k
 *
 * @see arbitrage-scanner.ts for one-shot opportunity scanning
 * @see lib/functions/getOrderBookByMarketId.ts for order book types
 */

import 'dotenv/config';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

// Asset prices for USD conversion
const ASSET_PRICES: Record<string, number> = {
  BTC: 100000,
  ETH: 3000,
  BNB: 1000,
};

interface BorosMarket {
  marketId: number;
  metadata: {
    name: string;
    asset: string;
    platformName: string;
  };
  imData: {
    maturity: number;
  };
  data: {
    midApr?: string;
    markApr?: string;
  };
  state?: string;
}

interface ArbitrageOpportunity {
  longMarket: string;
  longMarketId: number;
  longApr: number;
  longPlatform: string;
  longMaturity: number;
  longState: string;
  shortMarket: string;
  shortMarketId: number;
  shortApr: number;
  shortPlatform: string;
  shortMaturity: number;
  shortState: string;
  netApy: number;
}

interface TrackedOpportunity {
  pairKey: string;
  longMarket: string;
  longMarketId: number;
  longPlatform: string;
  longMaturity: number;
  longState: string;
  shortMarket: string;
  shortMarketId: number;
  shortPlatform: string;
  shortMaturity: number;
  shortState: string;
  currentApy: number;
  maxApy: number;
  maxTimestamp: Date;
  currentLongApr: number;
  currentShortApr: number;
}

// Order book interfaces (parallel arrays, not array of objects)
interface OrderBookSide {
  ia: number[];  // APR values in basis points
  sz: string[];  // Size values in wei
}

interface OrderBook {
  short: OrderBookSide;  // Ask side (long positions use this)
  long: OrderBookSide;   // Bid side (short positions use this)
}

interface SnapshotResult {
  // Market info
  asset: string;
  pair: string;
  shortMarket: string;
  longMarket: string;
  shortMarketId: number;
  longMarketId: number;
  shortPlatform: string;
  longPlatform: string;
  shortMaturity: number;
  longMaturity: number;
  expiry: string;
  // Market API APRs (from table)
  shortApr: number;
  longApr: number;
  marketAprDifferenceString: string;
  // Order book execution APRs
  shortExecutionApr: number;
  longExecutionApr: number;
  shortMidApr: number;
  longMidApr: number;
  aprDifference: number;
  aprDifferenceString: string;
  // TSI metrics
  tsi: number;
  tsiString: string;
  cumulativeTsi: number;
  cumulativeTsiString: string;
  // Real values (VWAP-based, after slippage)
  realAPY: number;
  realAPYString: string;
  realSize: number;
  // Size and timestamp
  sizeUsd: number;
  timestamp: number;
  // Raw order books
  shortOrderBook: OrderBook;
  longOrderBook: OrderBook;
}

// Snapshot keys: S_{tsiCategory}_{sizeCategory}
// TSI categories: 1 = <0.3%, 2 = <0.5%, 3 = any
// Size categories: 0 = $0, 100k = $100k, 1M = $1M
type SnapshotKey =
  | 'S_1_0' | 'S_1_100k' | 'S_1_1M'
  | 'S_2_0' | 'S_2_100k' | 'S_2_1M'
  | 'S_3_0' | 'S_3_100k' | 'S_3_1M';

interface PairSnapshots {
  [key: string]: SnapshotResult | null;
}

// Store historical max values
const trackedOpportunities = new Map<string, TrackedOpportunity>();

// Store best snapshots per pair (key: "shortMarketId-longMarketId")
const bestSnapshots = new Map<string, PairSnapshots>();

// Fetch all markets from Boros
async function getAllMarkets(): Promise<BorosMarket[]> {
  const response = await axios.get('https://api.boros.finance/core/v1/markets');
  return response.data.results || [];
}

// Extract APR from market data
function getApr(market: BorosMarket): number | null {
  const apr = market.data?.midApr || market.data?.markApr;
  return apr ? parseFloat(apr) : null;
}

// Extract base asset from market name
function getBaseAsset(marketName: string): string {
  if (marketName.includes('-')) {
    return marketName.split('-')[0];
  }
  if (marketName.includes('USDT')) {
    return marketName.replace('USDT', '');
  }
  if (marketName.includes('USDC')) {
    return marketName.replace('USDC', '');
  }
  return marketName;
}

// Convert platform name to abbreviation
function getDex(platformName: string): string {
  switch (platformName) {
    case 'Binance': return 'BN';
    case 'Hyperliquid': return 'HL';
    case 'OKX': return 'OK';
    default: return '??';
  }
}

// Fetch order book for a market
async function getOrderBook(marketId: number): Promise<OrderBook | null> {
  try {
    const response = await axios.get(
      `https://api.boros.finance/core/v1/order-books/${marketId}?tickSize=0.0001`
    );
    return response.data;
  } catch (error) {
    return null;
  }
}

// Get asset price from market name
function getAssetPrice(marketName: string): number {
  const asset = getBaseAsset(marketName);
  return ASSET_PRICES[asset] || 0;
}

// Convert wei amount to USD
function weiToUsd(weiAmount: string, assetPrice: number): number {
  const tokens = parseFloat(weiAmount) / 1e18;
  return tokens * assetPrice;
}

// Calculate execution level by walking through order book
// Returns both worst-price APR and volume-weighted average APR (VWAP)
function calculateExecutionLevel(
  orderBookSide: OrderBookSide,
  requiredSizeUsd: number,
  assetPrice: number,
  isAskSide: boolean
): { executionApr: number; vwapApr: number; availableSizeUsd: number } | null {
  if (!orderBookSide.ia || !orderBookSide.sz || orderBookSide.ia.length === 0) {
    return null;
  }

  let accumulatedSizeUsd = 0;
  let weightedAprSum = 0;
  let executionApr = 0;

  // For $0 size, just return the best price (first level) and first level's size
  if (requiredSizeUsd === 0) {
    const firstApr = orderBookSide.ia[0] / 10000;
    const firstLevelSizeUsd = weiToUsd(orderBookSide.sz[0], assetPrice);
    return { executionApr: firstApr, vwapApr: firstApr, availableSizeUsd: firstLevelSizeUsd };
  }

  for (let i = 0; i < orderBookSide.ia.length; i++) {
    const levelSizeUsd = weiToUsd(orderBookSide.sz[i], assetPrice);
    const levelApr = orderBookSide.ia[i] / 10000; // Convert basis points to decimal

    // How much of this level do we actually use?
    const remainingNeeded = requiredSizeUsd - accumulatedSizeUsd;
    const usedSize = Math.min(levelSizeUsd, remainingNeeded);

    weightedAprSum += usedSize * levelApr;
    accumulatedSizeUsd += levelSizeUsd;
    executionApr = levelApr;

    if (accumulatedSizeUsd >= requiredSizeUsd) {
      const vwapApr = weightedAprSum / requiredSizeUsd;
      return { executionApr, vwapApr, availableSizeUsd: accumulatedSizeUsd };
    }
  }

  // Not enough liquidity - return VWAP of what we have
  const vwapApr = accumulatedSizeUsd > 0 ? weightedAprSum / Math.min(accumulatedSizeUsd, requiredSizeUsd) : executionApr;
  return { executionApr, vwapApr, availableSizeUsd: accumulatedSizeUsd };
}

// Calculate mid price from order book
function calculateMidApr(orderBook: OrderBook): number | null {
  const bidIa = orderBook.long?.ia || [];
  const askIa = orderBook.short?.ia || [];

  if (bidIa.length === 0 || askIa.length === 0) {
    return null;
  }

  const bestBidApr = bidIa[0] / 10000;
  const bestAskApr = askIa[0] / 10000;

  return (bestBidApr + bestAskApr) / 2;
}

// Calculate TSI and APR difference at a given size
function calculateTsiAndApr(
  shortOrderBook: OrderBook,
  longOrderBook: OrderBook,
  shortAssetPrice: number,
  longAssetPrice: number,
  requiredSizeUsd: number
): {
  tsi: number;
  cumulativeTsi: number;
  aprDiff: number;
  vwapAprDiff: number;
  shortExecApr: number;
  longExecApr: number;
  shortVwapApr: number;
  longVwapApr: number;
  shortMidApr: number;
  longMidApr: number;
  availableSizeUsd: number;
} | null {
  // Calculate mid prices
  const shortMidApr = calculateMidApr(shortOrderBook);
  const longMidApr = calculateMidApr(longOrderBook);

  if (shortMidApr === null || longMidApr === null) {
    return null;
  }

  // For shorting: use bid side (API's "long" field) - prices go DOWN from mid
  // For longing: use ask side (API's "short" field) - prices go UP from mid
  const shortExec = calculateExecutionLevel(
    shortOrderBook.long, // Bid side for shorting
    requiredSizeUsd,
    shortAssetPrice,
    false
  );

  const longExec = calculateExecutionLevel(
    longOrderBook.short, // Ask side for longing
    requiredSizeUsd,
    longAssetPrice,
    true
  );

  if (!shortExec || !longExec) {
    return null;
  }

  // Check if both sides have enough liquidity
  if (requiredSizeUsd > 0) {
    if (shortExec.availableSizeUsd < requiredSizeUsd || longExec.availableSizeUsd < requiredSizeUsd) {
      return null;
    }
  }

  // TSI calculation (worst-price based):
  // Ld = |execution APR on long market's ask side - long market mid|
  // Sd = |short market mid - execution APR on short market's bid side|
  // TSI = Ld + Sd
  const Ld = Math.abs(longExec.executionApr - longMidApr);
  const Sd = Math.abs(shortMidApr - shortExec.executionApr);
  const tsi = Ld + Sd;

  // Cumulative TSI (VWAP-based) - uses weighted average execution price
  const cumulativeLd = Math.abs(longExec.vwapApr - longMidApr);
  const cumulativeSd = Math.abs(shortMidApr - shortExec.vwapApr);
  const cumulativeTsi = cumulativeLd + cumulativeSd;

  // APR difference at execution levels (short APR - long APR)
  const aprDiff = shortExec.executionApr - longExec.executionApr;

  // VWAP-based APR difference (real APY after slippage)
  const vwapAprDiff = shortExec.vwapApr - longExec.vwapApr;

  // Available size is the minimum of both sides
  const availableSizeUsd = Math.min(shortExec.availableSizeUsd, longExec.availableSizeUsd);

  return {
    tsi,
    cumulativeTsi,
    aprDiff,
    vwapAprDiff,
    shortExecApr: shortExec.executionApr,
    longExecApr: longExec.executionApr,
    shortVwapApr: shortExec.vwapApr,
    longVwapApr: longExec.vwapApr,
    shortMidApr,
    longMidApr,
    availableSizeUsd,
  };
}

// Size thresholds in USD
const SIZE_THRESHOLDS = [
  { key: '0', value: 0 },
  { key: '100k', value: 100000 },
  { key: '1M', value: 1000000 },
];

// TSI thresholds (in decimal, e.g., 0.003 = 0.3%)
const TSI_THRESHOLDS = [
  { key: '1', maxTsi: 0.003 },  // <0.3%
  { key: '2', maxTsi: 0.005 },  // <0.5%
  { key: '3', maxTsi: Infinity }, // any
];

// Save snapshot to file
function saveSnapshot(
  shortMarketId: number,
  longMarketId: number,
  snapshotKey: string,
  snapshot: SnapshotResult
): void {
  const dirPath = path.join('./snapshots', `${shortMarketId}-${longMarketId}`);

  // Create directory if it doesn't exist
  if (!fs.existsSync('./snapshots')) {
    fs.mkdirSync('./snapshots');
  }
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath);
  }

  const filePath = path.join(dirPath, `${snapshotKey}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
}

// Update snapshots for a pair
function updateSnapshots(
  opp: ArbitrageOpportunity,
  shortOrderBook: OrderBook,
  longOrderBook: OrderBook,
  shortAssetPrice: number,
  longAssetPrice: number,
  timestamp: number
): void {
  const pairKey = `${opp.shortMarketId}-${opp.longMarketId}`;

  // Initialize pair snapshots if not exists
  if (!bestSnapshots.has(pairKey)) {
    bestSnapshots.set(pairKey, {});
  }

  const pairSnaps = bestSnapshots.get(pairKey)!;

  // Derived values
  const asset = getBaseAsset(opp.shortMarket);
  const shortDex = getDex(opp.shortPlatform);
  const longDex = getDex(opp.longPlatform);
  const pair = `${shortDex}-${longDex}`;
  const expiryTimestamp = Math.min(opp.longMaturity, opp.shortMaturity);
  const expiryDate = new Date(expiryTimestamp * 1000);
  const expiry = expiryDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-');

  // For each size threshold
  for (const size of SIZE_THRESHOLDS) {
    const result = calculateTsiAndApr(
      shortOrderBook,
      longOrderBook,
      shortAssetPrice,
      longAssetPrice,
      size.value
    );

    if (!result) continue;

    // For each TSI threshold that's satisfied
    for (const tsiThreshold of TSI_THRESHOLDS) {
      if (result.tsi > tsiThreshold.maxTsi) continue;

      const snapshotKey = `S_${tsiThreshold.key}_${size.key}`;
      const existingSnapshot = pairSnaps[snapshotKey];

      // Update if realAPY is higher (better opportunity)
      if (!existingSnapshot || result.vwapAprDiff > existingSnapshot.realAPY) {
        const newSnapshot: SnapshotResult = {
          // Market info
          asset,
          pair,
          shortMarket: opp.shortMarket,
          longMarket: opp.longMarket,
          shortMarketId: opp.shortMarketId,
          longMarketId: opp.longMarketId,
          shortPlatform: opp.shortPlatform,
          longPlatform: opp.longPlatform,
          shortMaturity: opp.shortMaturity,
          longMaturity: opp.longMaturity,
          expiry,
          // Market API APRs
          shortApr: opp.shortApr,
          longApr: opp.longApr,
          marketAprDifferenceString: `${opp.netApy.toFixed(2)}%`,
          // Order book execution APRs
          shortExecutionApr: result.shortExecApr,
          longExecutionApr: result.longExecApr,
          shortMidApr: result.shortMidApr,
          longMidApr: result.longMidApr,
          aprDifference: result.aprDiff,
          aprDifferenceString: `${(result.aprDiff * 100).toFixed(2)}%`,
          // TSI metrics
          tsi: result.tsi,
          tsiString: `${(result.tsi * 100).toFixed(2)}%`,
          cumulativeTsi: result.cumulativeTsi,
          cumulativeTsiString: `${(result.cumulativeTsi * 100).toFixed(2)}%`,
          // Real values (VWAP-based, after slippage)
          realAPY: result.vwapAprDiff,
          realAPYString: `${(result.vwapAprDiff * 100).toFixed(2)}%`,
          realSize: result.availableSizeUsd,
          // Size and timestamp
          sizeUsd: result.availableSizeUsd,
          timestamp,
          // Raw order books
          shortOrderBook,
          longOrderBook,
        };

        pairSnaps[snapshotKey] = newSnapshot;
        saveSnapshot(opp.shortMarketId, opp.longMarketId, snapshotKey, newSnapshot);
      }
    }
  }
}

// Process order books for an opportunity
async function processOrderBooks(opp: ArbitrageOpportunity, timestamp: number): Promise<void> {
  // Fetch both order books in parallel
  const [shortOB, longOB] = await Promise.all([
    getOrderBook(opp.shortMarketId),
    getOrderBook(opp.longMarketId),
  ]);

  if (!shortOB || !longOB) return;

  const shortAssetPrice = getAssetPrice(opp.shortMarket);
  const longAssetPrice = getAssetPrice(opp.longMarket);

  if (shortAssetPrice === 0 || longAssetPrice === 0) return;

  updateSnapshots(
    opp,
    shortOB,
    longOB,
    shortAssetPrice,
    longAssetPrice,
    timestamp
  );
}

// Find all arbitrage opportunities
function findArbitrageOpportunities(markets: BorosMarket[]): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];

  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const market1 = markets[i];
      const market2 = markets[j];

      const asset1 = getBaseAsset(market1.metadata.name);
      const asset2 = getBaseAsset(market2.metadata.name);

      if (asset1 !== asset2) continue;

      const apr1 = getApr(market1);
      const apr2 = getApr(market2);

      if (apr1 === null || apr2 === null) continue;

      // Skip markets that are not in Normal state (e.g., CloseOnly)
      if (market1.state !== 'Normal' || market2.state !== 'Normal') continue;

      if (apr1 > apr2) {
        opportunities.push({
          longMarket: market2.metadata.name,
          longMarketId: market2.marketId,
          longApr: apr2 * 100,
          longPlatform: market2.metadata.platformName,
          longMaturity: market2.imData.maturity,
          longState: market2.state || 'Unknown',
          shortMarket: market1.metadata.name,
          shortMarketId: market1.marketId,
          shortApr: apr1 * 100,
          shortPlatform: market1.metadata.platformName,
          shortMaturity: market1.imData.maturity,
          shortState: market1.state || 'Unknown',
          netApy: (apr1 - apr2) * 100,
        });
      } else if (apr2 > apr1) {
        opportunities.push({
          longMarket: market1.metadata.name,
          longMarketId: market1.marketId,
          longApr: apr1 * 100,
          longPlatform: market1.metadata.platformName,
          longMaturity: market1.imData.maturity,
          longState: market1.state || 'Unknown',
          shortMarket: market2.metadata.name,
          shortMarketId: market2.marketId,
          shortApr: apr2 * 100,
          shortPlatform: market2.metadata.platformName,
          shortMaturity: market2.imData.maturity,
          shortState: market2.state || 'Unknown',
          netApy: (apr2 - apr1) * 100,
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.netApy - a.netApy);
}

// Update tracked opportunities
function updateTrackedOpportunities(opportunities: ArbitrageOpportunity[], timestamp: Date) {
  for (const opp of opportunities) {
    // Create unique key for this pair using market IDs (sorted to ensure consistency)
    const ids = [
      `${opp.longMarket}:${opp.longMarketId}`,
      `${opp.shortMarket}:${opp.shortMarketId}`
    ].sort();
    const pairKey = `${ids[0]}|${ids[1]}`;

    const existing = trackedOpportunities.get(pairKey);

    if (!existing) {
      // New opportunity
      trackedOpportunities.set(pairKey, {
        pairKey,
        longMarket: opp.longMarket,
        longMarketId: opp.longMarketId,
        longPlatform: opp.longPlatform,
        longMaturity: opp.longMaturity,
        longState: opp.longState,
        shortMarket: opp.shortMarket,
        shortMarketId: opp.shortMarketId,
        shortPlatform: opp.shortPlatform,
        shortMaturity: opp.shortMaturity,
        shortState: opp.shortState,
        currentApy: opp.netApy,
        maxApy: opp.netApy,
        maxTimestamp: timestamp,
        currentLongApr: opp.longApr,
        currentShortApr: opp.shortApr,
      });
    } else {
      // Update existing
      existing.currentApy = opp.netApy;
      existing.currentLongApr = opp.longApr;
      existing.currentShortApr = opp.shortApr;
      existing.longMarket = opp.longMarket;
      existing.longMarketId = opp.longMarketId;
      existing.longPlatform = opp.longPlatform;
      existing.longMaturity = opp.longMaturity;
      existing.longState = opp.longState;
      existing.shortMarket = opp.shortMarket;
      existing.shortMarketId = opp.shortMarketId;
      existing.shortPlatform = opp.shortPlatform;
      existing.shortMaturity = opp.shortMaturity;
      existing.shortState = opp.shortState;

      if (opp.netApy > existing.maxApy) {
        existing.maxApy = opp.netApy;
        existing.maxTimestamp = timestamp;
      }
    }
  }
}

// Display tracked opportunities
function displayOpportunities() {
  console.clear();
  const now = new Date();
  console.log('='.repeat(140));
  console.log(`BOROS ARBITRAGE MONITOR - ${now.toLocaleString()}`);
  console.log('='.repeat(140));

  // Sort by current APY
  const sorted = Array.from(trackedOpportunities.values()).sort(
    (a, b) => b.currentApy - a.currentApy
  );

  if (sorted.length === 0) {
    console.log('No opportunities found yet...');
    return;
  }

  // Header
  console.log(
    ' # | Asset | Pair  | Market IDs  | Short APR | Long APR | Current APY | Max APY | Expiry      | Max Found At        '
  );
  console.log('-'.repeat(140));

  sorted.forEach((opp, index) => {
    const asset = getBaseAsset(opp.longMarket);
    const shortDex = getDex(opp.shortPlatform);
    const longDex = getDex(opp.longPlatform);
    const pair = `${shortDex}-${longDex}`;
    const marketIds = `${opp.shortMarketId}/${opp.longMarketId}`;

    // Use the earlier maturity date (strategy ends when first position expires)
    const expiryTimestamp = Math.min(opp.longMaturity, opp.shortMaturity);
    const expiryDate = new Date(expiryTimestamp * 1000);
    const expiry = expiryDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-');

    const timeSinceMax = Math.floor((now.getTime() - opp.maxTimestamp.getTime()) / 1000 / 60);
    const maxTime =
      timeSinceMax === 0
        ? 'now'
        : timeSinceMax < 60
        ? `${timeSinceMax}m ago`
        : `${Math.floor(timeSinceMax / 60)}h ${timeSinceMax % 60}m ago`;

    console.log(
      `${String(index + 1).padStart(2)} | ` +
      `${asset.padEnd(5)} | ` +
      `${pair.padEnd(5)} | ` +
      `${marketIds.padEnd(11)} | ` +
      `${opp.currentShortApr.toFixed(2).padStart(8)}% | ` +
      `${opp.currentLongApr.toFixed(2).padStart(7)}% | ` +
      `${opp.currentApy.toFixed(2).padStart(10)}% | ` +
      `${opp.maxApy.toFixed(2).padStart(6)}% | ` +
      `${expiry.padEnd(11)} | ` +
      `${maxTime.padEnd(20)}`
    );
  });

  console.log();
  console.log(`Total tracked: ${sorted.length} | Next update in 15 seconds | Press Ctrl+C to stop`);
}

// Main monitoring loop
async function monitor() {
  try {
    const markets = await getAllMarkets();
    const opportunities = findArbitrageOpportunities(markets);
    const timestamp = new Date();

    updateTrackedOpportunities(opportunities, timestamp);
    displayOpportunities();

    // Process order books for snapshots
    const timestampMs = timestamp.getTime();
    await Promise.all(
      opportunities.map(opp => processOrderBooks(opp, timestampMs))
    );
  } catch (error) {
    console.error('Error fetching data:', error instanceof Error ? error.message : error);
  }
}

// Run immediately and then every 15 seconds
console.log('Starting Boros Arbitrage Monitor...\n');
await monitor();
setInterval(monitor, 60000); // 15 seconds
