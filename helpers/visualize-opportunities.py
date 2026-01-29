#!/usr/bin/env python3
"""
Visualize opportunity APY from CSV data.

Usage:
    python helpers/visualize-opportunities.py [--csv PATH] [--output PATH]

Options:
    --csv PATH      Path to opportunities CSV file (default: data/opportunities.csv)
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
    """Load and parse opportunities CSV data."""
    if not csv_path.exists():
        print(f"Error: CSV file not found: {csv_path}")
        sys.exit(1)

    df = pd.read_csv(csv_path)
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp')
    return df


def plot_apy(df: pd.DataFrame, output_path: Path | None = None) -> None:
    """Create APY visualization."""
    fig, ax = plt.subplots(figsize=(12, 6))

    # Plot APY line
    ax.plot(df['timestamp'], df['realisticApy'], 'b-', linewidth=1.5, label='Realistic APY (VWAP)')

    # Fill positive/negative areas
    ax.fill_between(
        df['timestamp'],
        df['realisticApy'],
        0,
        where=(df['realisticApy'] >= 0),
        color='green',
        alpha=0.3,
        label='Positive APY'
    )
    ax.fill_between(
        df['timestamp'],
        df['realisticApy'],
        0,
        where=(df['realisticApy'] < 0),
        color='red',
        alpha=0.3,
        label='Negative APY'
    )

    # Zero line
    ax.axhline(y=0, color='black', linestyle='-', linewidth=0.5)

    # Labels and title
    ax.set_xlabel('Time', fontsize=12)
    ax.set_ylabel('APY (%)', fontsize=12)
    ax.set_title('Realistic APY (VWAP) Over Time', fontsize=14, fontweight='bold')

    # Format x-axis dates
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%m/%d %H:%M'))
    ax.xaxis.set_major_locator(mdates.AutoDateLocator())
    plt.xticks(rotation=45, ha='right')

    # Grid
    ax.grid(True, alpha=0.3)

    # Legend
    ax.legend(loc='best')

    # Stats annotation
    current_apy = df['realisticApy'].iloc[-1]
    min_apy = df['realisticApy'].min()
    max_apy = df['realisticApy'].max()
    mean_apy = df['realisticApy'].mean()
    data_points = len(df)

    stats_text = (
        f"Current: {current_apy:.4f}%\n"
        f"Min: {min_apy:.4f}%\n"
        f"Max: {max_apy:.4f}%\n"
        f"Mean: {mean_apy:.4f}%\n"
        f"Points: {data_points}"
    )

    box_x = 0.02 if current_apy < 0 else 0.98
    box_ha = 'left' if current_apy < 0 else 'right'

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
    parser = argparse.ArgumentParser(description='Visualize opportunity APY')
    parser.add_argument(
        '--csv',
        type=Path,
        default=Path('data/opportunities.csv'),
        help='Path to opportunities CSV file (default: data/opportunities.csv)'
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

    plot_apy(df, args.output)


if __name__ == '__main__':
    main()
