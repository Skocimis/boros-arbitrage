import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, LineSeries, type UTCTimestamp, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { AlignedDataPoint, Market } from '../types.ts';
import { leverageColor } from '../leverageColors.ts';

const BOROS_OI_FEE = 0.0001; // 0.01% Boros open interest fee

interface ChartViewProps {
  data: AlignedDataPoint[];
  market1: Market;
  market2: Market;
  leverages: number[];
  hiddenLeverages: number[];
  onToggleLeverage: (lev: number) => void;
  size: number;
  daysHeld: number | null;
  fees: number;
}

interface HoverValues {
  v1: number | null;
  v2: number | null;
  spread: number | null;
  lev: Record<number, number | null>;
}

type Resolution = '5m' | '30m' | '3h';

const RESOLUTIONS: Resolution[] = ['5m', '30m', '3h'];

function downsample(data: AlignedDataPoint[], factor: number): AlignedDataPoint[] {
  const result: AlignedDataPoint[] = [];
  for (let i = 0; i < data.length; i += factor) {
    const end = Math.min(i + factor, data.length);
    let sumApr1 = 0, sumApr2 = 0, sumDiff = 0;
    for (let j = i; j < end; j++) {
      sumApr1 += data[j].apr1;
      sumApr2 += data[j].apr2;
      sumDiff += data[j].diff;
    }
    const len = end - i;
    result.push({
      timestamp: data[end - 1].timestamp,
      apr1: sumApr1 / len,
      apr2: sumApr2 / len,
      diff: sumDiff / len,
    });
  }
  return result;
}

function platformColor(market: Market): string {
  const name = market.metadata.platformName.toLowerCase();
  if (name.includes('hyperliquid')) return '#2dd4bf';
  if (name.includes('okx')) return '#d1d5db';
  return '#8b949e';
}

export default function ChartView({ data, market1, market2, leverages, hiddenLeverages, onToggleLeverage, size, daysHeld, fees }: ChartViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    s1: ISeriesApi<'Line'> | null;
    s2: ISeriesApi<'Line'> | null;
    spread: ISeriesApi<'Line'> | null;
  }>({ s1: null, s2: null, spread: null });
  const levSeriesRef = useRef<Map<number, ISeriesApi<'Line'>>>(new Map());
  const hiddenLevRef = useRef(hiddenLeverages);
  hiddenLevRef.current = hiddenLeverages;
  const activeResRef = useRef<Resolution>('5m');
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const daysHeldRef = useRef(daysHeld);
  daysHeldRef.current = daysHeld;
  const feesRef = useRef(fees);
  feesRef.current = fees;

  const [showBoros, setShowBoros] = useState(true);
  const [show1, setShow1] = useState(true);
  const [show2, setShow2] = useState(true);
  const [showSpread, setShowSpread] = useState(true);
  const [hover, setHover] = useState<HoverValues>({ v1: null, v2: null, spread: null, lev: {} });
  const [activeRes, setActiveRes] = useState<Resolution>('5m');

  const color1 = platformColor(market1);
  const color2 = platformColor(market2);
  const spreadColor = '#2962ff';

  const minMaturity = Math.min(market1.imData.maturity, market2.imData.maturity);
  const maxStartTime = Math.max(market1.startTime ?? 0, market2.startTime ?? 0);

  const maxDays = useMemo(() => {
    if (minMaturity <= maxStartTime) return 0;
    return Math.floor((minMaturity - maxStartTime) / 86400);
  }, [minMaturity, maxStartTime]);

  const profitVal = (lev: number, ts: number, spread: number, sz: number, fee: number) => {
    const daysRemaining = Math.max(0, (minMaturity - ts) / 86400);
    const effDays = daysHeldRef.current ?? maxDays;
    const heldDays = Math.min(daysRemaining, effDays);
    if (heldDays <= 0) return 0;
    const profit = heldDays / 365 * (spread - BOROS_OI_FEE) * sz - fee;
    const collateral = 2 * sz / lev;
    return (profit / collateral) * (365 / heldDays) * 100;
  };

  const levels = useMemo(() => ({
    '5m': data,
    '30m': downsample(data, 6),
    '3h': downsample(data, 36),
  }), [data]);

  // Create chart + all series
  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: 500,
      layout: {
        background: { color: '#0d1117' },
        textColor: '#c9d1d9',
      },
      grid: {
        vertLines: { color: '#30363d' },
        horzLines: { color: '#30363d' },
      },
      crosshair: {
        mode: 0,
      },
      rightPriceScale: {
        borderColor: '#30363d',
      },
      timeScale: {
        borderColor: '#30363d',
        timeVisible: true,
      },
    });

    chartRef.current = chart;
    activeResRef.current = '5m';

    const fmt = (v: number) => v.toFixed(2) + '%';

    const s1 = chart.addSeries(LineSeries, {
      color: color1,
      lineWidth: 1,
      title: market1.imData.name,
      priceFormat: { type: 'custom', formatter: fmt },
    });

    const s2 = chart.addSeries(LineSeries, {
      color: color2,
      lineWidth: 1,
      title: market2.imData.name,
      priceFormat: { type: 'custom', formatter: fmt },
    });

    const spread = chart.addSeries(LineSeries, {
      color: spreadColor,
      lineWidth: 4,
      title: 'Spread',
      priceFormat: { type: 'custom', formatter: fmt },
    });

    seriesRef.current = { s1, s2, spread };

    const d = levels['5m'];
    s1.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.apr1 * 100 })));
    s2.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.apr2 * 100 })));
    spread.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.diff * 100 })));

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || param.seriesData.size === 0) {
        setHover({ v1: null, v2: null, spread: null, lev: {} });
        return;
      }
      const d1 = param.seriesData.get(s1);
      const d2 = param.seriesData.get(s2);
      const ds = param.seriesData.get(spread);
      const levVals: Record<number, number | null> = {};
      for (const [lev, ls] of levSeriesRef.current) {
        const dl = param.seriesData.get(ls);
        levVals[lev] = dl && 'value' in dl ? dl.value : null;
      }
      setHover({
        v1: d1 && 'value' in d1 ? d1.value : null,
        v2: d2 && 'value' in d2 ? d2.value : null,
        spread: ds && 'value' in ds ? ds.value : null,
        lev: levVals,
      });
    });

    chart.timeScale().fitContent();

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = { s1: null, s2: null, spread: null };
      levSeriesRef.current = new Map();
    };
  }, [data, levels, market1, market2]);

  // Leverage series lifecycle — add/remove without resetting view
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const currentMap = levSeriesRef.current;
    const currentLevs = new Set(currentMap.keys());
    const newLevs = new Set(leverages);
    const range = chart.timeScale().getVisibleRange();

    // Remove deleted
    for (const lev of currentLevs) {
      if (!newLevs.has(lev)) {
        chart.removeSeries(currentMap.get(lev)!);
        currentMap.delete(lev);
      }
    }

    // Add new
    const fmt = (v: number) => v.toFixed(2) + '%';
    const d = levels[activeResRef.current];
    for (const lev of leverages) {
      if (!currentMap.has(lev)) {
        const ls = chart.addSeries(LineSeries, {
          color: leverageColor(leverages, lev),
          lineWidth: 2,
          title: `${lev}x`,
          priceFormat: { type: 'custom', formatter: fmt },
          visible: !hiddenLevRef.current.includes(lev),
        });
        ls.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: profitVal(lev, p.timestamp, p.diff, sizeRef.current, feesRef.current) })));
        currentMap.set(lev, ls);
      }
    }

    // Update colors (index may have shifted)
    for (const lev of leverages) {
      currentMap.get(lev)?.applyOptions({ color: leverageColor(leverages, lev) });
    }

    if (range) {
      chart.timeScale().setVisibleRange(range);
    }
  }, [leverages, levels]);

  // Switch resolution — preserve visible range
  useEffect(() => {
    const chart = chartRef.current;
    const { s1, s2, spread } = seriesRef.current;
    if (!chart || !s1 || !s2 || !spread) return;

    activeResRef.current = activeRes;
    const range = chart.timeScale().getVisibleRange();
    const d = levels[activeRes];

    s1.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.apr1 * 100 })));
    s2.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.apr2 * 100 })));
    spread.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.diff * 100 })));
    for (const [lev, ls] of levSeriesRef.current) {
      ls.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: profitVal(lev, p.timestamp, p.diff, sizeRef.current, feesRef.current) })));
    }

    if (range) {
      chart.timeScale().setVisibleRange(range);
    }
  }, [activeRes, levels]);

  // Toggle leverage visibility
  useEffect(() => {
    for (const [lev, ls] of levSeriesRef.current) {
      ls.applyOptions({ visible: !hiddenLeverages.includes(lev) });
    }
  }, [hiddenLeverages]);

  // Toggle Boros series visibility
  useEffect(() => {
    seriesRef.current.s1?.applyOptions({ visible: showBoros && show1 });
    seriesRef.current.s2?.applyOptions({ visible: showBoros && show2 });
    seriesRef.current.spread?.applyOptions({ visible: showBoros && showSpread });
  }, [showBoros, show1, show2, showSpread]);

  // Update leverage series when size, daysHeld, or fees change
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const d = levels[activeResRef.current];
    const effDays = daysHeld ?? maxDays;

    for (const [lev, ls] of levSeriesRef.current) {
      ls.setData(d.map((p) => {
        const daysRemaining = Math.max(0, (minMaturity - p.timestamp) / 86400);
        const heldDays = Math.min(daysRemaining, effDays);
        if (heldDays <= 0) return { time: p.timestamp as UTCTimestamp, value: 0 };
        const profit = heldDays / 365 * (p.diff - BOROS_OI_FEE) * size - fees;
        const collateral = 2 * size / lev;
        return { time: p.timestamp as UTCTimestamp, value: (profit / collateral) * (365 / heldDays) * 100 };
      }));
    }
  }, [daysHeld, levels, maxDays, minMaturity, size, fees]);

  const spreadValues = data.map((d) => d.diff * 100);
  const avgSpread = spreadValues.length > 0 ? spreadValues.reduce((a, b) => a + b, 0) / spreadValues.length : 0;

  const fmtVal = (v: number | null, color: string) =>
    v !== null ? <span className="legend-value" style={{ color }}>{v.toFixed(2)}%</span> : null;

  return (
    <div className="chart-section">
      <div className="chart-topbar">
        <div className="res-buttons">
          {RESOLUTIONS.map((r) => (
            <button
              key={r}
              className={`res-button${activeRes === r ? ' res-active' : ''}`}
              onClick={() => setActiveRes(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <div className="chart-stats">
          <span>{levels[activeRes].length.toLocaleString()} points</span>
        </div>
      </div>
      <div className="chart-wrapper">
        <div className="chart-overlay">
          {/* Boros overlay - implied APRs and spread */}
          <div className="overlay-card">
            <div className="overlay-card-header">
              <input
                type="checkbox"
                checked={showBoros}
                onChange={() => setShowBoros(!showBoros)}
              />
              <span className="overlay-card-title">Boros</span>
            </div>
            {showBoros && (
              <>
                <label className="overlay-item">
                  <input type="checkbox" checked={show1} onChange={() => setShow1(!show1)} />
                  <span className="legend-dot" style={{ backgroundColor: color1 }} />
                  <span>{market1.imData.name}</span>
                  {show1 && fmtVal(hover.v1, color1)}
                </label>
                <label className="overlay-item">
                  <input type="checkbox" checked={show2} onChange={() => setShow2(!show2)} />
                  <span className="legend-dot" style={{ backgroundColor: color2 }} />
                  <span>{market2.imData.name}</span>
                  {show2 && fmtVal(hover.v2, color2)}
                </label>
                <label className="overlay-item">
                  <input type="checkbox" checked={showSpread} onChange={() => setShowSpread(!showSpread)} />
                  <span className="legend-dot" style={{ backgroundColor: spreadColor }} />
                  <span>Spread</span>
                  {showSpread && fmtVal(hover.spread, spreadColor)}
                </label>
              </>
            )}
          </div>

          {/* Leverage overlays */}
          {leverages.map((lev) => {
            const visible = !hiddenLeverages.includes(lev);
            const color = leverageColor(leverages, lev);
            const collateral = 2 * size / lev;
            const effDays = daysHeld ?? maxDays;
            const daysRemaining = data.length > 0 ? Math.max(0, (minMaturity - data[0].timestamp) / 86400) : 0;
            const heldDays = Math.min(daysRemaining, effDays);
            // Use hovered spread when available, fallback to avgSpread
            const spreadPct = hover.spread !== null ? hover.spread : avgSpread;
            const spreadDecimal = spreadPct / 100;
            const totalProfit = heldDays / 365 * (spreadDecimal - BOROS_OI_FEE) * size - fees;
            const annualizedApy = heldDays > 0 ? (totalProfit / collateral) * (365 / heldDays) * 100 : 0;
            return (
              <div key={lev} className="overlay-card">
                <div className="overlay-card-header">
                  <input
                    type="checkbox"
                    checked={visible}
                    onChange={() => onToggleLeverage(lev)}
                  />
                  <span className="legend-dot" style={{ backgroundColor: color }} />
                  <span className="overlay-card-title">{lev}x</span>
                  {visible && hover.lev[lev] != null && (
                    <span className="overlay-card-hover" style={{ color }}>{hover.lev[lev]?.toFixed(2)}%</span>
                  )}
                </div>
                <div className="overlay-card-row">
                  <span className="overlay-card-label">Collateral</span>
                  <span className="overlay-card-value">{collateral.toFixed(4)}</span>
                </div>
                <div className="overlay-card-row">
                  <span className="overlay-card-label">Total Profit</span>
                  <span className="overlay-card-value">{totalProfit.toFixed(4)}</span>
                </div>
                <div className="overlay-card-row">
                  <span className="overlay-card-label">Annualized APY</span>
                  <span className="overlay-card-value">{annualizedApy.toFixed(2)}%</span>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={containerRef} />
      </div>
    </div>
  );
}
