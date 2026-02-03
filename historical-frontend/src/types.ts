export interface Market {
  marketId: number;
  startTime: number | null;
  imData: {
    name: string;
    symbol: string;
    maturity: number;
  };
  metadata: {
    name: string;
    assetSymbol?: string;
    platformName: string;
    maxLeverage: number;
    isWhitelisted: boolean;
  };
  data?: {
    volume24h: number;
    notionalOI: number;
    markApr: number;
    floatingApr: number;
    assetMarkPrice: number;
  };
  platform?: {
    name: string;
    icon: string;
    accentColor: string;
  };
  state?: string;
}

export interface Candle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface AlignedDataPoint {
  timestamp: number;
  apr1: number;
  apr2: number;
  diff: number;
}
