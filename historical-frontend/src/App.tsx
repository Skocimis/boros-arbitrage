import { useState, useEffect } from 'react';
import './App.css';
import type { Market } from './types.ts';
import { fetchAllMarkets } from './api.ts';
import MarketSelector from './components/MarketSelector.tsx';
import ErrorDisplay from './components/ErrorDisplay.tsx';
import LoadingSpinner from './components/LoadingSpinner.tsx';

function App() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [market1Id, setMarket1Id] = useState<number | null>(null);
  const [market2Id, setMarket2Id] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllMarkets()
      .then(setMarkets)
      .catch((err) => {
        setError(`Failed to fetch markets: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setMarketsLoading(false));
  }, []);

  const handleLoad = () => {
    setError(null);

    const m1 = markets.find((m) => m.marketId === market1Id);
    const m2 = markets.find((m) => m.marketId === market2Id);
    if (!m1 || !m2) return;

    const asset1 = m1.metadata.assetSymbol ?? m1.metadata.name;
    const asset2 = m2.metadata.assetSymbol ?? m2.metadata.name;

    if (asset1 !== asset2) {
      setError(
        `Selected markets track different assets (${asset1} vs ${asset2}). Select two markets for the same asset.`
      );
      return;
    }

    // Validate startTime availability
    if (m1.startTime === null) {
      setError(`Market ${m1.marketId} (${m1.imData.name}) has no historical data available.`);
      return;
    }
    if (m2.startTime === null) {
      setError(`Market ${m2.marketId} (${m2.imData.name}) has no historical data available.`);
      return;
    }

    // Validate date range overlap: ranges are [startTime, maturity]
    const fmt = (ts: number) =>
      new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    if (m1.imData.maturity < m2.startTime || m2.imData.maturity < m1.startTime) {
      setError(
        `Markets have no overlapping date range. ` +
        `Market ${m1.marketId}: ${fmt(m1.startTime)} – ${fmt(m1.imData.maturity)}, ` +
        `Market ${m2.marketId}: ${fmt(m2.startTime)} – ${fmt(m2.imData.maturity)}.`
      );
      return;
    }

    // Chart data fetching will be wired in the chart phase
    setLoading(true);
    setTimeout(() => setLoading(false), 500);
  };

  return (
    <div className="app">
      <div className="header">
        <h1>Historical Arbitrage Analyzer</h1>
        <p>Compare implied APR across Boros markets</p>
      </div>

      <MarketSelector
        markets={markets}
        marketsLoading={marketsLoading}
        market1Id={market1Id}
        onMarket1Change={setMarket1Id}
        market2Id={market2Id}
        onMarket2Change={setMarket2Id}
        onLoad={handleLoad}
        loading={loading}
      />

      <ErrorDisplay message={error} />

      {loading && <LoadingSpinner message="Fetching chart data..." />}
    </div>
  );
}

export default App;
