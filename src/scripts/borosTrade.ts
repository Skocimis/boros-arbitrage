/**
 * @file borosTrade.ts
 * @description CLI script to open a position on Boros Yield Units (YU) markets.
 *
 * @usage
 *   npx tsx src/scripts/borosTrade.ts <SIDE> <MARKET_ID> <SIZE>
 *   Example: npx tsx src/scripts/borosTrade.ts long 40 100
 *   Example: npx tsx src/scripts/borosTrade.ts short 41 50
 *
 * @dependencies
 *   - @pendle/sdk-boros: Official Boros SDK for trading
 *   - @pendle/boros-offchain-math: Math utilities for rate/tick conversions
 *   - viem: Ethereum library for wallet/signing operations
 *   - dotenv: Environment variable management
 *
 * @environment
 *   - PRIVATE_KEY: Wallet private key for signing transactions (required)
 *   - BOROS_ACCOUNT_ID: Boros account ID, defaults to 0 (optional)
 *   - BOROS_RPC_URL: Ethereum RPC URL, defaults to Arbitrum public RPC (optional)
 *
 * @behavior
 *   1. Parses CLI arguments (side, market ID, size in collateral/YU tokens)
 *   2. Validates required environment variables
 *   3. Fetches market data to get tickStep and current rates
 *   4. Fetches order book to determine optimal limit tick with slippage
 *   5. Creates and approves agent for transaction signing (one-time on-chain tx)
 *   6. Places IOC (Immediate-or-Cancel) order for market-like execution
 *   7. Reports order status (success or error)
 *
 * @notes
 *   - Size is in YU tokens (same as collateral notional, e.g., 100 = $100 notional)
 *   - Long YU: Receive floating APR, pay fixed Implied APR
 *   - Short YU: Pay floating APR, receive fixed Implied APR
 *   - Uses IOC time-in-force for immediate execution
 *   - Slippage tolerance: 0.6% absolute (rate + 0.6% for long, rate - 0.6% for short)
 *   - Requires collateral deposited on Boros (cross-margin)
 *   - Agent approval requires ETH on Arbitrum for gas (one-time)
 *
 * @see hyperliquidShort.ts for Hyperliquid perp leg
 * @see okxLong.ts for OKX perp leg
 */

import { createRequire } from "module";
import { createWalletClient, http, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import "dotenv/config";
import {
  Exchange,
  Side,
  TimeInForce,
  MarketAccLib,
  estimateTickForRate,
  setEnv,
  Agent,
  setInternalAgent,
  CROSS_MARKET_ID,
} from "@pendle/sdk-boros";

// Use createRequire to load CJS module (ESM export is broken in this package)
const require = createRequire(import.meta.url);
const { FixedX18 } = require("@pendle/boros-offchain-math");

/** Default Arbitrum RPC URL */
const DEFAULT_RPC_URL = "https://arb1.arbitrum.io/rpc";

/** Absolute slippage tolerance in percentage points (0.6% = 0.006) */
const SLIPPAGE_PCT = 0.006;

/** Boros API base URL */
const BOROS_API_URL = "https://api.boros.finance";

/**
 * Fetches market data from Boros API
 */
async function getMarket(marketId: number): Promise<{
  marketId: number;
  tokenId: number;
  imData: {
    tickStep: number;
    maturity: number;
  };
  data: {
    midApr: number;
    markApr: number;
  };
  metadata: {
    name: string;
    platformName: string;
  };
  state: string;
} | null> {
  const response = await fetch(`${BOROS_API_URL}/core/v1/markets/${marketId}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch market ${marketId}: ${response.status}`);
  }
  return response.json();
}

/**
 * Fetches order book from Boros API
 */
async function getOrderBook(marketId: number): Promise<{
  long: { ia: number[]; sz: string[] };  // Bid side
  short: { ia: number[]; sz: string[] }; // Ask side
} | null> {
  const response = await fetch(
    `${BOROS_API_URL}/core/v1/order-books/${marketId}?tickSize=0.0001`
  );
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Failed to fetch order book for market ${marketId}: ${response.status}`);
  }
  return response.json();
}

/**
 * Calculate execution rate with slippage from order book
 * For long: use ask side, add slippage (higher rate)
 * For short: use bid side, subtract slippage (lower rate)
 */
function calculateExecutionRate(
  orderBook: { long?: { ia?: number[] }; short?: { ia?: number[] } },
  side: "long" | "short",
  midApr: number
): number {
  // ia values are in basis points (e.g., 850 = 8.5%)
  if (side === "long") {
    // Long YU: use ask side (API's "short" field)
    // Accept a higher rate (worse for buyer)
    const askIa = orderBook.short?.ia;
    const bestAsk = askIa && askIa.length > 0
      ? askIa[0] / 10000
      : midApr;
    return bestAsk + SLIPPAGE_PCT;
  } else {
    // Short YU: use bid side (API's "long" field)
    // Accept a lower rate (worse for seller)
    const bidIa = orderBook.long?.ia;
    const bestBid = bidIa && bidIa.length > 0
      ? bidIa[0] / 10000
      : midApr;
    return bestBid - SLIPPAGE_PCT;
  }
}

async function main() {
  const [sideArg, marketIdStr, sizeStr] = process.argv.slice(2);

  if (!sideArg || !marketIdStr || !sizeStr) {
    console.error("Usage: npx tsx src/scripts/borosTrade.ts <SIDE> <MARKET_ID> <SIZE>");
    console.error("  SIDE: 'long' or 'short'");
    console.error("  MARKET_ID: Boros market ID (use 'npm run scan' to list markets)");
    console.error("  SIZE: Position size in YU tokens (collateral notional)");
    console.error("");
    console.error("Examples:");
    console.error("  npx tsx src/scripts/borosTrade.ts long 40 100   # Long $100 on OKX ETH");
    console.error("  npx tsx src/scripts/borosTrade.ts short 41 50   # Short $50 on HL ETH");
    process.exit(1);
  }

  // Validate side
  const sideLower = sideArg.toLowerCase();
  if (sideLower !== "long" && sideLower !== "short") {
    console.error("Side must be 'long' or 'short'");
    process.exit(1);
  }
  const side = sideLower === "long" ? Side.LONG : Side.SHORT;

  // Validate market ID
  const marketId = parseInt(marketIdStr, 10);
  if (isNaN(marketId) || marketId < 0) {
    console.error("Market ID must be a non-negative integer");
    process.exit(1);
  }

  // Validate size
  const sizeInput = parseFloat(sizeStr);
  if (isNaN(sizeInput) || sizeInput <= 0) {
    console.error("Size must be a positive number");
    process.exit(1);
  }

  // Check environment variables
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY not found in environment variables");
    process.exit(1);
  }

  const accountId = parseInt(process.env.BOROS_ACCOUNT_ID || "0", 10);
  const rpcUrl = process.env.BOROS_RPC_URL || DEFAULT_RPC_URL;

  // Set Boros environment to production
  setEnv("production");

  // Fetch market data
  console.log(`Fetching market ${marketId}...`);
  const market = await getMarket(marketId);
  if (!market) {
    console.error(`Market ${marketId} not found`);
    process.exit(1);
  }

  if (market.state !== "Normal") {
    console.error(`Market ${marketId} is not in Normal state (current: ${market.state})`);
    console.error("Cannot trade on markets that are CloseOnly, Paused, or Settled");
    process.exit(1);
  }

  // Fetch order book
  const orderBook = await getOrderBook(marketId);
  if (!orderBook) {
    console.error(`Order book not found for market ${marketId}`);
    process.exit(1);
  }

  // Calculate execution rate with slippage
  const midApr = market.data.midApr || market.data.markApr;
  const executionRate = calculateExecutionRate(orderBook, sideLower as "long" | "short", midApr);

  // Convert rate to tick
  const tickStep = BigInt(market.imData.tickStep);
  // For long orders: round UP (accept higher rate)
  // For short orders: round DOWN (accept lower rate)
  const roundDown = sideLower === "short";
  const rateFixedX18 = FixedX18.fromNumber(executionRate);
  const limitTick = Number(
    estimateTickForRate(rateFixedX18, tickStep, roundDown)
  );

  // Convert size to bigint (18 decimals)
  const size = parseUnits(sizeInput.toString(), 18);

  // Create wallet client
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    transport: http(rpcUrl),
    chain: arbitrum,
    account,
  });

  // Create Exchange instance
  const exchange = new Exchange(walletClient, account.address, accountId, [rpcUrl]);

  // Create and set agent for transaction signing
  console.log("Setting up agent...");
  const { agent } = await Agent.create(walletClient);
  setInternalAgent(agent);

  // Approve agent on-chain (required once per agent)
  try {
    await exchange.approveAgent(agent);
    console.log("Agent approved");
  } catch (approvalError) {
    // Agent might already be approved - ignore if already approved
    const msg = approvalError instanceof Error ? approvalError.message : String(approvalError);
    if (!msg.includes("already")) {
      console.log("Agent note:", msg);
    }
  }

  // Pack market account for cross-margin trading
  // tokenId comes from the market
  // For cross-margin, use CROSS_MARKET_ID (0xffffff) as the marketId in the pack
  const tokenId = market.tokenId;
  const marketAcc = MarketAccLib.pack(
    account.address,
    accountId,
    tokenId,
    CROSS_MARKET_ID
  );

  // Calculate expiry date
  const expiryDate = new Date(market.imData.maturity * 1000);
  const expiryStr = expiryDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).replace(/ /g, "-");

  // Display order details
  console.log("");
  console.log(`Opening ${sideLower.toUpperCase()} YU position on Boros:`);
  console.log(`  Market: ${market.metadata.name} (${market.metadata.platformName})`);
  console.log(`  Market ID: ${marketId}`);
  console.log(`  Expiry: ${expiryStr}`);
  console.log(`  Size: ${sizeInput} YU tokens`);
  console.log(`  Mid APR: ${(midApr * 100).toFixed(2)}%`);
  console.log(`  Limit APR: ${(executionRate * 100).toFixed(2)}% (${sideLower === "long" ? "+" : "-"}${(SLIPPAGE_PCT * 100).toFixed(1)}% slippage)`);
  console.log(`  Limit Tick: ${limitTick}`);
  console.log(`  Order Type: IOC (Immediate-or-Cancel)`);
  console.log("");

  // Place order
  console.log("Placing order...");
  try {
    const result = await exchange.placeOrder({
      marketAcc,
      marketId,
      side,
      size,
      limitTick,
      tif: TimeInForce.IMMEDIATE_OR_CANCEL,
    });

    // Custom JSON stringify that handles BigInt
    const jsonResult = JSON.stringify(result, (_, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2);

    if (result.executeResponse?.status === "success") {
      console.log("\nOrder executed successfully!");
      console.log(`  Tx Hash: ${result.executeResponse.txHash}`);

      // Extract swap details if available
      const swapEvent = result.result?.events?.find((e: { eventName: string }) => e.eventName === "Swap");
      if (swapEvent?.args) {
        const sizeOut = BigInt(swapEvent.args.sizeOut);
        const sizeFormatted = Number(sizeOut) / 1e18;
        console.log(`  Filled Size: ${Math.abs(sizeFormatted).toFixed(4)} YU`);
      }
    } else {
      console.log("Result:", jsonResult);
    }
  } catch (error: unknown) {
    console.error("\nOrder failed:");
    if (error instanceof Error) {
      console.error("  Message:", error.message);
      const axiosError = error as { response?: { data?: unknown } };
      if (axiosError.response?.data) {
        console.error("  Details:", JSON.stringify(axiosError.response.data, null, 2));
      }
    } else {
      console.error("  Error:", error);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
