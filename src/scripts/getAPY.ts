/**
 * @file getAPY.ts
 * @description Calculates and displays the real APY for a strategy at a given position size.
 *   Focuses on Boros TSI (Total Slippage Impact) while assuming DEX markets are perfect.
 *
 * @usage
 *   npx tsx src/scripts/getAPY.ts <STRATEGY_NAME> <SIZE>
 *   npx tsx src/scripts/getAPY.ts ETH27Mar 10
 *
 * @arguments
 *   STRATEGY_NAME: Strategy name from src/config/strategies.ts (e.g., "ETH27Mar")
 *   SIZE: Position size in asset units (e.g., 10 = 10 ETH for ETH strategies)
 *
 * @behavior
 *   1. Looks up strategy configuration by name
 *   2. Fetches market data for both Boros markets (/core/v1/markets/{id})
 *   3. Fetches order books for both Boros markets (/core/v1/order-books/{id})
 *   4. Calculates APY estimates and slippage metrics
 *   5. Displays clean, readable console output
 *
 * @calculations
 *   Optimistic APY (market mid):
 *     = shortMidApr - longMidApr
 *     Uses mid-point of best bid/ask from order books
 *
 *   Pessimistic APY (worst execution):
 *     = shortExecApr - longExecApr
 *     Walks order book to SIZE, returns worst-price APR at final level
 *
 *   Realistic APY (VWAP):
 *     = shortVwapApr - longVwapApr
 *     VWAP = Σ(levelSize × levelApr) / totalSize
 *
 *   TSI (Total Slippage Impact):
 *     = |longExecApr - longMidApr| + |shortMidApr - shortExecApr|
 *
 * @notes
 *   - Order book sizes are in wei (divide by 1e18 for asset units)
 *   - For shorting YU: walks bid side (orderBook.long)
 *   - For longing YU: walks ask side (orderBook.short)
 *   - Only considers Boros slippage (DEX markets assumed perfect)
 *
 * @see arbitrage-monitor.ts for full monitoring implementation
 * @see src/config/strategies.ts for strategy definitions
 */

import "dotenv/config";
import axios from "axios";
import { getStrategy, listStrategies } from "../config/strategies.js";

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

interface OrderBookSide {
  ia: number[]; // APR values in basis points
  sz: string[]; // Size values in wei
}

interface OrderBook {
  short: OrderBookSide; // Ask side (long positions use this)
  long: OrderBookSide; // Bid side (short positions use this)
}

// Fetch market data from Boros
async function getMarket(marketId: number): Promise<BorosMarket> {
  const response = await axios.get(
    `https://api.boros.finance/core/v1/markets/${marketId}`
  );
  return response.data;
}

// Fetch order book for a market
async function getOrderBook(marketId: number): Promise<OrderBook> {
  const response = await axios.get(
    `https://api.boros.finance/core/v1/order-books/${marketId}?tickSize=0.0001`
  );
  return response.data;
}

// Convert wei amount to asset units
function weiToAsset(weiAmount: string): number {
  return parseFloat(weiAmount) / 1e18;
}

// Calculate mid APR from order book
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

// Calculate execution level by walking through order book
// Returns worst-price APR, VWAP APR, and available size (in asset units)
function calculateExecutionLevel(
  orderBookSide: OrderBookSide,
  requiredSize: number
): {
  executionApr: number;
  vwapApr: number;
  availableSize: number;
} | null {
  if (
    !orderBookSide.ia ||
    !orderBookSide.sz ||
    orderBookSide.ia.length === 0
  ) {
    return null;
  }

  let accumulatedSize = 0;
  let weightedAprSum = 0;
  let executionApr = 0;

  // For 0 size, return the best price (first level) and first level's size
  if (requiredSize === 0) {
    const firstApr = orderBookSide.ia[0] / 10000;
    const firstLevelSize = weiToAsset(orderBookSide.sz[0]);
    return {
      executionApr: firstApr,
      vwapApr: firstApr,
      availableSize: firstLevelSize,
    };
  }

  // Calculate total available liquidity first
  let totalAvailableSize = 0;
  for (let i = 0; i < orderBookSide.sz.length; i++) {
    totalAvailableSize += weiToAsset(orderBookSide.sz[i]);
  }

  for (let i = 0; i < orderBookSide.ia.length; i++) {
    const levelSize = weiToAsset(orderBookSide.sz[i]);
    const levelApr = orderBookSide.ia[i] / 10000;

    // How much of this level do we actually use?
    const remainingNeeded = requiredSize - accumulatedSize;
    const usedSize = Math.min(levelSize, remainingNeeded);

    weightedAprSum += usedSize * levelApr;
    accumulatedSize += levelSize;
    executionApr = levelApr;

    if (accumulatedSize >= requiredSize) {
      const vwapApr = weightedAprSum / requiredSize;
      return { executionApr, vwapApr, availableSize: totalAvailableSize };
    }
  }

  // Not enough liquidity - return VWAP of what we have
  const vwapApr =
    accumulatedSize > 0
      ? weightedAprSum / Math.min(accumulatedSize, requiredSize)
      : executionApr;
  return { executionApr, vwapApr, availableSize: totalAvailableSize };
}

// Format number with commas
function formatNumber(num: number): string {
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Format percentage
function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

async function getApy(strategyName: string, sizeAsset: number): Promise<void> {
  // Look up strategy
  const strategy = getStrategy(strategyName);
  if (!strategy) {
    console.error(`Strategy "${strategyName}" not found.`);
    console.error(`Available strategies: ${listStrategies().join(", ")}`);
    process.exit(1);
  }

  // Fetch market data and order books in parallel
  const [longMarket, shortMarket, longOrderBook, shortOrderBook] =
    await Promise.all([
      getMarket(strategy.borosLongMarketId),
      getMarket(strategy.borosShortMarketId),
      getOrderBook(strategy.borosLongMarketId),
      getOrderBook(strategy.borosShortMarketId),
    ]);

  // Check market states
  if (longMarket.state !== "Normal") {
    console.warn(
      `Warning: Long market (${strategy.borosLongMarketId}) is in "${longMarket.state}" state`
    );
  }
  if (shortMarket.state !== "Normal") {
    console.warn(
      `Warning: Short market (${strategy.borosShortMarketId}) is in "${shortMarket.state}" state`
    );
  }

  // Calculate mid APRs from order books
  const longMidApr = calculateMidApr(longOrderBook);
  const shortMidApr = calculateMidApr(shortOrderBook);

  if (longMidApr === null || shortMidApr === null) {
    console.error("Unable to calculate mid APRs from order books");
    process.exit(1);
  }

  // Calculate execution levels (size in asset units)
  // For shorting: use bid side (API's "long" field)
  // For longing: use ask side (API's "short" field)
  const shortExec = calculateExecutionLevel(
    shortOrderBook.long, // Bid side for shorting
    sizeAsset
  );

  const longExec = calculateExecutionLevel(
    longOrderBook.short, // Ask side for longing
    sizeAsset
  );

  if (!shortExec || !longExec) {
    console.error("Unable to calculate execution levels from order books");
    process.exit(1);
  }

  // Check for insufficient liquidity (in asset units)
  const shortAvailable = shortExec.availableSize;
  const longAvailable = longExec.availableSize;
  const limitingLiquidity = Math.min(shortAvailable, longAvailable);

  if (sizeAsset > limitingLiquidity) {
    console.warn(
      `Warning: Requested size (${sizeAsset} ${strategy.ticker}) exceeds available liquidity (${formatNumber(limitingLiquidity)} ${strategy.ticker})`
    );
  }

  // Calculate APY estimates
  const optimisticApy = shortMidApr - longMidApr;
  const pessimisticApy = shortExec.executionApr - longExec.executionApr;
  const realisticApy = shortExec.vwapApr - longExec.vwapApr;

  // Calculate TSI
  const tsiWorstPrice =
    Math.abs(longExec.executionApr - longMidApr) +
    Math.abs(shortMidApr - shortExec.executionApr);
  const tsiVwap =
    Math.abs(longExec.vwapApr - longMidApr) +
    Math.abs(shortMidApr - shortExec.vwapApr);

  // Format expiry date
  const expiryTimestamp = Math.min(
    longMarket.imData.maturity,
    shortMarket.imData.maturity
  );
  const expiryDate = new Date(expiryTimestamp * 1000);
  const expiry = expiryDate
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "2-digit",
    })
    .replace(/ /g, "-");

  // Output
  console.log("=".repeat(60));
  console.log(`ENTRY ASSESSMENT: ${strategyName} @ ${sizeAsset} ${strategy.ticker}`);
  console.log("=".repeat(60));
  console.log("");
  console.log("Strategy Details:");
  console.log(`  Short Boros:  Market ${strategy.borosShortMarketId} (${shortMarket.metadata.platformName})`);
  console.log(`  Long Boros:   Market ${strategy.borosLongMarketId} (${longMarket.metadata.platformName})`);
  console.log(`  Expiry:       ${expiry}`);
  console.log("");
  console.log("Market Data:");
  console.log(`  Short APR (mid):     ${formatPercent(shortMidApr)}`);
  console.log(`  Long APR (mid):      ${formatPercent(longMidApr)}`);
  console.log("");
  console.log("=".repeat(60));
  console.log("APY ESTIMATES");
  console.log("=".repeat(60));
  console.log("");
  console.log(`  Optimistic (market mid):     ${formatPercent(optimisticApy)}`);
  console.log(
    `    Based on: ${formatPercent(shortMidApr)} - ${formatPercent(longMidApr)}`
  );
  console.log("");
  console.log(`  Pessimistic (worst exec):    ${formatPercent(pessimisticApy)}`);
  console.log(`    Short exec APR: ${formatPercent(shortExec.executionApr)}`);
  console.log(`    Long exec APR:  ${formatPercent(longExec.executionApr)}`);
  console.log("");
  console.log(`  Realistic (VWAP):            ${formatPercent(realisticApy)}`);
  console.log(`    Short VWAP APR: ${formatPercent(shortExec.vwapApr)}`);
  console.log(`    Long VWAP APR:  ${formatPercent(longExec.vwapApr)}`);
  console.log("");
  console.log("=".repeat(60));
  console.log("SLIPPAGE ANALYSIS");
  console.log("=".repeat(60));
  console.log("");
  console.log(`  TSI (worst-price):     ${formatPercent(tsiWorstPrice)}`);
  console.log(`  TSI (VWAP):            ${formatPercent(tsiVwap)}`);
  console.log("");
  // Display liquidity in asset units
  console.log("  Available liquidity:");
  console.log(`    Short side: ${formatNumber(shortAvailable)} ${strategy.ticker}`);
  console.log(`    Long side:  ${formatNumber(longAvailable)} ${strategy.ticker}`);
  console.log(`    Limiting:   ${formatNumber(limitingLiquidity)} ${strategy.ticker}`);
  console.log("");
  console.log("=".repeat(60));
}

async function main() {
  const [strategyName, sizeStr] = process.argv.slice(2);

  if (!strategyName || !sizeStr) {
    console.error(
      "Usage: npx tsx src/scripts/getAPY.ts <STRATEGY_NAME> <SIZE>"
    );
    console.error("Example: npx tsx src/scripts/getAPY.ts ETH27Mar 10");
    console.error("");
    console.error("SIZE is in asset units (e.g., ETH for ETH strategies)");
    console.error("");
    console.error(`Available strategies: ${listStrategies().join(", ")}`);
    process.exit(1);
  }

  const size = parseFloat(sizeStr);
  if (isNaN(size) || size < 0) {
    console.error("Size must be a non-negative number");
    process.exit(1);
  }

  await getApy(strategyName, size);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
