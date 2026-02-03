// --- Boros Market types (from lib/functions/getMarketById.ts) ---

export interface LiqSettings {
  base: string;
  slope: string;
  feeRate: string;
}

export interface MarketConfig {
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

export interface ExtConfig {
  ammAddress: string;
  ammId: number;
  isPositiveAMM: boolean;
  settleFeeRate: string;
  paymentPeriod: number;
  maxUpdateDelay: number;
}

export interface ImData {
  name: string;
  symbol: string;
  isIsolatedOnly: boolean;
  maturity: number;
  tickStep: number;
  iTickThresh: number;
}

export interface MarketMetadata {
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

export interface MarketData {
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

export interface Platform {
  name: string;
  platformId: string;
  accentColor: string;
  icon: string;
}

export type MarketState = 'Normal' | 'CloseOnly' | 'Paused' | 'Settled';

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

// --- Candle types ---

export interface Candle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  u: number;
  mr: number;
  ofr: number;
  b7dmafr: number;
  b30dmafr: number;
  fp: number;
}

export interface ChartResponse {
  results: Candle[];
}

// --- DB document types ---

export interface MarketDocument extends BorosMarket {
  startTime: number | null;
  lastCandleTs: number | null;
  lastUpdatedAt: number;
}

export interface CandleDocument extends Candle {
  marketId: number;
}

// --- API list response ---

export interface MarketsListResponse {
  results: BorosMarket[];
  total: number;
  skip: number;
}
