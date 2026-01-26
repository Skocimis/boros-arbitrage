/**
 * @file index.ts
 * @description Demo script showing the four-leg Yield Unit (YU) arbitrage calculation.
 *   Fetches live funding rates (Underlying APR) from Binance and Hyperliquid,
 *   combines with Boros Implied APRs to demonstrate delta-neutral arbitrage strategy.
 *
 * @usage
 *   npm run dev
 *   npx tsx src/index.ts
 *
 * @dependencies
 *   - axios: HTTP client for Boros API calls
 *   - dotenv: Environment variable management
 *   - BinanceClient: Fetches Binance perpetual funding rates (Underlying APR)
 *   - HyperliquidClient: Fetches Hyperliquid perpetual funding rates (Underlying APR)
 *
 * @environment
 *   - BINANCE_API_KEY: Binance API key (required for funding rate fetch)
 *   - BINANCE_API_SECRET: Binance API secret (required)
 *
 * @behavior
 *   1. Initializes Binance and Hyperliquid clients
 *   2. Fetches ETH funding rates (Underlying APR) from both exchanges (annualized)
 *   3. Fetches Boros market Implied APRs for ETH markets (IDs 29, 31, 33)
 *   4. Calculates four-leg strategy breakdown:
 *      - Short HL Perp: Receive floating funding (Underlying APR)
 *      - Short HL YU on Boros: Pay floating, receive fixed (Implied APR)
 *      - Long Binance Perp: Pay floating funding (Underlying APR)
 *      - Long Binance YU on Boros: Receive floating, pay fixed (Implied APR)
 *   5. Demonstrates that floating rates cancel, leaving net fixed APY
 *      Net APY = High Implied APR - Low Implied APR
 *
 * @notes
 *   - This is a calculation demo, not an execution script
 *   - Funding rates are annualized: Binance (*3*365), Hyperliquid (*24*365)
 *   - The strategy is delta-neutral: long and short perp positions offset price risk
 *   - YU + Perp pairing cancels floating rate, leaving only fixed Implied APR
 *
 * @see src/scripts/ for actual execution scripts
 */

import "dotenv/config";
import axios from "axios";
import { BinanceClient } from "./lib/BinanceClient.js";
import { HyperliquidClient } from "./lib/HyperliquidClient.js";
import { Asset } from "./lib/DexClient.js";

// Initialize clients
const binance = new BinanceClient(
  process.env.BINANCE_API_KEY!,
  process.env.BINANCE_API_SECRET!
);
const hyperliquid = new HyperliquidClient("dummy-key");

// Fetch all data
const bnEthFunding = await binance.getFunding(Asset.ETH);
const hlEthFunding = await hyperliquid.getFunding(Asset.ETH);

const hlUsdcMarket = await axios.get(
  "https://api.boros.finance/core/v1/markets/33"
);
const hlEthMarket = await axios.get(
  "https://api.boros.finance/core/v1/markets/31"
);
const bnEthMarket = await axios.get(
  "https://api.boros.finance/core/v1/markets/29"
);

const hlUsdcApr = parseFloat(hlUsdcMarket.data.data?.midApr);
//const hlEthApr = parseFloat(hlEthMarket.data.data?.midApr);
const bnEthApr = parseFloat(bnEthMarket.data.data?.midApr);
const bcfunding = parseFloat((bnEthFunding * 100).toFixed(2)); // binance annualized funding in %
const hlfunding = parseFloat((hlEthFunding * 100).toFixed(2)); // hl annualized funding in %
const bcboros = parseFloat((bnEthApr * 100).toFixed(2)); // binance on boros
const hlboros = parseFloat((hlUsdcApr * 100).toFixed(2));
//const hlboros2 = parseFloat((hlEthApr * 100).toFixed(2));

// Calculate arbitrage strategy APY (full breakdown)
// Short HL perp: +hlFunding (receive)
// Short HL YU: -hlFunding (pay) + hlBoros (receive fixed)
// Long BN perp: -bnFunding (pay)
// Long BN YU: +bnFunding (receive) - bnBoros (pay fixed)
// Net = hlBoros - bnBoros (funding rates cancel out)
const strategyApy = hlboros - bcboros;

// Print results cleanly
console.log(`Binance ETHUSDT Funding (annualized):        ${bcfunding}%`);
console.log(`Hyperliquid ETH-USD Funding (annualized):    ${hlfunding}%`);
console.log(`Boros HL ETH-USD (USDC collateral) APR:      ${hlboros}%`);
console.log(`Boros Binance ETHUSDT (ETH collateral) APR:  ${bcboros}%`);
console.log(`\nStrategy Breakdown:`);
console.log(`  Short HL perp:     +${hlfunding}% (receive funding)`);
console.log(`  Short HL YU:       -${hlfunding}% (pay funding) +${hlboros}% (receive fixed)`);
console.log(`  Long BN perp:      -${bcfunding}% (pay funding)`);
console.log(`  Long BN YU:        +${bcfunding}% (receive funding) -${bcboros}% (pay fixed)`);
console.log(`  ─────────────────────────────────────────────────`);
console.log(`  Net Strategy APY:  ${strategyApy.toFixed(2)}% (fixed, delta-neutral)`);



