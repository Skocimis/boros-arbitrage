/**
 * @file DexClient.ts
 * @description Abstract base class defining the interface for DEX client implementations.
 *   Provides common types (OrderSide, Asset) and abstract methods that each exchange
 *   client must implement.
 *
 * @dependencies
 *   - None (pure TypeScript definitions)
 *
 * @exports
 *   - OrderSide: Enum for LONG/SHORT positions
 *   - Asset: Enum for supported assets (BTC, ETH)
 *   - OrderResult: Interface for order execution results
 *   - DexClient: Abstract base class for exchange clients
 *
 * @notes
 *   - All implementations must provide: getBalance(), order(), getFunding()
 *   - getFunding() should return annualized funding rate as decimal
 *   - This is the base for BinanceClient and HyperliquidClient
 *
 * @see BinanceClient.ts for Binance Futures implementation
 * @see HyperliquidClient.ts for Hyperliquid implementation
 */

export enum OrderSide {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum Asset {
  BTC = 'BTC',
  ETH = 'ETH',
}

export interface OrderResult {
  orderId: string;
  status: string;
  symbol: string;
  size: string;
}

export abstract class DexClient {
  abstract getBalance(): Promise<string>;
  abstract order(side: OrderSide, asset: Asset, size: string): Promise<OrderResult>;
  abstract getFunding(asset: Asset): Promise<number>;
}
