import { useMemo } from 'react';
import type { Market } from '../types.ts';
import { formatMarketName } from '../marketName.ts';

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

  const isCompatible = (selected: Market, candidate: Market): boolean => {
    if (candidate.marketId === selected.marketId) return false;
    if (candidate.startTime === null || selected.startTime === null) return false;
    const asset1 = selected.metadata.assetSymbol ?? selected.metadata.name;
    const asset2 = candidate.metadata.assetSymbol ?? candidate.metadata.name;
    if (asset1 !== asset2) return false;
    if (selected.imData.maturity < candidate.startTime || candidate.imData.maturity < selected.startTime) return false;
    return true;
  };

  const exactlyOneSelected = (market1Id !== null) !== (market2Id !== null);
  const selectedMarket = exactlyOneSelected
    ? markets.find((m) => m.marketId === (market1Id ?? market2Id))
    : null;

  const filteredForOther = useMemo(() => {
    if (!selectedMarket) return sorted;
    return sorted.filter((m) => isCompatible(selectedMarket, m));
  }, [sorted, selectedMarket]);

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
          {(market2Id !== null && market1Id === null ? filteredForOther : sorted).map((m) => (
            <option key={m.marketId} value={m.marketId}>
              {m.marketId} - {formatMarketName(m)}
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
          {(market1Id !== null && market2Id === null ? filteredForOther : sorted).map((m) => (
            <option key={m.marketId} value={m.marketId}>
              {m.marketId} - {formatMarketName(m)}
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
