import { useState, useEffect, useCallback } from 'react';
import './App.css';
import type { Market, AlignedDataPoint } from './types.ts';
import type { FeeMode } from './fees.ts';
import { estimateMakerTaker } from './fees.ts';
import { fetchAllMarkets, fetchChartData, fetchMarketDetail } from './api.ts';
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
  const [size, setSize] = useState<number>(5);
  const [feeMode, setFeeMode] = useState<FeeMode>({ type: 'manual', amount: 0 });
  const [assetPrice, setAssetPrice] = useState<number | null>(null);
  const [priceLoading, setPriceLoading] = useState(false);
  const [hoverTimestamp, setHoverTimestamp] = useState<number | null>(null);
  const [loadedMarket1Id, setLoadedMarket1Id] = useState<number | null>(null);
  const [loadedMarket2Id, setLoadedMarket2Id] = useState<number | null>(null);

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

  const handleRefreshPrice = useCallback(async () => {
    if (!market1) return;
    setPriceLoading(true);
    try {
      const detail = await fetchMarketDetail(market1.marketId);
      setAssetPrice(detail.data?.assetMarkPrice ?? null);
    } catch {
      // silently fail — user can retry
    } finally {
      setPriceLoading(false);
    }
  }, [market1]);

  const handleLoad = async () => {
    setError(null);
    setChartData(null);
    setAssetPrice(null);
    setLoadedMarket1Id(null);
    setLoadedMarket2Id(null);

    if (market1Id === market2Id) {
      setError('Cannot select the same market for both sides. Choose two different markets.');
      return;
    }

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
      setLoadedMarket1Id(m1.marketId);
      setLoadedMarket2Id(m2.marketId);

      // Fetch live market details (volume, OI, price) — merge onto
      // indexer objects to preserve startTime (indexer-only field)
      setMarket1(m1);
      setMarket2(m2);
      setPriceLoading(true);
      Promise.all([fetchMarketDetail(m1.marketId), fetchMarketDetail(m2.marketId)])
        .then(([detail1, detail2]) => {
          setMarket1({ ...m1, ...detail1, startTime: m1.startTime });
          setMarket2({ ...m2, ...detail2, startTime: m2.startTime });
          setAssetPrice(detail1.data?.assetMarkPrice ?? null);
        })
        .catch(() => {})
        .finally(() => setPriceLoading(false));

      const mt = estimateMakerTaker(size, m1.metadata.platformName, m2.metadata.platformName);
      setFeeMode({ type: 'maker-taker', dexFee: mt.dexFee });
    } catch (err) {
      setError(`Failed to fetch chart data: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <MarketSelector
        markets={markets}
        marketsLoading={marketsLoading}
        market1Id={market1Id}
        onMarket1Change={setMarket1Id}
        market2Id={market2Id}
        onMarket2Change={setMarket2Id}
        onLoad={handleLoad}
        loading={loading}
        loadedMarket1Id={loadedMarket1Id}
        loadedMarket2Id={loadedMarket2Id}
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
            feeMode={feeMode}
            assetPrice={assetPrice}
            onHoverTimestampChange={setHoverTimestamp}
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
              feeMode={feeMode}
              onFeeModeChange={setFeeMode}
              market1={market1}
              market2={market2}
              minMaturity={Math.min(market1.imData.maturity, market2.imData.maturity)}
              maxStartTime={Math.max(market1.startTime ?? 0, market2.startTime ?? 0)}
              assetPrice={assetPrice}
              onAssetPriceChange={setAssetPrice}
              onRefreshPrice={handleRefreshPrice}
              priceLoading={priceLoading}
              hoverTimestamp={hoverTimestamp}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
