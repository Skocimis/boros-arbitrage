/**
 * @file getOrderBookByMarketId.ts
 * @description Fetches a Boros Yield Unit (YU) order book by market ID with TypeScript type definitions.
 *   Order books use parallel arrays for Implied APR values and sizes.
 *
 * @dependencies
 *   - Native fetch API
 *
 * @exports
 *   - OrderBookSide: Interface for one side of the book (ia[], sz[])
 *   - OrderBook: Full order book with long (bid) and short (ask) sides
 *   - getOrderBookByMarketId(marketId, tickSize): Async function to fetch order book
 *
 * @behavior
 *   1. Makes GET request to Boros API: /core/v1/order-books/{marketId}?tickSize={tickSize}
 *   2. Returns null if not found (404)
 *   3. Throws error for other HTTP failures
 *
 * @notes
 *   - ia: Implied APR values in basis points (divide by 10000 for decimal)
 *   - sz: Size values in wei (divide by 1e18 for token amount)
 *   - API "long" field = bid side (short YU orders - receive fixed Implied APR)
 *   - API "short" field = ask side (long YU orders - pay fixed Implied APR)
 *   - Default tickSize is 0.0001 (1 basis point)
 *
 * @see getMarketById.ts for market data fetching
 * @see src/arbitrage-monitor.ts for TSI calculation using order books
 */

// Order book side (parallel arrays)
export interface OrderBookSide {
  ia: number[];  // APR values in basis points
  sz: string[];  // Size values in wei
}

// Full order book response
export interface OrderBook {
  long: OrderBookSide;   // Bid side (short positions use this)
  short: OrderBookSide;  // Ask side (long positions use this)
}

/**
 * Fetches the order book for a Boros market
 * @param marketId - The market ID to fetch order book for
 * @param tickSize - The tick size for aggregation (default: 0.0001)
 * @returns The order book data or null if not found
 */
export async function getOrderBookByMarketId(
  marketId: number,
  tickSize: number = 0.0001
): Promise<OrderBook | null> {
  const response = await fetch(
    `https://api.boros.finance/core/v1/order-books/${marketId}?tickSize=${tickSize}`
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch order book for market ${marketId}: ${response.status}`);
  }

  return response.json() as Promise<OrderBook>;
}
