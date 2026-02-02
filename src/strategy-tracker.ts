/**
 * @file strategy-tracker.ts
 * @description Periodically tracks ETH27Mar strategy and logs PnL to CSV.
 *
 * @usage
 *   npx tsx src/strategy-tracker.ts
 *
 * @behavior
 *   - Runs trackStrategy("ETH27Mar") every 5 minutes
 *   - Appends timestamp and real PnL (3 decimals) to data/pnl.csv
 *   - Creates data directory and CSV file if they don't exist
 *   - Logs each tracking result to console
 *
 * @output
 *   CSV format: timestamp,realPnlUsd
 *   Example: 2024-01-15T10:30:00.000Z,-0.098
 */

import fs from "fs";
import path from "path";
import { trackStrategy } from "./scripts/trackStrategy.js";
import "dotenv/config";

/** Strategy to track */
const STRATEGY_NAME = "ETH27Mar";

/** Interval between tracking runs (5 minutes in ms) */
const INTERVAL_MS = 5 * 60 * 1000;

/** Path to CSV file */
const DATA_DIR = path.join(process.cwd(), "data");
const CSV_FILE = path.join(DATA_DIR, "pnl.csv");

/**
 * Ensures the data directory and CSV file exist
 */
function ensureCsvExists(): void {
  // Create data directory if it doesn't exist
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created directory: ${DATA_DIR}`);
  }

  // Create CSV file with header if it doesn't exist
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, "timestamp,realPnlUsd\n");
    console.log(`Created CSV file: ${CSV_FILE}`);
  }
}

/**
 * Appends a row to the CSV file
 */
function appendToCsv(timestamp: Date, realPnlUsd: number): void {
  const row = `${timestamp.toISOString()},${realPnlUsd.toFixed(3)}\n`;
  fs.appendFileSync(CSV_FILE, row);
}

/** Formatting helpers */
function formatUsd(value: number): string {
  const sign = value >= 0 ? "" : "-";
  return `${sign}$${Math.abs(value).toFixed(3)}`;
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

/**
 * Runs a single tracking iteration
 */
async function runTracking(): Promise<void> {
  const now = new Date();
  const separator = "=".repeat(50);

  try {
    const result = await trackStrategy(STRATEGY_NAME);

    // Log to CSV
    appendToCsv(result.timestamp, result.realPnlUsd);

    // Log to console
    console.log("");
    console.log(separator);
    console.log(`[${now.toISOString()}] ${STRATEGY_NAME}`);
    console.log(separator);

    // ETH Price and Implied APRs
    console.log(`ETH Price:       ${formatUsd(result.ethPrice)}`);
    console.log(`Implied APR:     Long ${formatApr(result.impliedApr.long)} | Short ${formatApr(result.impliedApr.short)}`);
    console.log("");

    // Liquidations
    console.log("LIQUIDATIONS");
    console.log(`  HL SHORT:      ${formatPrice(result.liquidations.hlShort)}`);
    console.log(`  OKX LONG:      ${formatPrice(result.liquidations.okxLong)}`);
    console.log(`  Boros LONG:    ${result.liquidations.borosLong !== null ? formatApr(result.liquidations.borosLong) : "N/A"}`);
    console.log(`  Boros SHORT:   ${result.liquidations.borosShort !== null ? formatApr(result.liquidations.borosShort) : "N/A"}`);
    console.log("");

    // Balances
    console.log("BALANCES");
    console.log(`  Initial:       ${formatUsd(result.balances.initialUsd)} + ${formatEth(result.balances.initialEth)}`);
    console.log(`  Current:       ${formatUsd(result.balances.currentUsd)} + ${formatEth(result.balances.currentEth)}`);
    console.log(`  Initial Total: ${formatUsd(result.balances.initialTotalUsd)}`);
    console.log(`  Current Total: ${formatUsd(result.balances.currentTotalUsd)}`);
    console.log(separator);
    console.log(`REAL PnL:        ${formatPnl(result.realPnlUsd)}`);
    console.log(separator);
    console.log(`Saved to: ${CSV_FILE}`);

    if (result.errors.length > 0) {
      console.log("");
      console.log("ERRORS:");
      result.errors.forEach((e) => console.log(`  - ${e}`));
    }
  } catch (err) {
    console.error(`\n[${now.toISOString()}] Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function runner(){
  await runTracking();
  setTimeout(runner, INTERVAL_MS);
}

/**
 * Main function - starts the tracking loop
 */
async function main(): Promise<void> {
  console.log("=".repeat(50));
  console.log("Strategy Tracker");
  console.log("=".repeat(50));
  console.log(`Strategy:  ${STRATEGY_NAME}`);
  console.log(`Interval:  ${INTERVAL_MS / 1000 / 60} minutes`);
  console.log(`CSV File:  ${CSV_FILE}`);
  console.log("=".repeat(50));

  // Ensure CSV exists
  ensureCsvExists();

  runner();

  console.log(`\nTracker running. Press Ctrl+C to stop.`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
