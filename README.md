# Cross-Exchange Funding Rate Arbitrage

Cross-exchange funding rate arbitrage system utilizing Boros markets to fix funding. On one leg, pay fixed and receive floating; on the other, pay floating and receive fixed. These cancel out with perp positions on the corresponding exchanges, leaving a delta-neutral fixed APY position.

## Overview

[Boros](https://boros.pendle.finance/) (by Pendle) facilitates Interest Rate Swaps onchain through **Yield Units (YUs)**. One YU represents one notional unit of a perp market's funding rate. This enables converting volatile funding rates into fixed yields.

This system captures the spread between Implied APRs on Boros markets for the same asset across different exchanges (e.g., Hyperliquid vs Binance), locking in a fixed yield with zero directional exposure.

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
| `npm run opportunities` | Continuous APY tracker (5-minute intervals, CSV logging) |
| `npm run dev` | Run strategy calculation demo |
| `npm run build` | TypeScript compilation |
| `npm run typecheck` | Type-check without emitting |
| `npm run clean` | Remove build output |
| `npx tsx src/scripts/getAPY.ts <STRATEGY> <SIZE>` | Calculate APY/TSI for a strategy |
| `npx tsx src/scripts/openPosition.ts <STRATEGY> <SIZE>` | Execute 4-leg strategy |
| `npx tsx src/scripts/trackStrategy.ts <STRATEGY>` | One-shot strategy position tracking |
| `npx tsx src/scripts/borosTrade.ts <SIDE> <MARKET_ID> <SIZE>` | Boros YU trading |
| `npx tsx src/scripts/hyperliquidShort.ts <TICKER> <SIZE>` | Hyperliquid short position |
| `npx tsx src/scripts/okxLong.ts <TICKER> <SIZE>` | OKX long position |
| `npx tsx src/scripts/setHyperliquidLeverage.ts <TICKER> <LEVERAGE>` | Set Hyperliquid leverage |
| `npx tsx src/market-inspector.ts <MARKET_ID> ...` | Inspect Boros market details |
| `python helpers/visualize-pnl.py` | Visualize PnL history chart |
| `python helpers/visualize-opportunities.py` | Visualize APY history chart |

## Key Concepts

### Yield Units (YUs)

- **Long YU**: Receive floating (Underlying APR), pay fixed (Implied APR)
- **Short YU**: Pay floating (Underlying APR), receive fixed (Implied APR)
- Pairing YU + Perp position cancels floating rate, leaving only fixed rate

### Implied APR vs APY

- **Implied APR**: The fixed rate on an individual Boros market (what order books trade)
- **APY** (in this codebase): The net spread of a strategy — the fixed yield after combining both legs

### TSI (Total Slippage Impact)

Measures execution cost across both Boros order books:

```
TSI = |longExecApr - longMid| + |shortMid - shortExecApr|
```

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
│   ├── opportunity-tracker.ts # Continuous APY tracker (npm run opportunities)
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
│   ├── visualize-opportunities.py # APY chart visualization
│   └── requirements.txt       # Python dependencies
├── data/                      # PnL tracking data (gitignored)
│   ├── pnl.csv                # Strategy PnL history
│   └── opportunities.csv      # APY tracking history
└── snapshots/                 # Saved opportunity snapshots
```

## Resources

- [Cross-Exchange Funding Rate Arbitrage Strategy](https://medium.com/boros-fi/cross-exchange-funding-rate-arbitrage-a-fixed-yield-strategy-through-boros-c9e828b61215)
- [Boros App](https://boros.pendle.finance/)

## License

ISC
