/**
 * @file okxLong.ts
 * @description CLI script to open a long position on OKX perpetual swaps.
 *
 * @usage
 *   npx tsx src/scripts/okxLong.ts <TICKER> <SIZE>
 *   Example: npx tsx src/scripts/okxLong.ts ETH 0.1
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
 *   1. Parses CLI arguments (ticker symbol and position size in base asset, e.g., ETH)
 *   2. Validates required environment variables
 *   3. Builds instrument ID in OKX format: {TICKER}-USDT-SWAP
 *   4. Fetches instrument info to get contract value and convert size to contracts
 *   5. Fetches current market price from OKX
 *   6. Places market buy order for immediate execution
 *   7. Reports order status (success or error)
 *
 * @notes
 *   - Uses market order type for immediate execution
 *   - Cross-margin mode by default
 *   - Size is in base asset (e.g., ETH), automatically converted to contracts
 *   - OKX API requires HMAC-SHA256 signature with Base64 encoding
 *
 * @see hyperliquidShort.ts for the Hyperliquid equivalent
 * @see setOkxLeverage.ts for configuring leverage before trading (not yet implemented)
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

  // Build OKX instrument ID: TICKER-USDT-SWAP
  const instId = `${ticker.toUpperCase()}-USDT-SWAP`;

  // Get instrument info (lot size, min size, contract value)
  const instData = await getInstrument(instId);
  if (instData.code !== "0") {
    console.error(`Failed to get instrument info: ${instData.msg}`);
    process.exit(1);
  }

  if (!instData.data || instData.data.length === 0) {
    console.error(`Instrument ${instId} not found`);
    process.exit(1);
  }

  const instrument = instData.data[0];
  const lotSz = parseFloat(instrument.lotSz);
  const minSz = parseFloat(instrument.minSz);
  const ctVal = parseFloat(instrument.ctVal);

  // Convert asset size to contracts
  // e.g., 0.1 ETH / 0.01 ctVal = 10 contracts
  const contractsRaw = assetSize / ctVal;

  // Validate size against minimum
  const minAssetSize = minSz * ctVal;
  if (assetSize < minAssetSize) {
    console.error(`Size ${assetSize} ${ticker.toUpperCase()} is below minimum ${minAssetSize} ${ticker.toUpperCase()}`);
    console.error(`  Contract value: ${ctVal} ${ticker.toUpperCase()}`);
    console.error(`  Minimum contracts: ${minSz}`);
    process.exit(1);
  }

  // Round contracts to nearest lot size (using Math.round to avoid floating point precision issues)
  const roundedContracts = Math.round(contractsRaw / lotSz) * lotSz;
  const actualAssetSize = roundedContracts * ctVal;

  // Use tolerance for comparison to handle floating point precision
  if (Math.abs(actualAssetSize - assetSize) > 1e-9) {
    console.log(`Note: Size rounded from ${assetSize} to ${actualAssetSize} ${ticker.toUpperCase()} (${roundedContracts} contracts)`);
  }

  if (roundedContracts < minSz) {
    console.error(`Rounded size ${roundedContracts} contracts is below minimum ${minSz}`);
    process.exit(1);
  }

  // Get current price
  const tickerData = await getTicker(instId);
  if (tickerData.code !== "0") {
    console.error(`Failed to get ticker: ${tickerData.msg}`);
    process.exit(1);
  }

  if (!tickerData.data || tickerData.data.length === 0) {
    console.error(`No ticker data for ${instId}`);
    process.exit(1);
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

  console.log("\nResult:", JSON.stringify(result, null, 2));

  if (result.code === "0" && result.data && result.data.length > 0) {
    const orderResult = result.data[0];
    if (orderResult.sCode === "0") {
      console.log(`\nOrder placed successfully!`);
      console.log(`  Order ID: ${orderResult.ordId}`);
    } else {
      console.error(`\nOrder failed: ${orderResult.sMsg}`);
      process.exit(1);
    }
  } else {
    console.error(`\nAPI error: ${result.msg}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
