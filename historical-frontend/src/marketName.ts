import type { Market } from './types.ts';

const COLLATERAL_TOKENS: Record<number, string> = {
  1: 'BTC',
  2: 'ETH',
  3: 'USDC',
  4: 'BNB',
  5: 'HYPE',
};

export function formatMarketName(market: Market): string {
  const platform = market.metadata.platformName;
  const asset = market.metadata.assetSymbol;
  const maturity = new Date(market.imData.maturity * 1000);
  const day = maturity.getUTCDate();
  const month = maturity.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const collateral = COLLATERAL_TOKENS[market.tokenId] ?? `Token ${market.tokenId}`;

  if (!asset) return market.imData.name;

  return `${platform} ${asset} ${day} ${month} (${collateral} Collateral)`;
}
