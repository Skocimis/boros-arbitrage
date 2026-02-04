import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, LineSeries, type UTCTimestamp, type IChartApi, type ISeriesApi } from 'lightweight-charts';
import type { AlignedDataPoint, Market } from '../types.ts';
import { leverageColor } from '../leverageColors.ts';

interface ChartViewProps {
  data: AlignedDataPoint[];
  market1: Market;
  market2: Market;
  leverages: number[];
  hiddenLeverages: number[];
  onToggleLeverage: (lev: number) => void;
}

interface HoverValues {
  v1: number | null;
  v2: number | null;
  spread: number | null;
  lev: Record<number, number | null>;
}

type Resolution = '5m' | '30m' | '3h';

const RESOLUTIONS: Resolution[] = ['5m', '30m', '3h'];

const MIN_BAR_SPACING: Record<Resolution, number> = { '5m': 1, '30m': 0.5, '3h': 0.2 };

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

export default function ChartView({ data, market1, market2, leverages, hiddenLeverages, onToggleLeverage }: ChartViewProps) {
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

  const [show1, setShow1] = useState(true);
  const [show2, setShow2] = useState(true);
  const [showSpread, setShowSpread] = useState(true);
  const [hover, setHover] = useState<HoverValues>({ v1: null, v2: null, spread: null, lev: {} });
  const [activeRes, setActiveRes] = useState<Resolution>('5m');

  const color1 = platformColor(market1);
  const color2 = platformColor(market2);
  const spreadColor = '#2962ff';

  const levels = useMemo(() => ({
    '5m': data,
    '30m': downsample(data, 6),
    '3h': downsample(data, 36),
  }), [data]);

  // Create chart + core series (no leverage series here)
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
        minBarSpacing: MIN_BAR_SPACING['5m'],
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
        ls.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.diff * 100 * lev / 2 })));
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
      ls.setData(d.map((p) => ({ time: p.timestamp as UTCTimestamp, value: p.diff * 100 * lev / 2 })));
    }

    chart.applyOptions({ timeScale: { minBarSpacing: MIN_BAR_SPACING[activeRes] } });
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

  useEffect(() => {
    seriesRef.current.s1?.applyOptions({ visible: show1 });
  }, [show1]);

  useEffect(() => {
    seriesRef.current.s2?.applyOptions({ visible: show2 });
  }, [show2]);

  useEffect(() => {
    seriesRef.current.spread?.applyOptions({ visible: showSpread });
  }, [showSpread]);

  const spreadValues = data.map((d) => d.diff * 100);
  const minSpread = Math.min(...spreadValues);
  const maxSpread = Math.max(...spreadValues);
  const avgSpread = spreadValues.reduce((a, b) => a + b, 0) / spreadValues.length;

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
          <span>Spread: {minSpread.toFixed(2)}% – {maxSpread.toFixed(2)}% (avg {avgSpread.toFixed(2)}%)</span>
        </div>
      </div>
      <div className="chart-wrapper">
        <div className="chart-overlay">
          <label className="overlay-item">
            <input type="checkbox" checked={show1} onChange={() => setShow1(!show1)} />
            <span className="legend-dot" style={{ backgroundColor: color1 }} />
            <span>{market1.imData.name} (#{market1.marketId})</span>
            {show1 && fmtVal(hover.v1, color1)}
          </label>
          <label className="overlay-item">
            <input type="checkbox" checked={show2} onChange={() => setShow2(!show2)} />
            <span className="legend-dot" style={{ backgroundColor: color2 }} />
            <span>{market2.imData.name} (#{market2.marketId})</span>
            {show2 && fmtVal(hover.v2, color2)}
          </label>
          <label className="overlay-item">
            <input type="checkbox" checked={showSpread} onChange={() => setShowSpread(!showSpread)} />
            <span className="legend-dot" style={{ backgroundColor: spreadColor }} />
            <span>Spread</span>
            {showSpread && fmtVal(hover.spread, spreadColor)}
          </label>
          {leverages.map((lev) => {
            const visible = !hiddenLeverages.includes(lev);
            const color = leverageColor(leverages, lev);
            return (
              <label key={lev} className="overlay-item">
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={() => onToggleLeverage(lev)}
                />
                <span className="legend-dot" style={{ backgroundColor: color }} />
                <span>{lev}x</span>
                {visible && fmtVal(hover.lev[lev] ?? null, color)}
              </label>
            );
          })}
        </div>
        <div ref={containerRef} />
      </div>
    </div>
  );
}
