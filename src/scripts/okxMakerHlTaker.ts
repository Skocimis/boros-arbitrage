/**
 * @file okxMakerHlTaker.ts
 * @description OKX maker + Hyperliquid/Boros taker execution script.
 *   Monitors open OKX orders and recent fills on the strategy's instrument.
 *   When new OKX fills are detected, automatically fires taker orders on
 *   Hyperliquid and Boros to complete the remaining 3 legs of the strategy.
 *
 *   On the first poll, all existing fills are recorded without hedging.
 *   Subsequent polls detect new fills and fire hedges in parallel.
 *
 * @usage CLI
 *   npx tsx src/scripts/okxMakerHlTaker.ts <STRATEGY_NAME>
 *   Example: npx tsx src/scripts/okxMakerHlTaker.ts ETH27Mar
 *
 * @dependencies
 *   - axios: HTTP client for OKX API requests
 *   - crypto: Node.js crypto for HMAC-SHA256 signing
 *   - @nktkas/hyperliquid: SDK for Hyperliquid trading
 *   - @pendle/sdk-boros: SDK for Boros trading
 *   - viem: Ethereum library for wallet/signing
 *   - dotenv: Environment variable management
 *
 * @environment
 *   - OKX_API_KEY: OKX API key (required)
 *   - OKX_SECRET_KEY: OKX API secret key (required)
 *   - OKX_API_PASSPHRASE: OKX API passphrase (required)
 *   - PRIVATE_KEY: Wallet private key for HL and Boros signing (required)
 *   - HYPERLIQUID_SUBACCOUNT: Subaccount address for HL operations (required)
 *   - BOROS_ACCOUNT_ID: Boros account ID, defaults to 0 (optional)
 *   - BOROS_RPC_URL: Ethereum RPC URL, defaults to Arbitrum public RPC (optional)
 *
 * @behavior
 *   1. Parses strategy name from CLI args, looks up ticker and market IDs
 *   2. Fetches instrument info once at startup (for contract value)
 *   3. Creates a Boros agent at startup (for reuse across hedges)
 *   4. Polls OKX every 3 seconds for open orders and recent fills
 *   5. First poll: seeds seenTradeIds set without firing hedges
 *   6. Subsequent polls: detects new fills and fires 3 taker legs in parallel
 *   7. Displays live dashboard with open orders, recent fills, and hedge log
 *
 * @side_mapping
 *   OKX BUY fill:
 *     - Boros OKX market: LONG
 *     - HL perp: SHORT
 *     - Boros HL market: SHORT
 *   OKX SELL fill:
 *     - Boros OKX market: SHORT
 *     - HL perp: LONG
 *     - Boros HL market: LONG
 *
 * @see borosTrade.ts for Boros order execution
 * @see hyperliquidShort.ts for Hyperliquid perp execution
 * @see strategies.ts for strategy definitions
 */

import axios from "axios";
import crypto from "crypto";
import "dotenv/config";

import { getStrategy, listStrategies, type Strategy } from "../config/strategies.js";
import { executeBoros, createBorosAgent, type BorosAgent } from "../scripts/borosTrade.js";
import { ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";
import { privateKeyToAccount } from "viem/accounts";

// ============================================================
// Constants
// ============================================================

const BASE_URL = "https://www.okx.com";
const POLL_INTERVAL_MS = 3000;

/** Slippage tolerance in basis points for Hyperliquid orders (50 = 0.5%) */
const HL_SLIPPAGE_BPS = 50;

// ============================================================
// OKX Auth Helpers (reused from okxLong.ts)
// ============================================================

function getTimestamp(): string {
  return new Date().toISOString();
}

function sign(
  timestamp: string,
  method: string,
  path: string,
  body: string,
): string {
  const secretKey = process.env.OKX_SECRET_KEY!;
  const preHash = timestamp + method + path + body;
  return crypto
    .createHmac("sha256", secretKey)
    .update(preHash)
    .digest("base64");
}

function getAuthHeaders(
  method: string,
  path: string,
  body: string = "",
): Record<string, string> {
  const timestamp = getTimestamp();
  return {
    "OK-ACCESS-KEY": process.env.OKX_API_KEY!,
    "OK-ACCESS-SIGN": sign(timestamp, method, path, body),
    "OK-ACCESS-TIMESTAMP": timestamp,
    "OK-ACCESS-PASSPHRASE": process.env.OKX_API_PASSPHRASE!,
    "Content-Type": "application/json",
  };
}

// ============================================================
// Type Interfaces
// ============================================================

interface OkxApiResponse<T> {
  code: string;
  msg: string;
  data: T[];
}

interface OkxInstrument {
  instId: string;
  lotSz: string;
  minSz: string;
  ctVal: string;
  ctMult: string;
  tickSz: string;
}

interface OkxPendingOrder {
  instId: string;
  ordId: string;
  clOrdId: string;
  side: string;
  ordType: string;
  px: string;
  sz: string;
  fillSz: string;
  avgPx: string;
  state: string;
  cTime: string;
  uTime: string;
}

interface OkxFill {
  instId: string;
  ordId: string;
  tradeId: string;
  side: string;
  fillPx: string;
  fillSz: string;
  fee: string;
  feeCcy: string;
  ts: string;
}

interface HedgeLogEntry {
  time: string;
  okxSide: string;
  assetSize: number;
  borosNotional: number;
  hlResult: "OK" | "FAIL" | string;
  borosOkxResult: "OK" | "FAIL" | string;
  borosHlResult: "OK" | "FAIL" | string;
}

// ============================================================
// State
// ============================================================

const seenTradeIds = new Set<string>();
let isFirstPoll = true;
const hedgeLog: HedgeLogEntry[] = [];

// ============================================================
// API Fetch Functions
// ============================================================

async function fetchInstrument(
  instId: string,
): Promise<OkxInstrument | null> {
  try {
    const { data } = await axios.get<OkxApiResponse<OkxInstrument>>(
      `${BASE_URL}/api/v5/public/instruments`,
      {
        params: { instType: "SWAP", instId },
        timeout: 15000,
      },
    );
    if (data.code !== "0" || !data.data?.[0]) return null;
    return data.data[0];
  } catch {
    return null;
  }
}

async function fetchPendingOrders(
  instId: string,
): Promise<OkxPendingOrder[] | null> {
  try {
    const path = `/api/v5/trade/orders-pending?instType=SWAP&instId=${instId}`;
    const { data } = await axios.get<OkxApiResponse<OkxPendingOrder>>(
      `${BASE_URL}${path}`,
      {
        headers: getAuthHeaders("GET", path),
        timeout: 15000,
      },
    );
    if (data.code !== "0") return null;
    return data.data;
  } catch {
    return null;
  }
}

async function fetchFills(instId: string): Promise<OkxFill[] | null> {
  try {
    const path = `/api/v5/trade/fills?instType=SWAP&instId=${instId}`;
    const { data } = await axios.get<OkxApiResponse<OkxFill>>(
      `${BASE_URL}${path}`,
      {
        headers: getAuthHeaders("GET", path),
        timeout: 15000,
      },
    );
    if (data.code !== "0") return null;
    return data.data;
  } catch {
    return null;
  }
}

// ============================================================
// Hyperliquid Order Function
// ============================================================

/**
 * Opens a long or short position on Hyperliquid DEX.
 * Generalized from hyperliquidShort.ts to support both directions.
 */
async function openHlOrder(
  ticker: string,
  size: number,
  side: "long" | "short",
): Promise<{ success: boolean; error?: string }> {
  const privateKey = process.env.PRIVATE_KEY!;
  const subaccount = process.env.HYPERLIQUID_SUBACCOUNT!;

  const transport = new HttpTransport();
  const info = new InfoClient({ transport });

  const meta = await info.meta();
  const assetIndex = meta.universe.findIndex(
    (asset) => asset.name.toUpperCase() === ticker.toUpperCase(),
  );
  if (assetIndex === -1) {
    return { success: false, error: `Asset ${ticker} not found on Hyperliquid` };
  }

  const assetMeta = meta.universe[assetIndex];

  const allMids = await info.allMids();
  const midPrice = parseFloat(allMids[ticker.toUpperCase()]);
  if (!midPrice) {
    return { success: false, error: `Could not get price for ${ticker}` };
  }

  const bps = HL_SLIPPAGE_BPS / 10000;
  const limitPrice = side === "long"
    ? midPrice * (1 + bps)
    : midPrice * (1 - bps);

  const roundedPrice = formatPrice(limitPrice, assetMeta.szDecimals);
  const roundedSize = formatSize(size, assetMeta.szDecimals);

  const wallet = privateKeyToAccount(privateKey as `0x${string}`);
  const exchange = new ExchangeClient({ transport, wallet });

  const result = await exchange.order(
    {
      orders: [
        {
          a: assetIndex,
          b: side === "long",
          p: roundedPrice,
          s: roundedSize,
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    },
    {
      vaultAddress: subaccount,
    },
  );

  // Status type narrowing: same pattern as hyperliquidShort.ts
  // @ts-expect-error — @nktkas/hyperliquid status union includes string literals that break narrowing
  const status: { filled?: { totalSz: string; avgPx: string }; resting?: { oid: number }; error?: string } = result.response.data.statuses[0];
  if (status.filled) {
    return { success: true };
  } else if (status.resting) {
    return { success: true };
  } else if (status.error) {
    return { success: false, error: status.error };
  }

  return { success: false, error: "Unknown order status" };
}

// ============================================================
// Hedge Execution
// ============================================================

/**
 * Processes a new OKX fill by firing the 3 taker legs in parallel.
 */
async function processNewFill(
  fill: OkxFill,
  strategy: Strategy,
  ctVal: number,
  borosAgent: BorosAgent,
): Promise<void> {
  const fillSz = parseFloat(fill.fillSz);
  const fillPx = parseFloat(fill.fillPx);
  const assetSize = fillSz * ctVal;
  const borosNotional = assetSize * fillPx;
  const okxSide = fill.side.toLowerCase();

  // Determine taker sides based on OKX fill direction
  const isOkxBuy = okxSide === "buy";

  const borosOkxSide: "long" | "short" = isOkxBuy ? "long" : "short";
  const hlSide: "long" | "short" = isOkxBuy ? "short" : "long";
  const borosHlSide: "long" | "short" = isOkxBuy ? "short" : "long";

  const time = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`\n[${time}] New OKX ${fill.side.toUpperCase()} fill: ${assetSize.toFixed(6)} ${strategy.ticker} @ $${fillPx.toFixed(2)}`);
  console.log(`  Firing hedges: Boros OKX=${borosOkxSide}, HL=${hlSide}, Boros HL=${borosHlSide}`);

  // Fire all 3 taker legs in parallel
  const [hlRes, borosOkxRes, borosHlRes] = await Promise.all([
    openHlOrder(strategy.ticker, assetSize, hlSide).catch((err) => ({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })),
    executeBoros(borosOkxSide, strategy.borosLongMarketId, borosNotional, { agent: borosAgent }).catch((err) => ({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      marketId: strategy.borosLongMarketId,
      side: borosOkxSide,
      size: borosNotional,
    })),
    executeBoros(borosHlSide, strategy.borosShortMarketId, borosNotional, { agent: borosAgent }).catch((err) => ({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      marketId: strategy.borosShortMarketId,
      side: borosHlSide,
      size: borosNotional,
    })),
  ]);

  const entry: HedgeLogEntry = {
    time,
    okxSide: fill.side.toUpperCase(),
    assetSize,
    borosNotional,
    hlResult: hlRes.success ? "OK" : (hlRes.error ?? "FAIL"),
    borosOkxResult: borosOkxRes.success ? "OK" : (borosOkxRes.error ?? "FAIL"),
    borosHlResult: borosHlRes.success ? "OK" : (borosHlRes.error ?? "FAIL"),
  };

  hedgeLog.push(entry);
  console.log(`  HL: ${entry.hlResult} | Boros OKX: ${entry.borosOkxResult} | Boros HL: ${entry.borosHlResult}`);
}

// ============================================================
// Formatting Helpers
// ============================================================

function formatTime(tsMs: string): string {
  const d = new Date(parseInt(tsMs, 10));
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function formatFillPct(sz: string, fillSz: string): string {
  const total = parseFloat(sz);
  const filled = parseFloat(fillSz);
  if (total === 0) return "0%";
  return `${((filled / total) * 100).toFixed(1)}%`;
}

function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : " ".repeat(len - str.length) + str;
}

// ============================================================
// Dashboard Display
// ============================================================

function displayDashboard(
  strategyName: string,
  instId: string,
  ctVal: number,
  orders: OkxPendingOrder[] | null,
  fills: OkxFill[] | null,
  error: string | null,
): void {
  console.clear();

  const now = new Date().toLocaleTimeString("en-US", { hour12: false });
  const separator = "=".repeat(90);

  console.log(separator);
  console.log(`  OKX MAKER + HL TAKER | Strategy: ${strategyName} | Instrument: ${instId} | ${now}`);
  console.log(separator);

  if (error) {
    console.log(`\n  ERROR: ${error}\n`);
  }

  // ---- Open Orders ----
  console.log("\n  OPEN ORDERS");
  console.log("  " + "-".repeat(86));

  if (orders === null) {
    console.log("  (failed to fetch)");
  } else if (orders.length === 0) {
    console.log("  (none)");
  } else {
    console.log(
      "  " +
        pad("Side", 6) +
        pad("Size", 14) +
        pad("Filled", 9) +
        pad("Price", 14) +
        pad("Type", 10) +
        pad("Order ID", 22) +
        "Created",
    );
    console.log("  " + "-".repeat(86));

    for (const o of orders) {
      const contracts = parseFloat(o.sz);
      const assetSize = contracts * ctVal;
      const sideStr = o.side.toUpperCase();
      const sizeStr = `${assetSize.toFixed(6)}`;
      const fillPct = formatFillPct(o.sz, o.fillSz);
      const priceStr = parseFloat(o.px) > 0 ? `$${parseFloat(o.px).toFixed(2)}` : "market";
      const typeStr = o.ordType;
      const created = formatTime(o.cTime);

      console.log(
        "  " +
          pad(sideStr, 6) +
          padLeft(sizeStr, 12) + "  " +
          padLeft(fillPct, 7) + "  " +
          padLeft(priceStr, 12) + "  " +
          pad(typeStr, 10) +
          pad(o.ordId, 22) +
          created,
      );
    }
  }

  // ---- Recent Fills ----
  console.log("\n  RECENT FILLS");
  console.log("  " + "-".repeat(86));

  if (fills === null) {
    console.log("  (failed to fetch)");
  } else if (fills.length === 0) {
    console.log("  (none)");
  } else {
    console.log(
      "  " +
        pad("Time", 10) +
        pad("Side", 6) +
        pad("Size", 14) +
        pad("Price", 14) +
        pad("Fee", 16) +
        "Order ID",
    );
    console.log("  " + "-".repeat(86));

    for (const f of fills) {
      const contracts = parseFloat(f.fillSz);
      const assetSize = contracts * ctVal;
      const time = formatTime(f.ts);
      const sideStr = f.side.toUpperCase();
      const sizeStr = `${assetSize.toFixed(6)}`;
      const priceStr = `$${parseFloat(f.fillPx).toFixed(2)}`;
      const feeStr = `${parseFloat(f.fee).toFixed(6)} ${f.feeCcy}`;

      console.log(
        "  " +
          pad(time, 10) +
          pad(sideStr, 6) +
          padLeft(sizeStr, 12) + "  " +
          padLeft(priceStr, 12) + "  " +
          pad(feeStr, 16) +
          f.ordId,
      );
    }
  }

  // ---- Hedge Log ----
  console.log("\n  HEDGE LOG");
  console.log("  " + "-".repeat(86));

  if (hedgeLog.length === 0) {
    console.log("  (no hedges yet)");
  } else {
    console.log(
      "  " +
        pad("Time", 10) +
        pad("OKX", 6) +
        pad("Size", 14) +
        pad("Notional", 14) +
        pad("HL", 12) +
        pad("Boros OKX", 16) +
        "Boros HL",
    );
    console.log("  " + "-".repeat(86));

    const recentHedges = hedgeLog.slice(-10);
    for (const h of recentHedges) {
      const sizeStr = h.assetSize.toFixed(6);
      const notionalStr = `$${h.borosNotional.toFixed(0)}`;
      const hlStr = h.hlResult.length > 10 ? h.hlResult.slice(0, 10) + ".." : h.hlResult;
      const borosOkxStr = h.borosOkxResult.length > 14 ? h.borosOkxResult.slice(0, 14) + ".." : h.borosOkxResult;
      const borosHlStr = h.borosHlResult.length > 14 ? h.borosHlResult.slice(0, 14) + ".." : h.borosHlResult;

      console.log(
        "  " +
          pad(h.time, 10) +
          pad(h.okxSide, 6) +
          padLeft(sizeStr, 12) + "  " +
          padLeft(notionalStr, 12) + "  " +
          pad(hlStr, 12) +
          pad(borosOkxStr, 16) +
          borosHlStr,
      );
    }
  }

  // ---- Footer ----
  console.log("\n" + separator);
  console.log(
    `  Contract value: ${ctVal} | Poll: ${POLL_INTERVAL_MS / 1000}s | Hedges: ${hedgeLog.length} | Ctrl+C to exit`,
  );
  console.log(separator);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const [strategyName] = process.argv.slice(2);

  if (!strategyName) {
    console.error("Usage: npx tsx src/scripts/okxMakerHlTaker.ts <STRATEGY_NAME>");
    console.error("Example: npx tsx src/scripts/okxMakerHlTaker.ts ETH27Mar");
    console.error("");
    console.error(`Available strategies: ${listStrategies().join(", ")}`);
    process.exit(1);
  }

  const strategy = getStrategy(strategyName);
  if (!strategy) {
    console.error(
      `Strategy "${strategyName}" not found. Available: ${listStrategies().join(", ")}`,
    );
    process.exit(1);
  }

  // Validate OKX env vars
  if (!process.env.OKX_API_KEY) {
    console.error("OKX_API_KEY not found in environment variables");
    process.exit(1);
  }
  if (!process.env.OKX_SECRET_KEY) {
    console.error("OKX_SECRET_KEY not found in environment variables");
    process.exit(1);
  }
  if (!process.env.OKX_API_PASSPHRASE) {
    console.error("OKX_API_PASSPHRASE not found in environment variables");
    process.exit(1);
  }

  // Validate HL + Boros env vars
  if (!process.env.PRIVATE_KEY) {
    console.error("PRIVATE_KEY not found in environment variables");
    process.exit(1);
  }
  if (!process.env.HYPERLIQUID_SUBACCOUNT) {
    console.error("HYPERLIQUID_SUBACCOUNT not found in environment variables");
    process.exit(1);
  }

  const instId = `${strategy.ticker.toUpperCase()}-USDT-SWAP`;

  console.log(`Fetching instrument info for ${instId}...`);
  const instrument = await fetchInstrument(instId);
  if (!instrument) {
    console.error(`Failed to fetch instrument info for ${instId}`);
    process.exit(1);
  }

  const ctVal = parseFloat(instrument.ctVal);
  console.log(`Contract value: ${ctVal} ${strategy.ticker.toUpperCase()}/contract`);

  // Create Boros agent once at startup for reuse across hedges
  console.log("Creating Boros agent for hedge execution...");
  const borosAgent = await createBorosAgent();
  console.log("Boros agent ready.");

  console.log(`Starting monitor (polling every ${POLL_INTERVAL_MS / 1000}s)...\n`);

  const tick = async () => {
    let error: string | null = null;
    let orders: OkxPendingOrder[] | null = null;
    let fills: OkxFill[] | null = null;

    try {
      [orders, fills] = await Promise.all([
        fetchPendingOrders(instId),
        fetchFills(instId),
      ]);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    // Process new fills for hedging
    if (fills) {
      for (const fill of fills) {
        if (seenTradeIds.has(fill.tradeId)) continue;

        if (isFirstPoll) {
          // First poll: just record existing fills, no hedging
          seenTradeIds.add(fill.tradeId);
        } else {
          // New fill detected: fire hedge legs
          seenTradeIds.add(fill.tradeId);
          await processNewFill(fill, strategy, ctVal, borosAgent);
        }
      }

      if (isFirstPoll) {
        isFirstPoll = false;
      }
    }

    displayDashboard(strategyName, instId, ctVal, orders, fills, error);
  };

  await tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
