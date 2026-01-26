/**
 * @file arbitrage-scanner.ts
 * @description One-shot scanner that finds all cross-exchange Yield Unit (YU) arbitrage
 *   opportunities in Boros markets. Compares Implied APRs across platforms for the same asset.
 *
 * @usage
 *   npm run scan
 *   npx tsx src/arbitrage-scanner.ts
 *
 * @dependencies
 *   - axios: HTTP client for Boros API calls
 *   - dotenv: Environment variable management
 *
 * @behavior
 *   1. Fetches all Boros markets from API
 *   2. Identifies pairs with the same base asset (BTC, ETH, BNB) on different platforms
 *   3. Calculates net APY = High Implied APR (short YU) - Low Implied APR (long YU)
 *   4. Outputs top 20 opportunities sorted by net APY descending
 *
 * @notes
 *   - Executes once and exits (no continuous monitoring)
 *   - Only shows opportunities with positive net APY (Implied APR spread)
 *   - Use arbitrage-monitor.ts for continuous tracking with TSI analysis
 *
 * @see arbitrage-monitor.ts for continuous monitoring with order book analysis
 */

import 'dotenv/config';
import axios from 'axios';

interface BorosMarket {
  marketId: number;
  metadata: {
    name: string;
    asset: string;
    platformName: string;
  };
  data: {
    midApr?: string;
    markApr?: string;
  };
}

interface ArbitrageOpportunity {
  longMarket: string;
  longMarketId: number;
  longApr: number;
  longPlatform: string;
  shortMarket: string;
  shortMarketId: number;
  shortApr: number;
  shortPlatform: string;
  netApy: number;
}

// Fetch all markets from Boros
async function getAllMarkets(): Promise<BorosMarket[]> {
  const response = await axios.get('https://api.boros.finance/core/v1/markets');
  return response.data.results || [];
}

// Extract APR from market data
function getApr(market: BorosMarket): number | null {
  const apr = market.data?.midApr || market.data?.markApr;
  return apr ? parseFloat(apr) : null;
}

// Extract base asset from market name (e.g., "ETHUSDT" -> "ETH", "BTC-USD" -> "BTC")
function getBaseAsset(marketName: string): string {
  // Handle formats like "ETH-USD", "BTC-USD"
  if (marketName.includes('-')) {
    return marketName.split('-')[0];
  }
  // Handle formats like "ETHUSDT", "BTCUSDT", "BNBUSDT"
  if (marketName.includes('USDT')) {
    return marketName.replace('USDT', '');
  }
  if (marketName.includes('USDC')) {
    return marketName.replace('USDC', '');
  }
  // Default: return as-is
  return marketName;
}

// Find all arbitrage opportunities
function findArbitrageOpportunities(markets: BorosMarket[]): ArbitrageOpportunity[] {
  const opportunities: ArbitrageOpportunity[] = [];

  // Compare every market pair
  for (let i = 0; i < markets.length; i++) {
    for (let j = i + 1; j < markets.length; j++) {
      const market1 = markets[i];
      const market2 = markets[j];

      // Extract base assets
      const asset1 = getBaseAsset(market1.metadata.name);
      const asset2 = getBaseAsset(market2.metadata.name);

      // Only compare markets with the same base asset (for delta-neutral arbitrage)
      if (asset1 !== asset2) continue;

      const apr1 = getApr(market1);
      const apr2 = getApr(market2);

      // Skip if APR data is missing
      if (apr1 === null || apr2 === null) continue;

      // Calculate net APY (always positive by taking absolute difference)
      if (apr1 > apr2) {
        opportunities.push({
          longMarket: market2.metadata.name,
          longMarketId: market2.marketId,
          longApr: apr2 * 100,
          longPlatform: market2.metadata.platformName,
          shortMarket: market1.metadata.name,
          shortMarketId: market1.marketId,
          shortApr: apr1 * 100,
          shortPlatform: market1.metadata.platformName,
          netApy: (apr1 - apr2) * 100,
        });
      } else if (apr2 > apr1) {
        opportunities.push({
          longMarket: market1.metadata.name,
          longMarketId: market1.marketId,
          longApr: apr1 * 100,
          longPlatform: market1.metadata.platformName,
          shortMarket: market2.metadata.name,
          shortMarketId: market2.marketId,
          shortApr: apr2 * 100,
          shortPlatform: market2.metadata.platformName,
          netApy: (apr2 - apr1) * 100,
        });
      }
    }
  }

  // Sort by net APY descending
  return opportunities.sort((a, b) => b.netApy - a.netApy);
}

// Main execution
console.log('Fetching all Boros markets...\n');

const markets = await getAllMarkets();
console.log(`Found ${markets.length} markets\n`);

const opportunities = findArbitrageOpportunities(markets);

console.log('='.repeat(80));
console.log('TOP ARBITRAGE OPPORTUNITIES (Sorted by Net APY)');
console.log('='.repeat(80));

opportunities.forEach((opp, index) => {
  if (index < 20) { // Show top 20
    console.log(`\n${index + 1}. Net APY: ${opp.netApy.toFixed(2)}%`);
    console.log(`   Short: ${opp.shortMarket} [${opp.shortPlatform}] (${opp.shortApr.toFixed(2)}%)`);
    console.log(`   Long:  ${opp.longMarket} [${opp.longPlatform}] (${opp.longApr.toFixed(2)}%)`);
  }
});

console.log(`\n${'='.repeat(80)}`);
console.log(`Total opportunities found: ${opportunities.length}`);
console.log(`Best opportunity: ${opportunities[0]?.netApy.toFixed(2)}%`);
