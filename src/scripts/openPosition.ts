/**
 * @file openPosition.ts
 * @description Opens a full 4-legged strategy position across DEXes and Boros.
 *
 * @usage
 *   npx tsx src/scripts/openPosition.ts <STRATEGY_NAME> <SIZE>
 *   Example: npx tsx src/scripts/openPosition.ts ETH27Mar 0.01
 *
 * @strategies
 *   Strategies are defined in src/config/strategies.ts. Each strategy specifies:
 *   - ticker: Underlying asset (e.g., "ETH")
 *   - shortDex: Exchange for short perp (HL or OKX)
 *   - longDex: Exchange for long perp (HL or OKX)
 *   - borosLongMarketId: Boros market ID for long YU
 *   - borosShortMarketId: Boros market ID for short YU
 *
 *   Available strategies:
 *   - ETH27Mar: ETH with HL short, OKX long, Boros markets 40/41
 *
 * @behavior
 *   1. Looks up strategy configuration by name
 *   2. Creates a shared Boros agent for both YU positions
 *   3. Opens 4 positions in parallel:
 *      - Leg 1: Short perp on shortDex (Hyperliquid)
 *      - Leg 2: Long perp on longDex (OKX)
 *      - Leg 3: Long YU on Boros (using shared agent)
 *      - Leg 4: Short YU on Boros (using shared agent)
 *   4. Reports results for all legs with detailed summary
 *
 * @environment
 *   Requires all environment variables from the individual scripts:
 *   - PRIVATE_KEY: For Hyperliquid and Boros
 *   - HYPERLIQUID_SUBACCOUNT: For Hyperliquid
 *   - OKX_API_KEY, OKX_SECRET_KEY, OKX_API_PASSPHRASE: For OKX
 *   - BOROS_ACCOUNT_ID (optional): For Boros
 *   - BOROS_RPC_URL (optional): For Boros
 *
 * @notes
 *   - All legs share the same SIZE parameter
 *   - Legs execute in parallel (Promise.all) for faster execution
 *   - Boros agent is created once and reused for both YU positions
 *   - No automatic rollback - if one leg fails, others still execute
 *   - Currently supports: HL for short DEX, OKX for long DEX
 *   - Exit code 1 if any leg fails
 *
 * @see src/config/strategies.ts for strategy definitions
 * @see hyperliquidShort.ts for Hyperliquid implementation
 * @see okxLong.ts for OKX implementation
 * @see borosTrade.ts for Boros implementation
 */

import "dotenv/config";
import { getStrategy, listStrategies } from "../config/strategies.js";
import { openHyperliquidShort, HyperliquidOrderResult } from "./hyperliquidShort.js";
import { openOkxLong, OkxOrderResult } from "./okxLong.js";
import { executeBoros, BorosOrderResult, createBorosAgent } from "./borosTrade.js";

interface StrategyResult {
  strategy: string;
  size: number;
  legs: {
    dexShort: HyperliquidOrderResult | null;
    dexLong: OkxOrderResult | null;
    borosLong: BorosOrderResult | null;
    borosShort: BorosOrderResult | null;
  };
  errors: string[];
  allSucceeded: boolean;
}

async function openPosition(strategyName: string, size: number): Promise<StrategyResult> {
  const strategy = getStrategy(strategyName);
  if (!strategy) {
    throw new Error(
      `Strategy "${strategyName}" not found. Available: ${listStrategies().join(", ")}`
    );
  }

  console.log("=".repeat(60));
  console.log(`Opening 4-legged position for strategy: ${strategy.name}`);
  console.log(`  Ticker: ${strategy.ticker}`);
  console.log(`  Size: ${size}`);
  console.log(`  Short DEX: ${strategy.shortDex}`);
  console.log(`  Long DEX: ${strategy.longDex}`);
  console.log(`  Boros Long Market: ${strategy.borosLongMarketId}`);
  console.log(`  Boros Short Market: ${strategy.borosShortMarketId}`);
  console.log("=".repeat(60));
  console.log("");

  const result: StrategyResult = {
    strategy: strategyName,
    size,
    legs: {
      dexShort: null,
      dexLong: null,
      borosLong: null,
      borosShort: null,
    },
    errors: [],
    allSucceeded: false,
  };

  // Create Boros agent once for both Boros legs
  console.log("Preparing Boros agent for YU positions...");
  const borosAgent = await createBorosAgent();
  console.log("");

  // Build leg execution promises
  const legPromises: Promise<void>[] = [];

  // DEX Short leg
  if (strategy.shortDex === "HL") {
    legPromises.push(
      (async () => {
        console.log(`\n[Leg 1] Opening Hyperliquid SHORT...`);
        try {
          result.legs.dexShort = await openHyperliquidShort(strategy.ticker, size);
          if (!result.legs.dexShort.success) {
            result.errors.push(`DEX Short (HL): ${result.legs.dexShort.error}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`DEX Short (HL): ${msg}`);
        }
      })()
    );
  } else {
    // OKX short not implemented yet
    result.errors.push(`DEX Short: OKX short not yet supported`);
  }

  // DEX Long leg
  if (strategy.longDex === "OKX") {
    legPromises.push(
      (async () => {
        console.log(`\n[Leg 2] Opening OKX LONG...`);
        try {
          result.legs.dexLong = await openOkxLong(strategy.ticker, size);
          if (!result.legs.dexLong.success) {
            result.errors.push(`DEX Long (OKX): ${result.legs.dexLong.error}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result.errors.push(`DEX Long (OKX): ${msg}`);
        }
      })()
    );
  } else {
    // HL long not implemented yet
    result.errors.push(`DEX Long: HL long not yet supported`);
  }

  // Boros Long YU leg
  legPromises.push(
    (async () => {
      console.log(`\n[Leg 3] Opening Boros LONG YU (market ${strategy.borosLongMarketId})...`);
      try {
        result.legs.borosLong = await executeBoros("long", strategy.borosLongMarketId, size, { agent: borosAgent });
        if (!result.legs.borosLong.success) {
          result.errors.push(`Boros Long: ${result.legs.borosLong.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Boros Long: ${msg}`);
      }
    })()
  );

  // Boros Short YU leg
  legPromises.push(
    (async () => {
      console.log(`\n[Leg 4] Opening Boros SHORT YU (market ${strategy.borosShortMarketId})...`);
      try {
        result.legs.borosShort = await executeBoros("short", strategy.borosShortMarketId, size, { agent: borosAgent });
        if (!result.legs.borosShort.success) {
          result.errors.push(`Boros Short: ${result.legs.borosShort.error}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Boros Short: ${msg}`);
      }
    })()
  );

  // Execute all legs in parallel
  await Promise.all(legPromises);

  // Check if all succeeded
  result.allSucceeded = result.errors.length === 0;

  return result;
}

function printSummary(result: StrategyResult): void {
  console.log("\n");
  console.log("=".repeat(60));
  console.log("STRATEGY EXECUTION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Strategy: ${result.strategy}`);
  console.log(`Size: ${result.size}`);
  console.log("");

  // DEX Short
  console.log("Leg 1 - DEX Short:");
  if (result.legs.dexShort) {
    console.log(`  Status: ${result.legs.dexShort.success ? "SUCCESS" : "FAILED"}`);
    if (result.legs.dexShort.success) {
      console.log(`  Filled: ${result.legs.dexShort.filledSize} @ $${result.legs.dexShort.avgPrice}`);
    } else {
      console.log(`  Error: ${result.legs.dexShort.error}`);
    }
  } else {
    console.log(`  Status: NOT EXECUTED`);
  }

  // DEX Long
  console.log("\nLeg 2 - DEX Long:");
  if (result.legs.dexLong) {
    console.log(`  Status: ${result.legs.dexLong.success ? "SUCCESS" : "FAILED"}`);
    if (result.legs.dexLong.success) {
      console.log(`  Order ID: ${result.legs.dexLong.orderId}`);
      console.log(`  Size: ${result.legs.dexLong.assetSize} (${result.legs.dexLong.contracts} contracts)`);
    } else {
      console.log(`  Error: ${result.legs.dexLong.error}`);
    }
  } else {
    console.log(`  Status: NOT EXECUTED`);
  }

  // Boros Long
  console.log("\nLeg 3 - Boros Long YU:");
  if (result.legs.borosLong) {
    console.log(`  Status: ${result.legs.borosLong.success ? "SUCCESS" : "FAILED"}`);
    if (result.legs.borosLong.success) {
      console.log(`  Tx Hash: ${result.legs.borosLong.txHash}`);
      if (result.legs.borosLong.filledSize) {
        console.log(`  Filled: ${result.legs.borosLong.filledSize.toFixed(4)} YU`);
      }
    } else {
      console.log(`  Error: ${result.legs.borosLong.error}`);
    }
  } else {
    console.log(`  Status: NOT EXECUTED`);
  }

  // Boros Short
  console.log("\nLeg 4 - Boros Short YU:");
  if (result.legs.borosShort) {
    console.log(`  Status: ${result.legs.borosShort.success ? "SUCCESS" : "FAILED"}`);
    if (result.legs.borosShort.success) {
      console.log(`  Tx Hash: ${result.legs.borosShort.txHash}`);
      if (result.legs.borosShort.filledSize) {
        console.log(`  Filled: ${result.legs.borosShort.filledSize.toFixed(4)} YU`);
      }
    } else {
      console.log(`  Error: ${result.legs.borosShort.error}`);
    }
  } else {
    console.log(`  Status: NOT EXECUTED`);
  }

  console.log("");
  console.log("=".repeat(60));
  if (result.allSucceeded) {
    console.log("ALL LEGS EXECUTED SUCCESSFULLY");
  } else {
    console.log("SOME LEGS FAILED:");
    result.errors.forEach((err) => console.log(`  - ${err}`));
  }
  console.log("=".repeat(60));
}

async function main() {
  const [strategyName, sizeStr] = process.argv.slice(2);

  if (!strategyName || !sizeStr) {
    console.error("Usage: npx tsx src/scripts/openPosition.ts <STRATEGY_NAME> <SIZE>");
    console.error(`Example: npx tsx src/scripts/openPosition.ts ETH27Mar 0.01`);
    console.error("");
    console.error(`Available strategies: ${listStrategies().join(", ")}`);
    process.exit(1);
  }

  const size = parseFloat(sizeStr);
  if (isNaN(size) || size <= 0) {
    console.error("Size must be a positive number");
    process.exit(1);
  }

  const result = await openPosition(strategyName, size);
  printSummary(result);

  if (!result.allSucceeded) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
