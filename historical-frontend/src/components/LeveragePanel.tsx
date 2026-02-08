import { useState, useMemo } from 'react';
import type { AlignedDataPoint } from '../types.ts';
import { leverageColor } from '../leverageColors.ts';

const BOROS_OI_FEE = 0.0001; // 0.01% Boros open interest fee

interface LeveragePanelProps {
  leverages: number[];
  onLeveragesChange: (leverages: number[]) => void;
  data: AlignedDataPoint[];
  daysHeld: number | null;
  onDaysHeldChange: (days: number | null) => void;
  size: number;
  onSizeChange: (size: number) => void;
  fees: number;
  onFeesChange: (fees: number) => void;
  minMaturity: number;
  maxStartTime: number;
}

export default function LeveragePanel({
  leverages,
  onLeveragesChange,
  data,
  daysHeld,
  onDaysHeldChange,
  size,
  onSizeChange,
  fees,
  onFeesChange,
  minMaturity,
  maxStartTime,
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

  const avgDiff = data.length > 0
    ? data.reduce((s, d) => s + d.diff, 0) / data.length
    : 0;

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
        <div className="settings-block-title">Fees</div>
        <input
          type="number"
          className="leverage-input"
          placeholder="e.g. 0.1"
          value={fees}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v >= 0) onFeesChange(v);
          }}
          min="0"
          step="any"
        />
      </div>
      <div className="settings-block">
        <div className="settings-block-title">Annualized ROI</div>
        <div className="lev-apy-rows">
          {leverages.map((lev) => {
            const profitDaysRemaining = data.length > 0 ? Math.max(0, (minMaturity - data[0].timestamp) / 86400) : 0;
            const heldDays = Math.min(profitDaysRemaining, effectiveDays);
            const profit = heldDays / 365 * (avgDiff - BOROS_OI_FEE) * size - fees;
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
