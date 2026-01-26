/**
 * @file hyperliquidShort.ts
 * @description CLI script to open a short position on Hyperliquid DEX.
 *
 * @usage
 *   npx tsx src/scripts/hyperliquidShort.ts <TICKER> <SIZE>
 *   Example: npx tsx src/scripts/hyperliquidShort.ts ETH 0.01
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
 *   1. Parses CLI arguments (ticker symbol and position size)
 *   2. Fetches asset metadata from Hyperliquid to resolve ticker to asset index
 *   3. Fetches current mid price from Hyperliquid
 *   4. Calculates limit price with slippage protection (0.5% below mid)
 *   5. Formats price/size according to Hyperliquid tick rules (5 sig figs, decimals)
 *   6. Places IOC (Immediate-or-Cancel) short order for market-like execution
 *   7. Reports fill status (filled, resting, or error)
 *
 * @notes
 *   - Uses IOC time-in-force for immediate execution (market order behavior)
 *   - Slippage set to 0.5% (50 bps) - order will fill at limit price or better
 *   - Operations are performed on the subaccount specified by SUBACCOUNT_ADDRESS
 *   - The master account signs transactions on behalf of the subaccount
 *   - Price formatting follows Hyperliquid rules: max 5 sig figs, max (6-szDecimals) decimals
 *
 * @see hyperliquidLong.ts for opening long positions (not yet implemented)
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

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY not found in environment variables");
    process.exit(1);
  }

  if (!SUBACCOUNT_ADDRESS) {
    console.error("HYPERLIQUID_SUBACCOUNT not found in environment variables");
    process.exit(1);
  }

  const transport = new HttpTransport();
  const info = new InfoClient({ transport });

  // Get asset index from ticker
  const meta = await info.meta();
  const assetIndex = meta.universe.findIndex(
    (asset) => asset.name.toUpperCase() === ticker.toUpperCase()
  );

  if (assetIndex === -1) {
    console.error(`Asset ${ticker} not found. Available assets:`);
    console.error(meta.universe.map((a) => a.name).join(", "));
    process.exit(1);
  }

  const assetMeta = meta.universe[assetIndex];

  // Get current mid price
  const allMids = await info.allMids();
  const midPrice = parseFloat(allMids[ticker.toUpperCase()]);
  if (!midPrice) {
    console.error(`Could not get price for ${ticker}`);
    process.exit(1);
  }

  // For a short, we sell at a lower price (with slippage)
  const slippageMultiplier = 1 - SLIPPAGE_BPS / 10000;
  const limitPrice = midPrice * slippageMultiplier;

  // Format price and size according to Hyperliquid rules
  const roundedPrice = formatPrice(limitPrice, assetMeta.szDecimals);
  const roundedSize = formatSize(size, assetMeta.szDecimals);

  const wallet = privateKeyToAccount(privateKey as `0x${string}`);
  const exchange = new ExchangeClient({ transport, wallet });

  console.log(`Opening SHORT position on ${ticker}:`);
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

  console.log("\nResult:", JSON.stringify(result, null, 2));

  // Check if filled
  const status = result.response.data.statuses[0];
  if ("filled" in status) {
    console.log(`\nFilled ${status.filled.totalSz} ${ticker} @ $${status.filled.avgPx}`);
  } else if ("resting" in status) {
    console.log(`\nOrder resting with oid: ${status.resting.oid}`);
  } else if ("error" in status) {
    console.error(`\nOrder failed: ${status.error}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
