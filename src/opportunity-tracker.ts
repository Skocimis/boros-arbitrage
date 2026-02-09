/**
 * @file opportunity-tracker.ts
 * @description Periodically fetches VWAP APY for ETH27Mar strategy and logs to CSV.
 *
 * @usage
 *   npm run opportunities
 *
 * @behavior
 *   - Runs getApyData("ETH27Mar", 0.5) every 5 minutes
 *   - Appends timestamp and realistic APY to data/opportunities.csv
 *   - Creates data directory and CSV file if they don't exist
 */

import fs from "fs";
import path from "path";
import { getApyData } from "./scripts/getAPY.js";
import "dotenv/config";

const STRATEGY_NAME = "ETH27Mar";
const SIZE = 0.63;
const INTERVAL_MS = 5 * 60 * 1000;

const DATA_DIR = path.join(process.cwd(), "data");
const CSV_FILE = path.join(DATA_DIR, "opportunities.csv");

function ensureCsvExists(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`Created directory: ${DATA_DIR}`);
  }
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, "timestamp,realisticApy\n");
    console.log(`Created CSV file: ${CSV_FILE}`);
  }
}

function appendToCsv(timestamp: Date, realisticApy: number): void {
  const row = `${timestamp.toISOString()},${(realisticApy * 100).toFixed(4)}\n`;
  fs.appendFileSync(CSV_FILE, row);
}

async function runTracking(): Promise<void> {
  const now = new Date();
  try {
    const result = await getApyData(STRATEGY_NAME, SIZE);
    appendToCsv(result.timestamp, result.realisticApy);
    console.log(
      `[${now.toISOString()}] Realistic APY: ${(result.realisticApy * 100).toFixed(4)}% - saved to ${CSV_FILE}`
    );
  } catch (err) {
    console.error(
      `[${now.toISOString()}] Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function main(): Promise<void> {
  const sep = "=".repeat(50);
  console.log(sep);
  console.log("Opportunity Tracker");
  console.log(sep);
  console.log(`Strategy:  ${STRATEGY_NAME}`);
  console.log(`Size:      ${SIZE}`);
  console.log(`Interval:  ${INTERVAL_MS / 1000 / 60} minutes`);
  console.log(`CSV File:  ${CSV_FILE}`);
  console.log(sep);

  ensureCsvExists();
  await runTracking();
  setInterval(runTracking, INTERVAL_MS);
  console.log(`\nTracker running. Press Ctrl+C to stop.`);
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
