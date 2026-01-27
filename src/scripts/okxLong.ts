/**
 * @file okxLong.ts
 * @description Opens long positions on OKX perpetual swaps. Can be used as CLI or imported as module.
 *
 * @usage CLI
 *   npx tsx src/scripts/okxLong.ts <TICKER> <SIZE>
 *   Example: npx tsx src/scripts/okxLong.ts ETH 0.1
 *
 * @usage Module
 *   import { openOkxLong, OkxOrderResult } from "./okxLong.js";
 *   const result = await openOkxLong("ETH", 0.1);
 *
 * @exports
 *   - openOkxLong(ticker, size): Opens a long position, returns OkxOrderResult
 *   - OkxOrderResult: Interface for order result with success, orderId, contracts, etc.
 *
 * @dependencies
 *   - axios: HTTP client for OKX API requests
 *   - crypto: Node.js crypto for HMAC-SHA256 signing
 *   - dotenv: Environment variable management
 *
 * @environment
 *   - OKX_API_KEY: OKX API key (required)
 *   - OKX_SECRET_KEY: OKX API secret key (required)
 *   - OKX_API_PASSPHRASE: OKX API passphrase (required)
 *
 * @behavior
 *   1. Builds instrument ID in OKX format: {TICKER}-USDT-SWAP
 *   2. Fetches instrument info to get contract value and convert size to contracts
 *   3. Fetches current market price from OKX
 *   4. Places market buy order for immediate execution
 *   5. Returns result object with order status
 *
 * @notes
 *   - Uses market order type for immediate execution
 *   - Cross-margin mode by default
 *   - Size is in base asset (e.g., ETH), automatically converted to contracts
 *   - OKX API requires HMAC-SHA256 signature with Base64 encoding
 *
 * @see openPosition.ts for 4-legged strategy execution
 * @see hyperliquidShort.ts for the Hyperliquid equivalent
 */

import axios from "axios";
import crypto from "crypto";
import "dotenv/config";

/** OKX API base URL */
const BASE_URL = "https://www.okx.com";

/**
 * Generates ISO 8601 timestamp for OKX API authentication
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Creates HMAC-SHA256 signature for OKX API authentication
 * @param timestamp - ISO 8601 timestamp
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - Request path including query string
 * @param body - Request body (empty string for GET requests)
 */
function sign(
  timestamp: string,
  method: string,
  path: string,
  body: string
): string {
  const secretKey = process.env.OKX_SECRET_KEY!;
  const preHash = timestamp + method + path + body;
  return crypto.createHmac("sha256", secretKey).update(preHash).digest("base64");
}

/**
 * Builds authentication headers for OKX API requests
 * @param method - HTTP method
 * @param path - Request path including query string
 * @param body - Request body (empty string for GET requests)
 */
function getAuthHeaders(
  method: string,
  path: string,
  body: string = ""
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

/**
 * Fetches instrument info from OKX (lot size, min size, contract value)
 * @param instId - Instrument ID (e.g., "ETH-USDT-SWAP")
 */
async function getInstrument(instId: string): Promise<{
  code: string;
  msg: string;
  data: Array<{
    instId: string;
    lotSz: string;
    minSz: string;
    ctVal: string;
    ctMult: string;
    tickSz: string;
  }>;
}> {
  const { data } = await axios.get(`${BASE_URL}/api/v5/public/instruments`, {
    params: { instType: "SWAP", instId },
    timeout: 15000,
  });
  return data;
}

/**
 * Fetches current ticker data from OKX
 * @param instId - Instrument ID (e.g., "ETH-USDT-SWAP")
 */
async function getTicker(instId: string): Promise<{
  code: string;
  msg: string;
  data: Array<{
    instId: string;
    last: string;
    askPx: string;
    bidPx: string;
  }>;
}> {
  const { data } = await axios.get(`${BASE_URL}/api/v5/market/ticker`, {
    params: { instId },
    timeout: 15000,
  });
  return data;
}

/**
 * Places an order on OKX
 * @param instId - Instrument ID (e.g., "ETH-USDT-SWAP")
 * @param side - Order side ("buy" for long, "sell" for short)
 * @param sz - Size in contracts
 */
async function placeOrder(
  instId: string,
  side: string,
  sz: string
): Promise<{
  code: string;
  msg: string;
  data: Array<{
    ordId: string;
    clOrdId: string;
    sCode: string;
    sMsg: string;
  }>;
}> {
  const path = "/api/v5/trade/order";
  const body = JSON.stringify({
    instId,
    tdMode: "cross",
    side,
    ordType: "market",
    sz,
  });
  const headers = getAuthHeaders("POST", path, body);
  const { data } = await axios.post(`${BASE_URL}${path}`, body, {
    headers,
    timeout: 15000,
  });
  return data;
}

/** Result type for OKX order */
export interface OkxOrderResult {
  success: boolean;
  ticker: string;
  side: "long";
  orderId?: string;
  contracts?: number;
  assetSize?: number;
  price?: number;
  notionalValue?: number;
  error?: string;
  rawResult?: unknown;
}

/**
 * Opens a long position on OKX perpetual swaps
 * @param ticker - Asset ticker (e.g., "ETH")
 * @param size - Position size in base asset
 * @returns Order result
 */
export async function openOkxLong(
  ticker: string,
  size: number
): Promise<OkxOrderResult> {
  if (!process.env.OKX_API_KEY) {
    throw new Error("OKX_API_KEY not found in environment variables");
  }

  if (!process.env.OKX_SECRET_KEY) {
    throw new Error("OKX_SECRET_KEY not found in environment variables");
  }

  if (!process.env.OKX_API_PASSPHRASE) {
    throw new Error("OKX_API_PASSPHRASE not found in environment variables");
  }

  // Build OKX instrument ID: TICKER-USDT-SWAP
  const instId = `${ticker.toUpperCase()}-USDT-SWAP`;

  // Get instrument info (lot size, min size, contract value)
  const instData = await getInstrument(instId);
  if (instData.code !== "0") {
    throw new Error(`Failed to get instrument info: ${instData.msg}`);
  }

  if (!instData.data || instData.data.length === 0) {
    throw new Error(`Instrument ${instId} not found`);
  }

  const instrument = instData.data[0];
  const lotSz = parseFloat(instrument.lotSz);
  const minSz = parseFloat(instrument.minSz);
  const ctVal = parseFloat(instrument.ctVal);

  // Convert asset size to contracts
  const contractsRaw = size / ctVal;

  // Validate size against minimum
  const minAssetSize = minSz * ctVal;
  if (size < minAssetSize) {
    throw new Error(`Size ${size} ${ticker.toUpperCase()} is below minimum ${minAssetSize} ${ticker.toUpperCase()}`);
  }

  // Round contracts to nearest lot size
  const roundedContracts = Math.round(contractsRaw / lotSz) * lotSz;
  const actualAssetSize = roundedContracts * ctVal;

  if (Math.abs(actualAssetSize - size) > 1e-9) {
    console.log(`Note: Size rounded from ${size} to ${actualAssetSize} ${ticker.toUpperCase()} (${roundedContracts} contracts)`);
  }

  if (roundedContracts < minSz) {
    throw new Error(`Rounded size ${roundedContracts} contracts is below minimum ${minSz}`);
  }

  // Get current price
  const tickerData = await getTicker(instId);
  if (tickerData.code !== "0") {
    throw new Error(`Failed to get ticker: ${tickerData.msg}`);
  }

  if (!tickerData.data || tickerData.data.length === 0) {
    throw new Error(`No ticker data for ${instId}`);
  }

  const currentPrice = parseFloat(tickerData.data[0].last);
  const notionalValue = actualAssetSize * currentPrice;

  console.log(`Opening LONG position on OKX:`);
  console.log(`  Instrument: ${instId}`);
  console.log(`  Size: ${actualAssetSize} ${ticker.toUpperCase()} (${roundedContracts} contracts)`);
  console.log(`  Contract value: ${ctVal} ${ticker.toUpperCase()}/contract`);
  console.log(`  Current price: $${currentPrice}`);
  console.log(`  Notional value: ~$${notionalValue.toFixed(2)}`);
  console.log(`  Order type: Market`);
  console.log(`  Margin mode: Cross`);

  // Place market buy order
  const result = await placeOrder(instId, "buy", roundedContracts.toString());

  if (result.code === "0" && result.data && result.data.length > 0) {
    const orderResult = result.data[0];
    if (orderResult.sCode === "0") {
      console.log(`\nOKX: Order placed successfully!`);
      console.log(`  Order ID: ${orderResult.ordId}`);
      return {
        success: true,
        ticker,
        side: "long",
        orderId: orderResult.ordId,
        contracts: roundedContracts,
        assetSize: actualAssetSize,
        price: currentPrice,
        notionalValue,
        rawResult: result,
      };
    } else {
      console.error(`\nOKX: Order failed: ${orderResult.sMsg}`);
      return {
        success: false,
        ticker,
        side: "long",
        error: orderResult.sMsg,
        rawResult: result,
      };
    }
  } else {
    console.error(`\nOKX: API error: ${result.msg}`);
    return {
      success: false,
      ticker,
      side: "long",
      error: result.msg,
      rawResult: result,
    };
  }
}

async function main() {
  const [ticker, sizeStr] = process.argv.slice(2);

  if (!ticker || !sizeStr) {
    console.error("Usage: npx tsx src/scripts/okxLong.ts <TICKER> <SIZE>");
    console.error("Example: npx tsx src/scripts/okxLong.ts ETH 0.1");
    console.error("Note: SIZE is in base asset (e.g., 0.1 = 0.1 ETH)");
    process.exit(1);
  }

  const assetSize = parseFloat(sizeStr);
  if (isNaN(assetSize) || assetSize <= 0) {
    console.error("Size must be a positive number");
    process.exit(1);
  }

  const result = await openOkxLong(ticker, assetSize);
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
