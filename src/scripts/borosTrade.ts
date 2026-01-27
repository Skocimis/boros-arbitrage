/**
 * @file borosTrade.ts
 * @description Opens positions on Boros Yield Units (YU) markets. Can be used as CLI or imported as module.
 *
 * @usage CLI
 *   npx tsx src/scripts/borosTrade.ts <SIDE> <MARKET_ID> <SIZE>
 *   Example: npx tsx src/scripts/borosTrade.ts long 40 100
 *   Example: npx tsx src/scripts/borosTrade.ts short 41 50
 *
 * @usage Module
 *   import { executeBoros, createBorosAgent, BorosOrderResult } from "./borosTrade.js";
 *
 *   // Single order (creates agent automatically)
 *   const result = await executeBoros("long", 40, 100);
 *
 *   // Multiple orders with shared agent (more efficient)
 *   const agent = await createBorosAgent();
 *   const [longResult, shortResult] = await Promise.all([
 *     executeBoros("long", 40, 100, { agent }),
 *     executeBoros("short", 41, 100, { agent }),
 *   ]);
 *
 * @exports
 *   - executeBoros(side, marketId, size, options?): Opens a YU position, returns BorosOrderResult
 *   - createBorosAgent(): Creates and approves a Boros agent for reuse across multiple orders
 *   - BorosOrderResult: Interface for order result with success, txHash, filledSize, etc.
 *   - BorosAgent: Type for the agent object
 *   - ExecuteBorosOptions: Interface for optional parameters (agent)
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
 *   1. Fetches market data to get tickStep and current rates
 *   2. Fetches order book to determine optimal limit tick with slippage
 *   3. Creates/uses agent for transaction signing
 *   4. Places IOC (Immediate-or-Cancel) order for market-like execution
 *   5. Returns result object with order status
 *
 * @notes
 *   - Size is in YU tokens (same as collateral notional, e.g., 100 = $100 notional)
 *   - Long YU: Receive floating APR, pay fixed Implied APR
 *   - Short YU: Pay floating APR, receive fixed Implied APR
 *   - Uses IOC time-in-force for immediate execution
 *   - Slippage tolerance: 0.6% absolute (rate + 0.6% for long, rate - 0.6% for short)
 *   - Requires collateral deposited on Boros (cross-margin)
 *   - Agent approval requires ETH on Arbitrum for gas (one-time per agent)
 *   - Use createBorosAgent() to share one agent across multiple orders
 *
 * @see openPosition.ts for 4-legged strategy execution
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

/** Result type for Boros order */
export interface BorosOrderResult {
  success: boolean;
  marketId: number;
  side: "long" | "short";
  size: number;
  limitApr?: number;
  filledSize?: number;
  txHash?: string;
  error?: string;
  rawResult?: unknown;
}

/** Type for Boros agent */
export type BorosAgent = Awaited<ReturnType<typeof Agent.create>>["agent"];

/** Options for executeBoros */
export interface ExecuteBorosOptions {
  /** Pre-created agent to use (avoids creating a new one) */
  agent?: BorosAgent;
}

/**
 * Creates and approves a Boros agent for trading
 * @returns The created agent that can be passed to executeBoros
 */
export async function createBorosAgent(): Promise<BorosAgent> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }

  const accountId = parseInt(process.env.BOROS_ACCOUNT_ID || "0", 10);
  const rpcUrl = process.env.BOROS_RPC_URL || DEFAULT_RPC_URL;

  // Set Boros environment to production
  setEnv("production");

  // Create wallet client
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    transport: http(rpcUrl),
    chain: arbitrum,
    account,
  });

  // Create Exchange instance for approval
  const exchange = new Exchange(walletClient, account.address, accountId, [rpcUrl]);

  // Create agent
  console.log("Creating Boros agent...");
  const { agent } = await Agent.create(walletClient);
  setInternalAgent(agent);

  // Approve agent on-chain
  try {
    await exchange.approveAgent(agent);
    console.log("Agent approved");
  } catch (approvalError) {
    const msg = approvalError instanceof Error ? approvalError.message : String(approvalError);
    if (!msg.includes("already")) {
      console.log("Agent note:", msg);
    }
  }

  return agent;
}

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

/**
 * Executes a Boros trade (long or short YU position)
 * @param side - Trade side ("long" or "short")
 * @param marketId - Boros market ID
 * @param sizeInput - Position size in YU tokens (collateral notional)
 * @param options - Optional parameters (e.g., pre-created agent)
 * @returns Order result
 */
export async function executeBoros(
  side: "long" | "short",
  marketId: number,
  sizeInput: number,
  options?: ExecuteBorosOptions
): Promise<BorosOrderResult> {
  // Check environment variables
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY not found in environment variables");
  }

  const accountId = parseInt(process.env.BOROS_ACCOUNT_ID || "0", 10);
  const rpcUrl = process.env.BOROS_RPC_URL || DEFAULT_RPC_URL;

  // Set Boros environment to production
  setEnv("production");

  // Fetch market data
  console.log(`Fetching Boros market ${marketId}...`);
  const market = await getMarket(marketId);
  if (!market) {
    throw new Error(`Market ${marketId} not found`);
  }

  if (market.state !== "Normal") {
    throw new Error(`Market ${marketId} is not in Normal state (current: ${market.state})`);
  }

  // Fetch order book
  const orderBook = await getOrderBook(marketId);
  if (!orderBook) {
    throw new Error(`Order book not found for market ${marketId}`);
  }

  // Calculate execution rate with slippage
  const midApr = market.data.midApr || market.data.markApr;
  const executionRate = calculateExecutionRate(orderBook, side, midApr);

  // Convert rate to tick
  const tickStep = BigInt(market.imData.tickStep);
  const roundDown = side === "short";
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

  // Use provided agent or create a new one
  let agent: Awaited<ReturnType<typeof Agent.create>>["agent"];
  if (options?.agent) {
    agent = options.agent;
    setInternalAgent(agent);
  } else {
    console.log("Setting up Boros agent...");
    const created = await Agent.create(walletClient);
    agent = created.agent;
    setInternalAgent(agent);

    // Approve agent on-chain (required once per agent)
    try {
      await exchange.approveAgent(agent);
      console.log("Agent approved");
    } catch (approvalError) {
      const msg = approvalError instanceof Error ? approvalError.message : String(approvalError);
      if (!msg.includes("already")) {
        console.log("Agent note:", msg);
      }
    }
  }

  // Pack market account for cross-margin trading
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
  console.log(`Opening ${side.toUpperCase()} YU position on Boros:`);
  console.log(`  Market: ${market.metadata.name} (${market.metadata.platformName})`);
  console.log(`  Market ID: ${marketId}`);
  console.log(`  Expiry: ${expiryStr}`);
  console.log(`  Size: ${sizeInput} YU tokens`);
  console.log(`  Mid APR: ${(midApr * 100).toFixed(2)}%`);
  console.log(`  Limit APR: ${(executionRate * 100).toFixed(2)}% (${side === "long" ? "+" : "-"}${(SLIPPAGE_PCT * 100).toFixed(1)}% slippage)`);
  console.log(`  Limit Tick: ${limitTick}`);
  console.log(`  Order Type: IOC (Immediate-or-Cancel)`);
  console.log("");

  // Place order
  console.log("Placing Boros order...");
  try {
    const sideEnum = side === "long" ? Side.LONG : Side.SHORT;
    const result = await exchange.placeOrder({
      marketAcc,
      marketId,
      side: sideEnum,
      size,
      limitTick,
      tif: TimeInForce.IMMEDIATE_OR_CANCEL,
    });

    if (result.executeResponse?.status === "success") {
      console.log("\nBoros: Order executed successfully!");
      console.log(`  Tx Hash: ${result.executeResponse.txHash}`);

      // Extract swap details if available
      const swapEvent = result.result?.events?.find((e: { eventName: string }) => e.eventName === "Swap");
      let filledSize: number | undefined;
      if (swapEvent?.args) {
        const sizeOut = BigInt(swapEvent.args.sizeOut);
        filledSize = Math.abs(Number(sizeOut) / 1e18);
        console.log(`  Filled Size: ${filledSize.toFixed(4)} YU`);
      }

      return {
        success: true,
        marketId,
        side,
        size: sizeInput,
        limitApr: executionRate,
        filledSize,
        txHash: result.executeResponse.txHash,
        rawResult: result,
      };
    } else {
      return {
        success: false,
        marketId,
        side,
        size: sizeInput,
        error: "Order did not execute successfully",
        rawResult: result,
      };
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("\nBoros: Order failed:", errorMessage);
    return {
      success: false,
      marketId,
      side,
      size: sizeInput,
      error: errorMessage,
    };
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

  const result = await executeBoros(sideLower as "long" | "short", marketId, sizeInput);

  // Custom JSON stringify that handles BigInt
  const jsonResult = JSON.stringify(result, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  , 2);
  console.log("\nResult:", jsonResult);

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
