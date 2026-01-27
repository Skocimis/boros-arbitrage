/**
 * @file hyperliquidShort.ts
 * @description Opens short positions on Hyperliquid DEX. Can be used as CLI or imported as module.
 *
 * @usage CLI
 *   npx tsx src/scripts/hyperliquidShort.ts <TICKER> <SIZE>
 *   Example: npx tsx src/scripts/hyperliquidShort.ts ETH 0.01
 *
 * @usage Module
 *   import { openHyperliquidShort, HyperliquidOrderResult } from "./hyperliquidShort.js";
 *   const result = await openHyperliquidShort("ETH", 0.01);
 *
 * @exports
 *   - openHyperliquidShort(ticker, size): Opens a short position, returns HyperliquidOrderResult
 *   - HyperliquidOrderResult: Interface for order result with success, filledSize, avgPrice, etc.
 *
 * @dependencies
 *   - @nktkas/hyperliquid: SDK for interacting with Hyperliquid API
 *   - @nktkas/hyperliquid/utils: Price/size formatting utilities
 *   - viem: Ethereum library for wallet/signing operations
 *   - dotenv: Environment variable management
 *
 * @environment
 *   - PRIVATE_KEY: Master account private key (required)
 *   - HYPERLIQUID_SUBACCOUNT: Subaccount address for operations (required)
 *
 * @behavior
 *   1. Fetches asset metadata from Hyperliquid to resolve ticker to asset index
 *   2. Fetches current mid price from Hyperliquid
 *   3. Calculates limit price with slippage protection (0.5% below mid)
 *   4. Formats price/size according to Hyperliquid tick rules (5 sig figs, decimals)
 *   5. Places IOC (Immediate-or-Cancel) short order for market-like execution
 *   6. Returns result object with fill status
 *
 * @notes
 *   - Uses IOC time-in-force for immediate execution (market order behavior)
 *   - Slippage set to 0.5% (50 bps) - order will fill at limit price or better
 *   - Operations are performed on the subaccount specified by SUBACCOUNT_ADDRESS
 *   - The master account signs transactions on behalf of the subaccount
 *   - Price formatting follows Hyperliquid rules: max 5 sig figs, max (6-szDecimals) decimals
 *
 * @see openPosition.ts for 4-legged strategy execution
 * @see setHyperliquidLeverage.ts for configuring leverage before trading
 */

import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

/** Subaccount address for all trading operations (from env) */
const SUBACCOUNT_ADDRESS = process.env.HYPERLIQUID_SUBACCOUNT;

/** Slippage tolerance in basis points (50 = 0.5%) */
const SLIPPAGE_BPS = 50;

/** Result type for Hyperliquid order */
export interface HyperliquidOrderResult {
  success: boolean;
  ticker: string;
  side: "short";
  filledSize?: string;
  avgPrice?: string;
  orderId?: number;
  error?: string;
  rawResult?: unknown;
}

/**
 * Opens a short position on Hyperliquid DEX
 * @param ticker - Asset ticker (e.g., "ETH")
 * @param size - Position size in base asset
 * @returns Order result
 */
export async function openHyperliquidShort(
  ticker: string,
  size: number
): Promise<HyperliquidOrderResult> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }

  if (!SUBACCOUNT_ADDRESS) {
    throw new Error("HYPERLIQUID_SUBACCOUNT not found in environment variables");
  }

  const transport = new HttpTransport();
  const info = new InfoClient({ transport });

  // Get asset index from ticker
  const meta = await info.meta();
  const assetIndex = meta.universe.findIndex(
    (asset) => asset.name.toUpperCase() === ticker.toUpperCase()
  );

  if (assetIndex === -1) {
    throw new Error(`Asset ${ticker} not found on Hyperliquid`);
  }

  const assetMeta = meta.universe[assetIndex];

  // Get current mid price
  const allMids = await info.allMids();
  const midPrice = parseFloat(allMids[ticker.toUpperCase()]);
  if (!midPrice) {
    throw new Error(`Could not get price for ${ticker}`);
  }

  // For a short, we sell at a lower price (with slippage)
  const slippageMultiplier = 1 - SLIPPAGE_BPS / 10000;
  const limitPrice = midPrice * slippageMultiplier;

  // Format price and size according to Hyperliquid rules
  const roundedPrice = formatPrice(limitPrice, assetMeta.szDecimals);
  const roundedSize = formatSize(size, assetMeta.szDecimals);

  const wallet = privateKeyToAccount(privateKey as `0x${string}`);
  const exchange = new ExchangeClient({ transport, wallet });

  console.log(`Opening SHORT position on Hyperliquid ${ticker}:`);
  console.log(`  Size: ${roundedSize} ${ticker}`);
  console.log(`  Mid price: $${midPrice}`);
  console.log(`  Limit price: $${roundedPrice} (with ${SLIPPAGE_BPS / 100}% slippage)`);
  console.log(`  Subaccount: ${SUBACCOUNT_ADDRESS}`);

  const result = await exchange.order(
    {
      orders: [
        {
          a: assetIndex,
          b: false, // false = short
          p: roundedPrice,
          s: roundedSize,
          r: false, // not reduce-only
          t: { limit: { tif: "Ioc" } }, // Immediate-or-cancel for market-like execution
        },
      ],
      grouping: "na",
    },
    {
      vaultAddress: SUBACCOUNT_ADDRESS,
    }
  );

  // Check if filled
  const status = result.response.data.statuses[0];
  if ("filled" in status) {
    console.log(`\nHyperliquid: Filled ${status.filled.totalSz} ${ticker} @ $${status.filled.avgPx}`);
    return {
      success: true,
      ticker,
      side: "short",
      filledSize: status.filled.totalSz,
      avgPrice: status.filled.avgPx,
      rawResult: result,
    };
  } else if ("resting" in status) {
    console.log(`\nHyperliquid: Order resting with oid: ${status.resting.oid}`);
    return {
      success: true,
      ticker,
      side: "short",
      orderId: status.resting.oid,
      rawResult: result,
    };
  } else if ("error" in status) {
    console.error(`\nHyperliquid: Order failed: ${status.error}`);
    return {
      success: false,
      ticker,
      side: "short",
      error: status.error,
      rawResult: result,
    };
  }

  return {
    success: false,
    ticker,
    side: "short",
    error: "Unknown order status",
    rawResult: result,
  };
}

async function main() {
  const [ticker, sizeStr] = process.argv.slice(2);

  if (!ticker || !sizeStr) {
    console.error("Usage: npx tsx src/scripts/hyperliquidShort.ts <TICKER> <SIZE>");
    console.error("Example: npx tsx src/scripts/hyperliquidShort.ts ETH 0.01");
    process.exit(1);
  }

  const size = parseFloat(sizeStr);
  if (isNaN(size) || size <= 0) {
    console.error("Size must be a positive number");
    process.exit(1);
  }

  const result = await openHyperliquidShort(ticker, size);
  console.log("\nResult:", JSON.stringify(result, null, 2));

  if (!result.success) {
    process.exit(1);
  }
}

// Only run main() when executed directly, not when imported
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
