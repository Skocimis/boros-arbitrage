/**
 * @file setHyperliquidLeverage.ts
 * @description CLI script to set leverage for a specific asset on Hyperliquid DEX.
 *
 * @usage
 *   npx tsx src/scripts/setHyperliquidLeverage.ts <TICKER> <LEVERAGE>
 *   Example: npx tsx src/scripts/setHyperliquidLeverage.ts ETH 2
 *
 * @dependencies
 *   - @nktkas/hyperliquid: SDK for interacting with Hyperliquid API
 *   - viem: Ethereum library for wallet/signing operations
 *   - dotenv: Environment variable management
 *
 * @environment
 *   - PRIVATE_KEY: Master account private key (required)
 *   - HYPERLIQUID_SUBACCOUNT: Subaccount address for operations (required)
 *
 * @behavior
 *   1. Parses CLI arguments (ticker symbol and leverage multiplier)
 *   2. Fetches asset metadata from Hyperliquid to resolve ticker to asset index
 *   3. Signs and submits updateLeverage transaction via ExchangeClient
 *   4. Executes on the configured subaccount (not the master account)
 *
 * @notes
 *   - Uses cross-margin mode (isCross: true)
 *   - Operations are performed on the subaccount specified by SUBACCOUNT_ADDRESS
 *   - The master account signs transactions on behalf of the subaccount
 */

import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import "dotenv/config";

/** Subaccount address for all leverage operations (from env) */
const SUBACCOUNT_ADDRESS = process.env.HYPERLIQUID_SUBACCOUNT;

async function main() {
  const [ticker, leverageStr] = process.argv.slice(2);

  if (!ticker || !leverageStr) {
    console.error("Usage: npx tsx src/scripts/setHyperliquidLeverage.ts <TICKER> <LEVERAGE>");
    console.error("Example: npx tsx src/scripts/setHyperliquidLeverage.ts ETH 2");
    process.exit(1);
  }

  const leverage = parseInt(leverageStr, 10);
  if (isNaN(leverage) || leverage < 1) {
    console.error("Leverage must be a positive integer");
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

  const wallet = privateKeyToAccount(privateKey as `0x${string}`);
  const exchange = new ExchangeClient({ transport, wallet });

  console.log(`Setting ${ticker} (asset index ${assetIndex}) leverage to ${leverage}x on subaccount ${SUBACCOUNT_ADDRESS}...`);

  const result = await exchange.updateLeverage(
    {
      asset: assetIndex,
      isCross: true,
      leverage,
    },
    {
      vaultAddress: SUBACCOUNT_ADDRESS,
    }
  );

  console.log("Result:", JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
