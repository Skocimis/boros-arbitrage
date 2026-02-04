export const LEVERAGE_COLORS = ['#7c4dff', '#e91e63', '#ff6d00', '#00bcd4', '#4caf50', '#ffc107', '#9c27b0', '#795548'];

export function leverageColor(leverages: number[], lev: number): string {
  const idx = leverages.indexOf(lev);
  return LEVERAGE_COLORS[idx % LEVERAGE_COLORS.length];
}
