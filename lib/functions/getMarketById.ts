/**
 * @file getMarketById.ts
 * @description Fetches a Boros Yield Unit (YU) market by its ID with full TypeScript type definitions.
 *   Provides comprehensive interfaces for all market data fields.
 *
 * @dependencies
 *   - Native fetch API
 *
 * @exports
 *   - BorosMarket: Main market interface with all nested types
 *   - getMarketById(marketId): Async function to fetch market data
 *
 * @behavior
 *   1. Makes GET request to Boros API: /core/v1/markets/{marketId}
 *   2. Returns null if market not found (404)
 *   3. Throws error for other HTTP failures
 *
 * @notes
 *   - Includes full type definitions: MarketConfig, ImData, MarketData, Platform, etc.
 *   - MarketState can be: 'Normal', 'CloseOnly', 'Paused', 'Settled'
 *   - APR values in MarketData are Implied APRs (decimals, e.g., 0.085 = 8.5%)
 *   - ammImpliedApr: AMM's implied rate; midApr: order book mid implied rate
 *
 * @see getOrderBookByMarketId.ts for order book fetching
 * @see src/arbitrage-monitor.ts for usage example
 */

// Liquidation settings
interface LiqSettings {
  base: string;
  slope: string;
  feeRate: string;
}

// Market configuration
interface MarketConfig {
  maxOpenOrders: number;
  markRateOracle: string;
  fIndexOracle: string;
  hardOICap: string;
  takerFee: string;
  otcFee: string;
  liqSettings: LiqSettings;
  kIM: string;
  kMM: string;
  tThresh: number;
  maxRateDeviationFactorBase1e4: number;
  closingOrderBoundBase1e4: number;
  loUpperConstBase1e4: number;
  loUpperSlopeBase1e4: number;
  loLowerConstBase1e4: number;
  loLowerSlopeBase1e4: number;
  status: number;
  useImpliedAsMarkRate: boolean;
  softOICap: number;
  cloLowerThresh: number;
  cloUpperThresh: number;
}

// Extended configuration (AMM settings)
interface ExtConfig {
  ammAddress: string;
  ammId: number;
  isPositiveAMM: boolean;
  settleFeeRate: string;
  paymentPeriod: number;
  maxUpdateDelay: number;
}

// Instrument metadata (maturity info)
interface ImData {
  name: string;
  symbol: string;
  isIsolatedOnly: boolean;
  maturity: number;
  tickStep: number;
  iTickThresh: number;
}

// Market metadata
interface MarketMetadata {
  name: string;
  assetSymbol: string;
  platformName: string;
  maxLeverage: number;
  defaultLeverage: number;
  icon: string;
  isWhitelisted: boolean;
  fundingRateSymbol: string;
  realtimeFundingRateLink: string;
  isDevTest: boolean;
  ammAddress: string;
  ammId: number;
  isPositiveAMM: boolean;
  disabledChartIndicators: string[];
  accentColor: string;
  marketName: string;
}

// Real-time market data
interface MarketData {
  volume24h: number;
  notionalOI: number;
  markApr: number;
  lastTradedApr: number;
  midApr: number;
  bestBid: number;
  bestAsk: number;
  ammImpliedApr: number;
  floatingApr: number;
  longYieldApr: number;
  nextSettlementTime: number;
  timeToMaturity: number;
  assetMarkPrice: number;
  b7dmafr: number;
  b30dmafr: number;
}

// Platform info
interface Platform {
  name: string;
  platformId: string;
  accentColor: string;
  icon: string;
}

// Market state
type MarketState = 'Normal' | 'CloseOnly' | 'Paused' | 'Settled';

// Full Boros Market response
export interface BorosMarket {
  marketId: number;
  address: string;
  tokenId: number;
  imData: ImData;
  config: MarketConfig;
  extConfig: ExtConfig;
  metadata: MarketMetadata;
  data: MarketData;
  platform: Platform;
  state: MarketState;
}

/**
 * Fetches a Boros market by its ID
 * @param marketId - The market ID to fetch
 * @returns The market data or null if not found
 */
export async function getMarketById(marketId: number): Promise<BorosMarket | null> {
  const response = await fetch(`https://api.boros.finance/core/v1/markets/${marketId}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch market ${marketId}: ${response.status}`);
  }

  return response.json() as Promise<BorosMarket>;
}
