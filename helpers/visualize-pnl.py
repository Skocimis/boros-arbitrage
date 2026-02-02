#!/usr/bin/env python3
"""
Visualize strategy PnL from CSV data.

Usage:
    python helpers/visualize-pnl.py [--csv PATH] [--output PATH]

Options:
    --csv PATH      Path to PnL CSV file (default: data/pnl.csv)
    --output PATH   Save chart to file instead of displaying

Requirements:
    pip install pandas matplotlib
"""

import argparse
import sys
from pathlib import Path

try:
    import pandas as pd
    import matplotlib.pyplot as plt
    import matplotlib.dates as mdates
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install with: pip install pandas matplotlib")
    sys.exit(1)


def load_data(csv_path: Path) -> pd.DataFrame:
    """Load and parse PnL CSV data."""
    if not csv_path.exists():
        print(f"Error: CSV file not found: {csv_path}")
        sys.exit(1)

    df = pd.read_csv(csv_path)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp')
    return df


def average_groups(df: pd.DataFrame, group_size: int = 6) -> pd.DataFrame:
    """Average every `group_size` rows, discarding highest and lowest values."""
    rows = []
    for start in range(0, len(df), group_size):
        chunk = df.iloc[start:start + group_size]
        values = chunk['realPnlUsd'].sort_values()
        if len(values) > 2:
            trimmed = values.iloc[1:-1]
        else:
            trimmed = values
        avg_pnl = trimmed.mean()
        ts = chunk['timestamp'].iloc[-1]
        rows.append({'timestamp': ts, 'realPnlUsd': avg_pnl})

    return pd.DataFrame(rows)


def plot_pnl(df: pd.DataFrame, output_path: Path | None = None) -> None:
    """Create PnL visualization."""
    fig, ax = plt.subplots(figsize=(12, 6))

    # Plot PnL line
    ax.plot(df['timestamp'], df['realPnlUsd'], 'b-', linewidth=1.5, label='Real PnL')

    # Fill positive/negative areas
    ax.fill_between(
        df['timestamp'],
        df['realPnlUsd'],
        0,
        where=(df['realPnlUsd'] >= 0),
        color='green',
        alpha=0.3,
        label='Profit'
    )
    ax.fill_between(
        df['timestamp'],
        df['realPnlUsd'],
        0,
        where=(df['realPnlUsd'] < 0),
        color='red',
        alpha=0.3,
        label='Loss'
    )

    # Zero line
    ax.axhline(y=0, color='black', linestyle='-', linewidth=0.5)

    # Labels and title
    ax.set_xlabel('Time', fontsize=12)
    ax.set_ylabel('PnL (USD)', fontsize=12)
    ax.set_title('Strategy Real PnL Over Time', fontsize=14, fontweight='bold')

    # Format x-axis dates
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d %H:%M'))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    plt.xticks(rotation=45, ha='right')

    # Grid
    ax.grid(True, alpha=0.3)

    # Legend
    ax.legend(loc='best')

    # Stats annotation
    current_pnl = df['realPnlUsd'].iloc[-1]
    min_pnl = df['realPnlUsd'].min()
    max_pnl = df['realPnlUsd'].max()
    data_points = len(df)

    stats_text = (
        f"Current: ${current_pnl:.3f}\n"
        f"Min: ${min_pnl:.3f}\n"
        f"Max: ${max_pnl:.3f}\n"
        f"Points: {data_points}"
    )

    # Position stats box in upper right or left depending on trend
    box_x = 0.02 if current_pnl < 0 else 0.98
    box_ha = 'left' if current_pnl < 0 else 'right'

    ax.text(
        box_x, 0.98, stats_text,
        transform=ax.transAxes,
        fontsize=10,
        verticalalignment='top',
        horizontalalignment=box_ha,
        bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5)
    )

    plt.tight_layout()

    if output_path:
        plt.savefig(output_path, dpi=150, bbox_inches='tight')
        print(f"Chart saved to: {output_path}")
    else:
        plt.show()


def main():
    parser = argparse.ArgumentParser(description='Visualize strategy PnL')
    parser.add_argument(
        '--csv',
        type=Path,
        default=Path('data/pnl.csv'),
        help='Path to PnL CSV file (default: data/pnl.csv)'
    )
    parser.add_argument(
        '--output',
        type=Path,
        default=None,
        help='Save chart to file instead of displaying'
    )

    args = parser.parse_args()

    print(f"Loading data from: {args.csv}")
    df = load_data(args.csv)
    print(f"Loaded {len(df)} data points")
    print(f"Time range: {df['timestamp'].min()} to {df['timestamp'].max()}")

    df = average_groups(df, group_size=6)
    print(f"Averaged to {len(df)} points (weighted avg per 6)")

    plot_pnl(df, args.output)


if __name__ == '__main__':
    main()
