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
| `npm run dev` | Run strategy calculation demo |

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

Manual trading utilities for the perp leg execution.

```bash
# Set leverage
npx tsx src/scripts/setHyperliquidLeverage.ts ETH 2

# Open short position
npx tsx src/scripts/hyperliquidShort.ts ETH 0.01
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
PRIVATE_KEY=your_hyperliquid_private_key
HYPERLIQUID_SUBACCOUNT=your_hyperliquid_subaccount_address
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret
```

## Project Structure

```
Boros/
├── src/
│   ├── arbitrage-monitor.ts   # Continuous monitoring dashboard
│   ├── arbitrage-scanner.ts   # One-shot opportunity scanner
│   ├── market-inspector.ts    # Market detail CLI
│   ├── index.ts               # Strategy calculation demo
│   ├── lib/                   # DEX client implementations
│   └── scripts/               # Hyperliquid trading scripts
├── lib/functions/             # Boros API helpers
├── docs/overview.md           # Detailed architecture docs
└── snapshots/                 # Saved opportunity snapshots
```

## Resources

- [Cross-Exchange Funding Rate Arbitrage Strategy](https://medium.com/boros-fi/cross-exchange-funding-rate-arbitrage-a-fixed-yield-strategy-through-boros-c9e828b61215)
- [Boros App](https://app.boros.finance)

## License

ISC
