import { useState, useEffect, useCallback } from 'react';
import './App.css';
import type { Market, AlignedDataPoint } from './types.ts';
import { fetchAllMarkets, fetchChartData } from './api.ts';
import MarketSelector from './components/MarketSelector.tsx';
import ErrorDisplay from './components/ErrorDisplay.tsx';
import LoadingSpinner from './components/LoadingSpinner.tsx';
import ChartView from './components/ChartView.tsx';
import MarketData from './components/MarketData.tsx';
import LeveragePanel from './components/LeveragePanel.tsx';

function App() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketsLoading, setMarketsLoading] = useState(true);
  const [market1Id, setMarket1Id] = useState<number | null>(null);
  const [market2Id, setMarket2Id] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<AlignedDataPoint[] | null>(null);
  const [market1, setMarket1] = useState<Market | null>(null);
  const [market2, setMarket2] = useState<Market | null>(null);
  const [leverages, setLeverages] = useState<number[]>([4]);
  const [hiddenLeverages, setHiddenLeverages] = useState<number[]>([]);
  const [daysHeld, setDaysHeld] = useState<number | null>(null);
  const [size, setSize] = useState<number>(1);
  const [fees, setFees] = useState<number>(0);

  useEffect(() => {
    fetchAllMarkets()
      .then(setMarkets)
      .catch((err) => {
        setError(`Failed to fetch markets: ${err instanceof Error ? err.message : String(err)}`);
      })
      .finally(() => setMarketsLoading(false));
  }, []);

  const handleLeveragesChange = useCallback((newLeverages: number[]) => {
    setLeverages(newLeverages);
    setHiddenLeverages((prev) => prev.filter((l) => newLeverages.includes(l)));
  }, []);

  const handleToggleLeverage = useCallback((lev: number) => {
    setHiddenLeverages((prev) =>
      prev.includes(lev) ? prev.filter((l) => l !== lev) : [...prev, lev]
    );
  }, []);

  const handleLoad = async () => {
    setError(null);
    setChartData(null);

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

    if (m1.startTime === null) {
      setError(`Market ${m1.marketId} (${m1.imData.name}) has no historical data available.`);
      return;
    }
    if (m2.startTime === null) {
      setError(`Market ${m2.marketId} (${m2.imData.name}) has no historical data available.`);
      return;
    }

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

    const start = Math.max(m1.startTime, m2.startTime);
    const end = Math.min(m1.imData.maturity, m2.imData.maturity);

    setLoading(true);
    try {
      const [candles1, candles2] = await Promise.all([
        fetchChartData(m1.marketId, start, end),
        fetchChartData(m2.marketId, start, end),
      ]);

      const map2 = new Map<number, number>();
      for (const c of candles2) {
        map2.set(c.ts, c.c);
      }

      const aligned: AlignedDataPoint[] = [];
      for (const c of candles1) {
        const apr2 = map2.get(c.ts);
        if (apr2 !== undefined) {
          aligned.push({
            timestamp: c.ts,
            apr1: c.c,
            apr2,
            diff: Math.abs(c.c - apr2),
          });
        }
      }

      if (aligned.length === 0) {
        setError('No overlapping candle data found between the two markets.');
        return;
      }

      setChartData(aligned);
      setMarket1(m1);
      setMarket2(m2);
    } catch (err) {
      setError(`Failed to fetch chart data: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
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

      {chartData && market1 && market2 && (
        <div className="chart-layout">
          <ChartView
            data={chartData}
            market1={market1}
            market2={market2}
            leverages={leverages}
            hiddenLeverages={hiddenLeverages}
            onToggleLeverage={handleToggleLeverage}
            size={size}
            daysHeld={daysHeld}
            fees={fees}
          />
          <div className="sidebar">
            <MarketData market1={market1} market2={market2} />
            <LeveragePanel
              leverages={leverages}
              onLeveragesChange={handleLeveragesChange}
              data={chartData}
              daysHeld={daysHeld}
              onDaysHeldChange={setDaysHeld}
              size={size}
              onSizeChange={setSize}
              fees={fees}
              onFeesChange={setFees}
              minMaturity={Math.min(market1.imData.maturity, market2.imData.maturity)}
              maxStartTime={Math.max(market1.startTime ?? 0, market2.startTime ?? 0)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
