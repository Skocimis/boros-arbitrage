/**
 * @file trackStrategy.ts
 * @description Tracks an active 4-legged strategy position across Hyperliquid, OKX, and Boros.
 *
 * @usage CLI
 *   npx tsx src/scripts/trackStrategy.ts <STRATEGY_NAME>
 *   Example: npx tsx src/scripts/trackStrategy.ts ETH27Mar
 *
 * @usage Module
 *   import { trackStrategy, StrategyTrackingResult } from "./trackStrategy.js";
 *   const result = await trackStrategy("ETH27Mar");
 *
 * @exports
 *   - trackStrategy(strategyName): Fetches all strategy data, returns StrategyTrackingResult
 *   - StrategyTrackingResult: Interface with all tracking data
 *
 * @environment
 *   - PRIVATE_KEY: For Boros wallet operations
 *   - HYPERLIQUID_SUBACCOUNT: For Hyperliquid subaccount queries
 *   - OKX_API_KEY, OKX_SECRET_KEY, OKX_API_PASSPHRASE: For OKX API
 *   - BOROS_ACCOUNT_ID (optional): Boros account ID, defaults to 0
 *   - BOROS_RPC_URL (optional): Arbitrum RPC URL
 *
 * @see openPosition.ts for opening strategy positions
 * @see src/config/strategies.ts for strategy definitions
 */

import axios from "axios";
import crypto from "crypto";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { Exchange, setEnv } from "@pendle/sdk-boros";
import "dotenv/config";

import { getStrategy, listStrategies, Strategy } from "../config/strategies.js";

/** Default Arbitrum RPC URL */
const DEFAULT_RPC_URL = "https://arb1.arbitrum.io/rpc";

/** OKX API base URL */
const OKX_BASE_URL = "https://www.okx.com";

/** Initial balances for real PnL calculation */
const INITIAL_BALANCES = {
  borosEth: 0.0099478,
  okxUsdt: 43.31,
  hlUsdc: 48.36,
};

// ============================================================
// OKX Auth Helpers (reused from okxLong.ts)
// ============================================================

function getTimestamp(): string {
  return new Date().toISOString();
}

function sign(timestamp: string, method: string, path: string, body: string): string {
  const secretKey = process.env.OKX_SECRET_KEY!;
  const preHash = timestamp + method + path + body;
  return crypto.createHmac("sha256", secretKey).update(preHash).digest("base64");
}

function getAuthHeaders(method: string, path: string, body: string = ""): Record<string, string> {
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
// Data Types
// ============================================================

interface HyperliquidData {
  balance: number;
  position: {
    size: number;
    entryPrice: number;
    unrealizedPnl: number;
    liquidationPrice: number | null;
  } | null;
}

interface OkxData {
  balance: number;
  position: {
    size: number;
    entryPrice: number;
    unrealizedPnl: number;
    liquidationPrice: number | null;
  } | null;
}

interface BorosPositionData {
  size: number;
  entryApr: number;
  markApr: number;
  unrealizedPnl: number;
  liquidationApr: number | null;
}

interface BorosData {
  ethBalance: number;
  crossMarginNetBalance: number;
  longPosition: BorosPositionData | null;
  shortPosition: BorosPositionData | null;
}

interface FetchResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** Result of tracking a strategy */
export interface StrategyTrackingResult {
  strategyName: string;
  timestamp: Date;
  ethPrice: number;
  impliedApr: {
    long: number;
    short: number;
  };
  liquidations: {
    hlShort: number | null;
    okxLong: number | null;
    borosLong: number | null;
    borosShort: number | null;
  };
  balances: {
    initialUsd: number;
    initialEth: number;
    currentUsd: number;
    currentEth: number;
    initialTotalUsd: number;
    currentTotalUsd: number;
  };
  realPnlUsd: number;
  errors: string[];
}

// ============================================================
// Data Fetching Functions
// ============================================================

async function fetchEthPrice(): Promise<FetchResult<number>> {
  try {
    const resp = await axios.get(`${OKX_BASE_URL}/api/v5/market/ticker`, {
      params: { instId: "ETH-USDT-SWAP" },
      timeout: 15000,
    });
    if (resp.data.code !== "0" || !resp.data.data?.[0]) {
      return { success: false, error: "Failed to get ETH price" };
    }
    return { success: true, data: parseFloat(resp.data.data[0].last) };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchHyperliquidData(ticker: string): Promise<FetchResult<HyperliquidData>> {
  const subaccountAddress = process.env.HYPERLIQUID_SUBACCOUNT;
  if (!subaccountAddress) {
    return { success: false, error: "HYPERLIQUID_SUBACCOUNT not set" };
  }

  try {
    const transport = new HttpTransport();
    const info = new InfoClient({ transport });
    const state = await info.clearinghouseState({ user: subaccountAddress as `0x${string}` });

    const balance = parseFloat(state.crossMarginSummary.accountValue);

    const assetPosition = state.assetPositions.find(
      (ap) => ap.position.coin.toUpperCase() === ticker.toUpperCase()
    );

    let position: HyperliquidData["position"] = null;
    if (assetPosition) {
      const pos = assetPosition.position;
      position = {
        size: parseFloat(pos.szi),
        entryPrice: parseFloat(pos.entryPx),
        unrealizedPnl: parseFloat(pos.unrealizedPnl),
        liquidationPrice: pos.liquidationPx ? parseFloat(pos.liquidationPx) : null,
      };
    }

    return { success: true, data: { balance, position } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchOkxData(ticker: string): Promise<FetchResult<OkxData>> {
  if (!process.env.OKX_API_KEY || !process.env.OKX_SECRET_KEY || !process.env.OKX_API_PASSPHRASE) {
    return { success: false, error: "OKX credentials not set" };
  }

  try {
    const balancePath = "/api/v5/account/balance";
    const balanceResp = await axios.get(`${OKX_BASE_URL}${balancePath}`, {
      headers: getAuthHeaders("GET", balancePath),
      timeout: 15000,
    });

    let balance = 0;
    if (balanceResp.data.code === "0" && balanceResp.data.data?.[0]?.details) {
      const usdtDetail = balanceResp.data.data[0].details.find(
        (d: { ccy: string }) => d.ccy === "USDT"
      );
      if (usdtDetail) {
        balance = parseFloat(usdtDetail.eq || usdtDetail.cashBal || "0");
      }
    }

    const instId = `${ticker.toUpperCase()}-USDT-SWAP`;
    const posPath = `/api/v5/account/positions?instType=SWAP&instId=${instId}`;
    const posResp = await axios.get(`${OKX_BASE_URL}${posPath}`, {
      headers: getAuthHeaders("GET", posPath),
      timeout: 15000,
    });

    let position: OkxData["position"] = null;
    if (posResp.data.code === "0" && posResp.data.data?.length > 0) {
      const pos = posResp.data.data[0];
      const contracts = parseFloat(pos.pos || "0");
      const ctVal = parseFloat(pos.ctVal || "0.01");
      const size = contracts * ctVal;

      if (size !== 0) {
        position = {
          size,
          entryPrice: parseFloat(pos.avgPx || "0"),
          unrealizedPnl: parseFloat(pos.upl || "0"),
          liquidationPrice: pos.liqPx ? parseFloat(pos.liqPx) : null,
        };
      }
    }

    return { success: true, data: { balance, position } };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchBorosData(strategy: Strategy): Promise<FetchResult<BorosData>> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    return { success: false, error: "PRIVATE_KEY not set" };
  }

  try {
    const accountId = parseInt(process.env.BOROS_ACCOUNT_ID || "0", 10);
    const rpcUrl = process.env.BOROS_RPC_URL || DEFAULT_RPC_URL;

    setEnv("production");

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const walletClient = createWalletClient({
      transport: http(rpcUrl),
      chain: arbitrum,
      account,
    });

    const exchange = new Exchange(walletClient, account.address, accountId, [rpcUrl]);

    const collaterals = await exchange.getCollaterals({
      userAddress: account.address,
      accountId,
    });

    let ethBalance = 0;
    let crossMarginNetBalance = 0;
    if (collaterals?.collaterals) {
      const activeCollateral = collaterals.collaterals.find(
        (c) => c.crossPosition?.marketPositions?.length > 0
      );
      if (activeCollateral) {
        ethBalance = parseFloat(activeCollateral.totalNetBalance || "0") / 1e18;
        crossMarginNetBalance = parseFloat(activeCollateral.crossPosition?.netBalance || "0") / 1e18;
      }
    }

    let longPosition: BorosPositionData | null = null;
    let shortPosition: BorosPositionData | null = null;

    if (collaterals?.collaterals) {
      const activeCollateral = collaterals.collaterals.find(
        (c) => c.crossPosition?.marketPositions?.length > 0
      );
      if (activeCollateral?.crossPosition?.marketPositions) {
        for (const mp of activeCollateral.crossPosition.marketPositions) {
          const size = parseFloat(mp.notionalSize || "0");
          if (size === 0) continue;

          const posData: BorosPositionData = {
            size: Math.abs(size) / 1e18,
            entryApr: mp.fixedApr || 0,
            markApr: mp.markApr || 0,
            unrealizedPnl: parseFloat(mp.pnl?.unrealisedPnl || "0") / 1e18,
            liquidationApr: mp.liquidationApr ?? null,
          };

          if (mp.marketId === strategy.borosLongMarketId && mp.side === 0) {
            longPosition = posData;
          } else if (mp.marketId === strategy.borosShortMarketId && mp.side === 1) {
            shortPosition = posData;
          }
        }
      }
    }

    return {
      success: true,
      data: { ethBalance, crossMarginNetBalance, longPosition, shortPosition },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// Main Tracking Function (exported)
// ============================================================

/**
 * Tracks a strategy and returns all relevant data
 * @param strategyName - Name of the strategy to track
 * @returns StrategyTrackingResult with all tracking data
 */
export async function trackStrategy(strategyName: string): Promise<StrategyTrackingResult> {
  const strategy = getStrategy(strategyName);
  if (!strategy) {
    throw new Error(`Strategy "${strategyName}" not found. Available: ${listStrategies().join(", ")}`);
  }

  const errors: string[] = [];

  // Fetch all data in parallel
  const results = await Promise.allSettled([
    fetchEthPrice(),
    fetchHyperliquidData(strategy.ticker),
    fetchOkxData(strategy.ticker),
    fetchBorosData(strategy),
  ]);

  const ethPriceResult: FetchResult<number> =
    results[0].status === "fulfilled" ? results[0].value : { success: false, error: "Fetch failed" };
  const hlData: FetchResult<HyperliquidData> =
    results[1].status === "fulfilled" ? results[1].value : { success: false, error: "Fetch failed" };
  const okxData: FetchResult<OkxData> =
    results[2].status === "fulfilled" ? results[2].value : { success: false, error: "Fetch failed" };
  const borosData: FetchResult<BorosData> =
    results[3].status === "fulfilled" ? results[3].value : { success: false, error: "Fetch failed" };

  if (!ethPriceResult.success) errors.push(`ETH price: ${ethPriceResult.error}`);
  if (!hlData.success) errors.push(`Hyperliquid: ${hlData.error}`);
  if (!okxData.success) errors.push(`OKX: ${okxData.error}`);
  if (!borosData.success) errors.push(`Boros: ${borosData.error}`);

  const ethPrice = ethPriceResult.success && ethPriceResult.data ? ethPriceResult.data : 0;

  // Calculate balances
  const hlBalance = hlData.success && hlData.data ? hlData.data.balance : 0;
  const okxBalance = okxData.success && okxData.data ? okxData.data.balance : 0;
  const borosCrossBalance = borosData.success && borosData.data ? borosData.data.crossMarginNetBalance : 0;

  const currentUsd = hlBalance + okxBalance;
  const currentEth = borosCrossBalance;
  const currentTotalUsd = currentUsd + (currentEth * ethPrice);

  const initialUsd = INITIAL_BALANCES.hlUsdc + INITIAL_BALANCES.okxUsdt;
  const initialEth = INITIAL_BALANCES.borosEth;
  const initialTotalUsd = initialUsd + (initialEth * ethPrice);

  // Real PnL
  const dUsd = currentUsd - initialUsd;
  const dEth = currentEth - initialEth;
  const realPnlUsd = dUsd + (dEth * ethPrice);

  return {
    strategyName,
    timestamp: new Date(),
    ethPrice,
    impliedApr: {
      long: borosData.success && borosData.data?.longPosition?.markApr || 0,
      short: borosData.success && borosData.data?.shortPosition?.markApr || 0,
    },
    liquidations: {
      hlShort: hlData.success && hlData.data?.position?.liquidationPrice || null,
      okxLong: okxData.success && okxData.data?.position?.liquidationPrice || null,
      borosLong: borosData.success && borosData.data?.longPosition?.liquidationApr || null,
      borosShort: borosData.success && borosData.data?.shortPosition?.liquidationApr || null,
    },
    balances: {
      initialUsd,
      initialEth,
      currentUsd,
      currentEth,
      initialTotalUsd,
      currentTotalUsd,
    },
    realPnlUsd,
    errors,
  };
}

// ============================================================
// Formatting Helpers
// ============================================================

function formatUsd(value: number): string {
  const sign = value >= 0 ? "" : "-";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

function formatEth(value: number): string {
  return `${value.toFixed(5)} ETH`;
}

function formatApr(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatPnl(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatUsd(value)}`;
}

function formatPrice(value: number | null): string {
  if (value === null) return "N/A";
  return formatUsd(value);
}

// ============================================================
// Display Function (for CLI)
// ============================================================

function displayResults(result: StrategyTrackingResult): void {
  const separator = "=".repeat(50);

  console.log("");
  console.log(separator);
  console.log(`STRATEGY: ${result.strategyName}`);
  console.log(separator);

  // ETH Price and Implied APRs
  console.log(`ETH Price:       ${formatUsd(result.ethPrice)}`);
  console.log(`Implied APR:     Long ${formatApr(result.impliedApr.long)} | Short ${formatApr(result.impliedApr.short)}`);
  console.log("");

  // Liquidation Prices/APRs
  console.log("LIQUIDATIONS");
  console.log(separator);
  console.log(`HL SHORT:        ${formatPrice(result.liquidations.hlShort)}`);
  console.log(`OKX LONG:        ${formatPrice(result.liquidations.okxLong)}`);
  console.log(`Boros LONG:      ${result.liquidations.borosLong !== null ? formatApr(result.liquidations.borosLong) : "N/A"}`);
  console.log(`Boros SHORT:     ${result.liquidations.borosShort !== null ? formatApr(result.liquidations.borosShort) : "N/A"}`);
  console.log("");

  // Balances
  console.log("BALANCES");
  console.log(separator);
  console.log(`Initial:         ${formatUsd(result.balances.initialUsd)} + ${formatEth(result.balances.initialEth)}`);
  console.log(`Current:         ${formatUsd(result.balances.currentUsd)} + ${formatEth(result.balances.currentEth)}`);
  console.log("");
  console.log(`Initial Total:   ${formatUsd(result.balances.initialTotalUsd)}`);
  console.log(`Current Total:   ${formatUsd(result.balances.currentTotalUsd)}`);
  console.log(separator);
  console.log(`REAL PnL:        ${formatPnl(result.realPnlUsd)}`);
  console.log(separator);

  if (result.errors.length > 0) {
    console.log("");
    console.log("ERRORS:");
    result.errors.forEach((e) => console.log(`  - ${e}`));
  }
}

// ============================================================
// Main (CLI)
// ============================================================

async function main() {
  const [strategyName] = process.argv.slice(2);

  if (!strategyName) {
    console.error("Usage: npx tsx src/scripts/trackStrategy.ts <STRATEGY_NAME>");
    console.error(`Example: npx tsx src/scripts/trackStrategy.ts ETH27Mar`);
    console.error("");
    console.error(`Available strategies: ${listStrategies().join(", ")}`);
    process.exit(1);
  }

  console.log(`Fetching data for strategy: ${strategyName}...`);

  const result = await trackStrategy(strategyName);
  displayResults(result);
}

// Only run main() when executed directly, not when imported
import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
