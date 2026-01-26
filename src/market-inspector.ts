/**
 * @file market-inspector.ts
 * @description CLI tool to inspect detailed information about specific Boros Yield Unit (YU) markets.
 *   Displays market name, platform, Implied APR, state, and expiry for given market IDs.
 *
 * @usage
 *   npx tsx src/market-inspector.ts <market_id_1> [market_id_2] ...
 *   Example: npx tsx src/market-inspector.ts 31 33 45
 *
 * @dependencies
 *   - axios: HTTP client for Boros API calls
 *
 * @behavior
 *   1. Parses market IDs from command line arguments
 *   2. Fetches market details from Boros API for each ID
 *   3. Displays formatted output with name, platform, Implied APR, state, expiry
 *   4. Warns if market state is not "Normal" (e.g., CloseOnly, Paused)
 *
 * @notes
 *   - Accepts multiple market IDs as space-separated arguments
 *   - Implied APR displayed as percentage (e.g., "8.45%")
 *   - Expiry shows both human-readable date and Unix timestamp
 *
 * @see lib/functions/getMarketById.ts for programmatic market fetching
 */
import axios from 'axios';

interface BorosMarket {
  marketId: number;
  metadata: {
    name: string;
    asset: string;
    platformName: string;
  };
  imData: {
    maturity: number;
  };
  data: {
    midApr?: string;
    markApr?: string;
  };
  state?: string;
}

async function getMarketDetails(marketId: number): Promise<BorosMarket | null> {
  try {
    const response = await axios.get('https://api.boros.finance/core/v1/markets');
    const markets: BorosMarket[] = response.data.results || [];
    return markets.find(m => m.marketId === marketId) || null;
  } catch (error) {
    console.error('Error fetching markets:', error);
    return null;
  }
}

function formatExpiry(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function inspectMarkets(marketIds: number[]) {
  console.log('Fetching market details from Boros API...\n');

  for (const id of marketIds) {
    const market = await getMarketDetails(id);

    if (!market) {
      console.log(`Market ID ${id}: NOT FOUND`);
      console.log('-'.repeat(80));
      continue;
    }

    const apr = market.data?.midApr || market.data?.markApr || 'N/A';
    const expiryDate = formatExpiry(market.imData.maturity);
    const state = market.state || 'Unknown';
    const stateWarning = state !== 'Normal' ? ' ⚠️  WARNING: NOT TRADEABLE' : '';

    console.log(`Market ID: ${market.marketId}`);
    console.log(`  Name:        ${market.metadata.name}`);
    console.log(`  Platform:    ${market.metadata.platformName}`);
    console.log(`  Asset:       ${market.metadata.asset}`);
    console.log(`  APR:         ${apr}`);
    console.log(`  State:       ${state}${stateWarning}`);
    console.log(`  Expiry:      ${expiryDate}`);
    console.log(`  Unix Timestamp: ${market.imData.maturity}`);
    console.log('-'.repeat(80));
  }
}

// Get market IDs from command line arguments
const args = process.argv.slice(2).map(arg => parseInt(arg, 10));

if (args.length === 0) {
  console.log('Usage: tsx src/market-inspector.ts <market_id_1> <market_id_2> ...');
  console.log('Example: tsx src/market-inspector.ts 31 33 45');
  process.exit(1);
}

await inspectMarkets(args);
