# Boros - Cross-Exchange Funding Rate Arbitrage

System for executing delta-neutral, fixed-yield funding rate arbitrage using Boros Yield Units (YUs) across perpetual exchanges.

## Overview

Boros facilitates Interest Rate Swaps onchain through **Yield Units (YUs)**. One YU represents one notional unit of a perp market's funding rate. This enables converting volatile funding rates into fixed yields.

The strategy captures the spread between Implied APRs on Boros markets for the same asset across different exchanges (e.g., Hyperliquid vs Binance), locking in a fixed yield with zero directional exposure.

## The Four-Leg Strategy

When Hyperliquid has a higher Implied APR than Binance:

| Leg | Venue | Position | Effect |
|-----|-------|----------|--------|
| A | Boros (Hyperliquid) | Short YU | Pay floating, receive fixed (higher rate) |
| B | Hyperliquid | Short Perp | Receive floating funding |
| C | Boros (Binance) | Long YU | Receive floating, pay fixed (lower rate) |
| D | Binance | Long Perp | Pay floating funding |

**Result:**
- A + B = Receive fixed funding on Hyperliquid (floating cancels)
- C + D = Pay fixed funding on Binance (floating cancels)
- B + D = Delta-neutral on asset price
- **Net**: Fixed yield = Hyperliquid Implied APR - Binance Implied APR

## Quick Start

```bash
# Install dependencies
npm install

# Configure credentials
cp .env.example .env
# Edit .env with your API keys

# Scan for opportunities (one-shot)
npm run scan

# Monitor opportunities (continuous)
npm run monitor
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run scan` | One-shot scan of arbitrage opportunities |
| `npm run monitor` | Continuous monitoring with TSI analysis |
| `npm run track` | Track active strategy PnL every 5 minutes |
| `npm run dev` | Run strategy calculation demo |
| `npx tsx src/scripts/getAPY.ts <STRATEGY> <SIZE>` | Calculate APY/TSI for a strategy |
| `npx tsx src/scripts/openPosition.ts <STRATEGY> <SIZE>` | Execute 4-leg strategy |
| `npx tsx src/scripts/trackStrategy.ts <STRATEGY>` | One-shot strategy position tracking |
| `python helpers/visualize-pnl.py` | Visualize PnL history chart |

## CLI Tools

### Arbitrage Monitor

Real-time dashboard tracking Implied APR spreads with slippage analysis.

```bash
npm run monitor
```

- Polls Boros markets every 60 seconds
- Tracks current and max APY spreads per pair
- Calculates TSI (Total Slippage Impact) at $0, $100k, $1M sizes
- Computes VWAP-based "real APY" after order book slippage
- Saves best snapshots to `./snapshots/`

### Arbitrage Scanner

Quick scan of current opportunities.

```bash
npm run scan
```

### Market Inspector

Inspect specific Boros market details.

```bash
npx tsx src/market-inspector.ts <market_id> ...
```

### Hyperliquid Scripts

Manual trading utilities for the Hyperliquid perp leg execution.

```bash
# Set leverage
npx tsx src/scripts/setHyperliquidLeverage.ts ETH 2

# Open short position
npx tsx src/scripts/hyperliquidShort.ts ETH 0.01
```

### OKX Scripts

Manual trading utilities for the OKX perp leg execution.

```bash
# Open long position (size in base asset, e.g., 0.1 ETH)
npx tsx src/scripts/okxLong.ts ETH 0.1
```

- Size is in base asset (e.g., ETH), automatically converted to contracts
- Fetches instrument info and validates against minimum size
- Rounds to valid contract lot size
- Places market order with cross-margin mode
- Shows notional value before execution

### Boros Scripts

Manual trading utilities for Boros Yield Unit (YU) positions.

```bash
# Open long YU position (receive floating, pay fixed)
npx tsx src/scripts/borosTrade.ts long 31 1000

# Open short YU position (pay floating, receive fixed)
npx tsx src/scripts/borosTrade.ts short 33 500
```

- SIDE: `long` or `short`
- MARKET_ID: Boros market ID (use `npm run scan` to see available markets)
- SIZE: Position size in YU tokens (collateral notional, e.g., 1000 = $1000)
- Uses IOC (Immediate-or-Cancel) for market-like execution
- Applies 0.6% absolute slippage (rate ± 0.6 percentage points)
- Validates market state (must be "Normal" to trade)

### Strategy Scripts

#### Entry Assessment (getAPY.ts)

Calculate real APY and slippage for a strategy at a given position size.

```bash
npx tsx src/scripts/getAPY.ts <STRATEGY_NAME> <SIZE>
npx tsx src/scripts/getAPY.ts ETH27Mar 100
```

- SIZE is in asset units (e.g., 100 = 100 ETH)
- Shows optimistic (mid), pessimistic (worst exec), and realistic (VWAP) APY estimates
- Calculates TSI at worst-price and VWAP levels
- Displays available liquidity on both Boros order book sides

#### Open Position (openPosition.ts)

Execute a full 4-legged strategy position.

```bash
npx tsx src/scripts/openPosition.ts <STRATEGY_NAME> <SIZE>
npx tsx src/scripts/openPosition.ts ETH27Mar 0.01
```

- Opens all 4 legs in parallel: DEX short, DEX long, Boros short YU, Boros long YU
- Strategies defined in `src/config/strategies.ts`
- SIZE is in asset units (e.g., 0.01 = 0.01 ETH)

#### Track Strategy (trackStrategy.ts)

One-shot tracking of an active 4-leg strategy position.

```bash
npx tsx src/scripts/trackStrategy.ts <STRATEGY_NAME>
npx tsx src/scripts/trackStrategy.ts ETH27Mar
```

- Fetches balances and positions from Hyperliquid, OKX, and Boros
- Shows ETH price and implied APRs
- Displays liquidation prices/APRs for all 4 legs
- Calculates real PnL (current balances vs initial)

### Strategy Tracker

Continuous PnL tracking with CSV logging.

```bash
npm run track
```

- Runs `trackStrategy("ETH27Mar")` every 5 minutes
- Logs timestamp and real PnL to `data/pnl.csv`
- Shows live status in console

### PnL Visualization

Visualize PnL history from CSV data.

```bash
# Install Python dependencies
pip install -r helpers/requirements.txt

# Display chart
python helpers/visualize-pnl.py

# Save chart to file
python helpers/visualize-pnl.py --output chart.png

# Use custom CSV path
python helpers/visualize-pnl.py --csv data/pnl.csv
```

## Key Concepts

### Yield Units (YUs)

- **Long YU**: Receive floating (Underlying APR), pay fixed (Implied APR)
- **Short YU**: Pay floating (Underlying APR), receive fixed (Implied APR)
- Pairing YU + Perp position cancels floating rate, leaving only fixed rate

### TSI (Total Slippage Impact)

Measures execution cost across both Boros order books:

```
TSI = |longExecApr - longMid| + |shortMid - shortExecApr|
```

### Implied APR

The fixed rate locked in when trading YUs. The arbitrage profit is the spread between Implied APRs on different exchanges for the same asset.

## Environment Variables

```
# Trading credentials
PRIVATE_KEY=your_wallet_private_key
HYPERLIQUID_SUBACCOUNT=your_hyperliquid_subaccount_address
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret
OKX_API_KEY=your_okx_api_key
OKX_SECRET_KEY=your_okx_secret_key
OKX_API_PASSPHRASE=your_okx_api_passphrase

# Boros configuration (optional)
BOROS_ACCOUNT_ID=0
BOROS_RPC_URL=https://arb1.arbitrum.io/rpc
```

## Project Structure

```
Boros/
├── src/
│   ├── arbitrage-monitor.ts   # Continuous monitoring dashboard
│   ├── arbitrage-scanner.ts   # One-shot opportunity scanner
│   ├── strategy-tracker.ts    # Continuous PnL tracker (npm run track)
│   ├── market-inspector.ts    # Market detail CLI
│   ├── index.ts               # Strategy calculation demo
│   ├── config/
│   │   └── strategies.ts      # Strategy definitions (ETH27Mar, etc.)
│   ├── lib/                   # DEX client implementations
│   └── scripts/
│       ├── getAPY.ts          # Entry assessment (APY/TSI calculator)
│       ├── openPosition.ts    # 4-leg strategy execution
│       ├── trackStrategy.ts   # One-shot strategy tracking
│       ├── borosTrade.ts      # Boros YU trading
│       ├── hyperliquidShort.ts # Hyperliquid short positions
│       ├── okxLong.ts         # OKX long positions
│       └── setHyperliquidLeverage.ts
├── lib/functions/             # Boros API helpers
├── helpers/                   # Helper utilities (Python)
│   ├── visualize-pnl.py       # PnL chart visualization
│   └── requirements.txt       # Python dependencies
├── data/                      # PnL tracking data (gitignored)
│   └── pnl.csv                # Strategy PnL history
├── docs/overview.md           # Detailed architecture docs
└── snapshots/                 # Saved opportunity snapshots
```

## Resources

- [Cross-Exchange Funding Rate Arbitrage Strategy](https://medium.com/boros-fi/cross-exchange-funding-rate-arbitrage-a-fixed-yield-strategy-through-boros-c9e828b61215)
- [Boros App](https://boros.pendle.finance/)

## License

ISC
