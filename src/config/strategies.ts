/**
 * @file strategies.ts
 * @description Strategy configurations for 4-legged arbitrage positions.
 *
 * @usage
 *   import { getStrategy, listStrategies, Strategy } from "../config/strategies.js";
 *
 *   const strategy = getStrategy("ETH27Mar");
 *   const allStrategies = listStrategies(); // ["ETH27Mar", ...]
 *
 * @exports
 *   - Strategy: Interface defining a 4-legged strategy
 *   - STRATEGIES: Record of all available strategies
 *   - getStrategy(name): Retrieves a strategy by name
 *   - listStrategies(): Returns array of all strategy names
 *
 * @structure
 *   Each strategy defines:
 *   - name: Strategy identifier (e.g., "ETH27Mar")
 *   - ticker: Underlying asset (e.g., "ETH")
 *   - shortDex: Exchange for short perp ("HL" or "OKX")
 *   - longDex: Exchange for long perp ("HL" or "OKX")
 *   - borosLongMarketId: Boros market ID for long YU
 *   - borosShortMarketId: Boros market ID for short YU
 *
 * @positions
 *   A complete strategy opens 4 positions:
 *   1. Short perp on shortDex (e.g., Hyperliquid)
 *   2. Long perp on longDex (e.g., OKX)
 *   3. Long YU on Boros (borosLongMarketId)
 *   4. Short YU on Boros (borosShortMarketId)
 *
 * @adding_strategies
 *   To add a new strategy, add an entry to STRATEGIES:
 *   ```
 *   BTC27Mar: {
 *     name: "BTC27Mar",
 *     ticker: "BTC",
 *     shortDex: "HL",
 *     longDex: "OKX",
 *     borosLongMarketId: 42,
 *     borosShortMarketId: 43,
 *   },
 *   ```
 *
 * @see openPosition.ts for strategy execution
 */

export interface Strategy {
  /** Strategy name (e.g., "ETH27Mar") */
  name: string;
  /** Underlying asset ticker (e.g., "ETH") */
  ticker: string;
  /** DEX for shorting perp */
  shortDex: "HL" | "OKX";
  /** DEX for longing perp */
  longDex: "HL" | "OKX";
  /** Boros market ID for long YU position */
  borosLongMarketId: number;
  /** Boros market ID for short YU position */
  borosShortMarketId: number;
}

/**
 * Predefined strategy configurations.
 * Add new strategies here as needed.
 */
export const STRATEGIES: Record<string, Strategy> = {
  ETH27Mar: {
    name: "ETH27Mar",
    ticker: "ETH",
    shortDex: "HL",
    longDex: "OKX",
    borosLongMarketId: 40,
    borosShortMarketId: 41,
  },
};

/**
 * Retrieves a strategy by name
 * @param name - Strategy name (case-sensitive)
 * @returns Strategy configuration or undefined if not found
 */
export function getStrategy(name: string): Strategy | undefined {
  return STRATEGIES[name];
}

/**
 * Lists all available strategy names
 * @returns Array of strategy names
 */
export function listStrategies(): string[] {
  return Object.keys(STRATEGIES);
}
