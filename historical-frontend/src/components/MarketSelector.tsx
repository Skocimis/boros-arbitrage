import { useMemo } from 'react';
import type { Market } from '../types.ts';

function formatDate(ts: number | null): string {
  if (ts === null) return 'no data';
  return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface MarketSelectorProps {
  markets: Market[];
  marketsLoading: boolean;
  market1Id: number | null;
  onMarket1Change: (id: number | null) => void;
  market2Id: number | null;
  onMarket2Change: (id: number | null) => void;
  onLoad: () => void;
  loading: boolean;
}

export default function MarketSelector({
  markets,
  marketsLoading,
  market1Id,
  onMarket1Change,
  market2Id,
  onMarket2Change,
  onLoad,
  loading,
}: MarketSelectorProps) {
  const sorted = useMemo(
    () => [...markets].sort((a, b) => b.marketId - a.marketId),
    [markets]
  );

  const handleSelect = (
    e: React.ChangeEvent<HTMLSelectElement>,
    setter: (id: number | null) => void
  ) => {
    const val = e.target.value;
    setter(val ? Number(val) : null);
  };

  const canLoad = market1Id !== null && market2Id !== null && !loading;

  return (
    <div className="selector-section">
      <div className="select-wrapper">
        <label htmlFor="market1">Market 1</label>
        <select
          id="market1"
          value={market1Id ?? ''}
          onChange={(e) => handleSelect(e, onMarket1Change)}
          disabled={marketsLoading}
        >
          <option value="">
            {marketsLoading ? 'Loading markets...' : 'Select a market'}
          </option>
          {sorted.map((m) => (
            <option key={m.marketId} value={m.marketId}>
              {m.marketId} — {m.imData.name} (from {formatDate(m.startTime)})
            </option>
          ))}
        </select>
      </div>

      <div className="select-wrapper">
        <label htmlFor="market2">Market 2</label>
        <select
          id="market2"
          value={market2Id ?? ''}
          onChange={(e) => handleSelect(e, onMarket2Change)}
          disabled={marketsLoading}
        >
          <option value="">
            {marketsLoading ? 'Loading markets...' : 'Select a market'}
          </option>
          {sorted.map((m) => (
            <option key={m.marketId} value={m.marketId}>
              {m.marketId} — {m.imData.name} (from {formatDate(m.startTime)})
            </option>
          ))}
        </select>
      </div>

      <button
        className="load-button"
        onClick={onLoad}
        disabled={!canLoad}
      >
        {loading ? 'Loading...' : 'Load'}
      </button>
    </div>
  );
}
