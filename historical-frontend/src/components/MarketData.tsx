import type { Market } from '../types.ts';
import { formatMarketName } from '../marketName.ts';

interface MarketDataProps {
  market1: Market;
  market2: Market;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}

function MarketCard({ market, color }: { market: Market; color: string }) {
  const d = market.data;
  return (
    <div className="market-card">
      <div className="market-card-header">
        <span className="market-card-dot" style={{ backgroundColor: color }} />
        <span className="market-card-title">{formatMarketName(market)}</span>
        <span className="market-card-id">#{market.marketId}</span>
      </div>
      <div className="market-card-rows">
        <div className="market-card-row">
          <span className="market-card-label">Platform</span>
          <span className="market-card-value">{market.metadata.platformName}</span>
        </div>
        <div className="market-card-row">
          <span className="market-card-label">State</span>
          <span className="market-card-value">{market.state ?? '-'}</span>
        </div>
        <div className="market-card-row">
          <span className="market-card-label">Maturity</span>
          <span className="market-card-value">{formatDate(market.imData.maturity)}</span>
        </div>
        <div className="market-card-row">
          <span className="market-card-label">Max Leverage</span>
          <span className="market-card-value">{market.metadata.maxLeverage}x</span>
        </div>
        {d && (
          <>
            <div className="market-card-divider" />
            <div className="market-card-row">
              <span className="market-card-label">Mark APR</span>
              <span className="market-card-value">{(d.markApr * 100).toFixed(2)}%</span>
            </div>
            <div className="market-card-row">
              <span className="market-card-label">Floating APR</span>
              <span className="market-card-value">{(d.floatingApr * 100).toFixed(2)}%</span>
            </div>
            <div className="market-card-row">
              <span className="market-card-label">Asset Price</span>
              <span className="market-card-value">${formatNumber(d.assetMarkPrice)}</span>
            </div>
            <div className="market-card-row">
              <span className="market-card-label">24h Volume</span>
              <span className="market-card-value">${formatNumber(d.volume24h)}</span>
            </div>
            <div className="market-card-row">
              <span className="market-card-label">Open Interest</span>
              <span className="market-card-value">${formatNumber(d.notionalOI)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function platformColor(market: Market): string {
  const name = market.metadata.platformName.toLowerCase();
  if (name.includes('hyperliquid')) return '#2dd4bf';
  if (name.includes('okx')) return '#d1d5db';
  return '#8b949e';
}

export default function MarketData({ market1, market2 }: MarketDataProps) {
  return (
    <div className="market-data-panel">
      <MarketCard market={market1} color={platformColor(market1)} />
      <MarketCard market={market2} color={platformColor(market2)} />
    </div>
  );
}
