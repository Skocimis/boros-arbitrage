import { useState } from 'react';
import type { AlignedDataPoint } from '../types.ts';
import { leverageColor } from '../leverageColors.ts';

interface LeveragePanelProps {
  leverages: number[];
  onLeveragesChange: (leverages: number[]) => void;
  data: AlignedDataPoint[];
}

export default function LeveragePanel({
  leverages,
  onLeveragesChange,
  data,
}: LeveragePanelProps) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const val = parseFloat(input);
    if (isNaN(val) || val <= 0) return;
    if (leverages.includes(val)) return;
    onLeveragesChange([...leverages, val].sort((a, b) => a - b));
    setInput('');
  };

  const handleRemove = (lev: number) => {
    onLeveragesChange(leverages.filter((l) => l !== lev));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
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
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
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
      <div className="settings-block">
        <div className="settings-block-title">Leveraged APY</div>
        <div className="lev-apy-rows">
          {leverages.map((lev) => {
            const apy = avgDiff * 100 * lev / 2;
            return (
              <div key={lev} className="lev-apy-row">
                <span className="legend-dot" style={{ backgroundColor: leverageColor(leverages, lev) }} />
                <span className="lev-apy-label">{lev}x</span>
                <span className="lev-apy-value">{apy.toFixed(2)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
