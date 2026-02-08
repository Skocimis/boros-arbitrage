import { useState, useMemo, useEffect } from 'react';
import type { AlignedDataPoint, Market } from '../types.ts';
import type { FeeMode } from '../fees.ts';
import { leverageColor } from '../leverageColors.ts';
import {
  computeFeeAtTimestamp,
  computeBorosSwapFee,
  estimateTakerTaker,
  estimateMakerTaker,
  BOROS_SWAP_RATE,
} from '../fees.ts';

const BOROS_OI_FEE = 0.0001; // 0.01% Boros open interest fee

interface LeveragePanelProps {
  leverages: number[];
  onLeveragesChange: (leverages: number[]) => void;
  data: AlignedDataPoint[];
  daysHeld: number | null;
  onDaysHeldChange: (days: number | null) => void;
  size: number;
  onSizeChange: (size: number) => void;
  feeMode: FeeMode;
  onFeeModeChange: (mode: FeeMode) => void;
  market1: Market;
  market2: Market;
  minMaturity: number;
  maxStartTime: number;
  assetPrice: number | null;
  onAssetPriceChange: (price: number | null) => void;
  onRefreshPrice: () => void;
  priceLoading: boolean;
}

export default function LeveragePanel({
  leverages,
  onLeveragesChange,
  data,
  daysHeld,
  onDaysHeldChange,
  size,
  onSizeChange,
  feeMode,
  onFeeModeChange,
  market1,
  market2,
  minMaturity,
  maxStartTime,
  assetPrice,
  onAssetPriceChange,
  onRefreshPrice,
  priceLoading,
}: LeveragePanelProps) {
  const [levInput, setLevInput] = useState('');
  const [daysInput, setDaysInput] = useState('');

  const handleAdd = () => {
    const val = parseFloat(levInput);
    if (isNaN(val) || val <= 0) return;
    if (leverages.includes(val)) return;
    onLeveragesChange([...leverages, val].sort((a, b) => a - b));
    setLevInput('');
  };

  const handleRemove = (lev: number) => {
    onLeveragesChange(leverages.filter((l) => l !== lev));
  };

  const handleLevKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  const maxDays = useMemo(() => {
    if (minMaturity <= maxStartTime) return 0;
    return Math.floor((minMaturity - maxStartTime) / 86400);
  }, [minMaturity, maxStartTime]);

  const effectiveDays = daysHeld ?? maxDays;

  const setDays = (v: number) => {
    const clamped = Math.max(1, Math.min(maxDays, Math.floor(v)));
    onDaysHeldChange(clamped === maxDays ? null : clamped);
  };

  const handleDaysInputCommit = () => {
    const v = parseInt(daysInput, 10);
    if (isNaN(v)) {
      setDaysInput('');
      return;
    }
    setDays(v);
    setDaysInput('');
  };

  // Auto-re-estimate dexFee when size changes
  useEffect(() => {
    if (feeMode.type === 'taker-taker') {
      const result = estimateTakerTaker(size, market1.metadata.platformName, market2.metadata.platformName);
      onFeeModeChange({ type: 'taker-taker', dexFee: result.dexFee });
    } else if (feeMode.type === 'maker-taker') {
      const result = estimateMakerTaker(size, market1.metadata.platformName, market2.metadata.platformName);
      onFeeModeChange({ type: 'maker-taker', dexFee: result.dexFee });
    }
  }, [size]);

  const platform1 = market1.metadata.platformName;
  const platform2 = market2.metadata.platformName;

  const takerTakerInfo = useMemo(() => estimateTakerTaker(size, platform1, platform2), [size, platform1, platform2]);
  const makerTakerInfo = useMemo(() => estimateMakerTaker(size, platform1, platform2), [size, platform1, platform2]);

  const handleTakerTaker = () => {
    onFeeModeChange({ type: 'taker-taker', dexFee: takerTakerInfo.dexFee });
  };

  const handleMakerTaker = () => {
    onFeeModeChange({ type: 'maker-taker', dexFee: makerTakerInfo.dexFee });
  };

  const handleManualInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v) && v >= 0) onFeeModeChange({ type: 'manual', amount: v });
  };

  const avgDiff = data.length > 0
    ? data.reduce((s, d) => s + d.diff, 0) / data.length
    : 0;

  const earliestTs = data.length > 0 ? data[0].timestamp : maxStartTime;

  // Fee at earliest data point for ROI and breakdown display
  const feeAtEarliest = computeFeeAtTimestamp(feeMode, size, minMaturity, earliestTs);
  const borosSwapAtEarliest = computeBorosSwapFee(size, minMaturity, earliestTs);

  const fmtRate = (rate: number) => (rate * 100).toFixed(4) + '%';
  const fmtAsset = (v: number) => v.toPrecision(4);
  const fmtUsd = (v: number) => '$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const assetSymbol = market1.metadata.assetSymbol ?? market1.metadata.name;

  return (
    <div className="settings-panel">
      <div className="settings-block">
        <div className="settings-block-title">Leverage</div>
        <div className="leverage-input-row">
          <input
            type="number"
            className="leverage-input"
            placeholder="e.g. 10"
            value={levInput}
            onChange={(e) => setLevInput(e.target.value)}
            onKeyDown={handleLevKeyDown}
            min="0"
            step="any"
          />
          <button className="leverage-add-btn" onClick={handleAdd}>Add</button>
        </div>
        <div className="leverage-tags">
          {leverages.map((lev) => (
            <span key={lev} className="leverage-tag">
              <span className="legend-dot" style={{ backgroundColor: leverageColor(leverages, lev) }} />
              {lev}x
              <button
                className="leverage-tag-remove"
                onClick={() => handleRemove(lev)}
              >x</button>
            </span>
          ))}
        </div>
      </div>
      {maxDays >= 1 && (
        <div className="settings-block">
          <div className="settings-block-title">Days held</div>
          <div className="days-held-row">
            <input
              type="number"
              className="days-held-input"
              placeholder={effectiveDays === maxDays ? 'MAX' : String(effectiveDays)}
              value={daysInput}
              onChange={(e) => setDaysInput(e.target.value)}
              onBlur={handleDaysInputCommit}
              onKeyDown={(e) => { if (e.key === 'Enter') handleDaysInputCommit(); }}
              min={1}
              max={maxDays}
            />
            <span className="days-held-display">{effectiveDays === maxDays ? 'MAX' : effectiveDays}</span>
          </div>
          <input
            type="range"
            className="days-held-slider"
            min={1}
            max={maxDays}
            value={effectiveDays}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              onDaysHeldChange(v === maxDays ? null : v);
            }}
          />
        </div>
      )}
      <div className="settings-block">
        <div className="settings-block-title">Size</div>
        <input
          type="number"
          className="leverage-input"
          placeholder="e.g. 1"
          value={size}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v > 0) onSizeChange(v);
          }}
          min="0"
          step="any"
        />
      </div>
      <div className="settings-block">
        <div className="settings-block-title">{assetSymbol} Price</div>
        <div className="price-input-row">
          <input
            type="number"
            className="leverage-input"
            placeholder="e.g. 3000"
            value={assetPrice ?? ''}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              onAssetPriceChange(!isNaN(v) && v > 0 ? v : null);
            }}
            min="0"
            step="any"
          />
          <button
            className="price-refresh-btn"
            onClick={onRefreshPrice}
            disabled={priceLoading}
            title="Refresh price from API"
          >
            {'\u21BB'}
          </button>
        </div>
        {assetPrice != null && (
          <div className="notional-display">Notional: {fmtUsd(size * assetPrice)}</div>
        )}
      </div>
      <div className="settings-block">
        <div className="settings-block-title">Fees</div>
        <input
          type="number"
          className="leverage-input"
          placeholder="e.g. 0.1"
          value={feeMode.type === 'manual' ? feeMode.amount : feeAtEarliest.toPrecision(4)}
          onChange={handleManualInput}
          min="0"
          step="any"
        />
        <div className="fee-estimate-buttons">
          <button
            className={`fee-estimate-btn${feeMode.type === 'taker-taker' ? ' fee-estimate-active' : ''}`}
            onClick={handleTakerTaker}
          >
            Taker-Taker
          </button>
          <button
            className={`fee-estimate-btn${feeMode.type === 'maker-taker' ? ' fee-estimate-active' : ''}`}
            onClick={handleMakerTaker}
          >
            Maker-Taker
          </button>
        </div>
        {feeMode.type !== 'manual' && (
          <div className="fee-breakdown">
            <div className="fee-breakdown-row">
              <span className="fee-breakdown-label">DEX fees</span>
              <span className="fee-breakdown-value">
                {fmtAsset(feeMode.dexFee)}
                {assetPrice != null && <span className="fee-usd"> ({fmtUsd(feeMode.dexFee * assetPrice)})</span>}
              </span>
            </div>
            {feeMode.type === 'taker-taker' ? (
              <>
                <div className="fee-breakdown-row">
                  <span className="fee-breakdown-label">&nbsp;&nbsp;{platform1}</span>
                  <span className="fee-breakdown-value">{fmtRate(takerTakerInfo.dex1Rate)} taker</span>
                </div>
                <div className="fee-breakdown-row">
                  <span className="fee-breakdown-label">&nbsp;&nbsp;{platform2}</span>
                  <span className="fee-breakdown-value">{fmtRate(takerTakerInfo.dex2Rate)} taker</span>
                </div>
              </>
            ) : (
              <>
                <div className="fee-breakdown-row">
                  <span className="fee-breakdown-label">&nbsp;&nbsp;{makerTakerInfo.makerPlatform}</span>
                  <span className="fee-breakdown-value">{fmtRate(makerTakerInfo.makerRate)} maker</span>
                </div>
                <div className="fee-breakdown-row">
                  <span className="fee-breakdown-label">&nbsp;&nbsp;{makerTakerInfo.takerPlatform}</span>
                  <span className="fee-breakdown-value">{fmtRate(makerTakerInfo.takerRate)} taker</span>
                </div>
              </>
            )}
            <div className="fee-breakdown-formula">
              2 &times; {size} &times; ({fmtRate(feeMode.type === 'taker-taker' ? takerTakerInfo.dex1Rate : makerTakerInfo.makerRate)} + {fmtRate(feeMode.type === 'taker-taker' ? takerTakerInfo.dex2Rate : makerTakerInfo.takerRate)})
            </div>
            <div className="fee-breakdown-divider" />
            <div className="fee-breakdown-row">
              <span className="fee-breakdown-label">Boros swap</span>
              <span className="fee-breakdown-value">
                {fmtAsset(borosSwapAtEarliest)}
                {assetPrice != null && <span className="fee-usd"> ({fmtUsd(borosSwapAtEarliest * assetPrice)})</span>}
              </span>
            </div>
            <div className="fee-breakdown-formula">
              {size} &times; 2 &times; {(BOROS_SWAP_RATE * 100).toFixed(2)}% &times; (maturity - entry) / 365d
            </div>
            <div className="fee-breakdown-divider" />
            <div className="fee-breakdown-row">
              <span className="fee-breakdown-label">Total (earliest)</span>
              <span className="fee-breakdown-value">
                {fmtAsset(feeAtEarliest)}
                {assetPrice != null && <span className="fee-usd"> ({fmtUsd(feeAtEarliest * assetPrice)})</span>}
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="settings-block">
        <div className="settings-block-title">Annualized ROI</div>
        <div className="lev-apy-rows">
          {leverages.map((lev) => {
            const profitDaysRemaining = data.length > 0 ? Math.max(0, (minMaturity - data[0].timestamp) / 86400) : 0;
            const heldDays = Math.min(profitDaysRemaining, effectiveDays);
            const fee = computeFeeAtTimestamp(feeMode, size, minMaturity, earliestTs);
            const profit = heldDays / 365 * (avgDiff - BOROS_OI_FEE) * size - fee;
            const collateral = 2 * size / lev;
            const profitValue = heldDays > 0 ? (profit / collateral) * (365 / heldDays) * 100 : 0;
            return (
              <div key={lev} className="lev-apy-row">
                <span className="legend-dot" style={{ backgroundColor: leverageColor(leverages, lev) }} />
                <span className="lev-apy-label">{lev}x</span>
                <span className="lev-apy-value">{profitValue.toFixed(2)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
