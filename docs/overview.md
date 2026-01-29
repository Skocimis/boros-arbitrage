# System Overview

Cross-exchange funding rate arbitrage system utilizing Boros markets to fix funding. On one leg, pay fixed and receive floating; on the other, pay floating and receive fixed. These cancel out with perp positions on the corresponding exchanges, leaving a delta-neutral fixed APY position.

## Key Concepts

### Yield Units (YUs)

Boros facilitates Interest Rate Swaps onchain through **Yield Units (YUs)**. One YU represents one notional unit of a perp market's funding rate. This enables converting volatile funding rates into fixed yields.

- **Long YU**: Receive floating (Underlying APR), pay fixed (Implied APR)
- **Short YU**: Pay floating (Underlying APR), receive fixed (Implied APR)
- Pairing YU + Perp position cancels floating rate, leaving only fixed rate

### APR Types

- **Implied APR**: The fixed rate locked in when trading YUs (what Boros order books trade)
- **Underlying APR**: The floating funding rate from the perpetual exchange
- **Arbitrage profit** = Spread between Implied APRs on different exchanges for the same asset

### TSI (Total Slippage Impact)

Measures execution cost across both Boros order books:

```
TSI = |longExecApr - longMid| + |shortMid - shortExecApr|
```

## Planned System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Automated Execution Layer                            │
│                            (future: main.ts)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
          ┌──────────────────────────┼──────────────────────────┐
          ▼                          ▼                          ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  Opportunity Layer  │  │   Execution Layer   │  │     Risk Layer      │
│                     │  │                     │  │                     │
│ - Funding scanner   │  │ - Boros legs (2)    │  │ - Liquidation dist  │
│ - Rate comparison   │  │ - DEX legs (2)      │  │ - Real leverage     │
│ - Entry/exit signal │  │ - Position sizing   │  │ - Margin monitoring │
│                     │  │ - Order execution   │  │ - Emergency close   │
│ (partial: scanner)  │  │ (partial: scripts)  │  │ (planned)           │
└─────────────────────┘  └─────────────────────┘  └─────────────────────┘
```

## Four-Leg Strategy

The strategy captures the spread between Implied APRs on Boros markets for the same asset across different exchanges, locking in a fixed yield with zero directional exposure.

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

---

## Current Implementation

### Hyperliquid Scripts (`src/scripts/`)

CLI utilities for manual Hyperliquid operations on the configured subaccount.

#### setHyperliquidLeverage.ts

Sets leverage for an asset on Hyperliquid.

```bash
npx tsx src/scripts/setHyperliquidLeverage.ts <TICKER> <LEVERAGE>
npx tsx src/scripts/setHyperliquidLeverage.ts ETH 2
```

- Fetches asset metadata to resolve ticker → asset index
- Submits `updateLeverage` via ExchangeClient
- Uses cross-margin mode
- Executes on the subaccount specified by `HYPERLIQUID_SUBACCOUNT` env var

#### hyperliquidShort.ts

Opens a short position on Hyperliquid with market-like execution.

```bash
npx tsx src/scripts/hyperliquidShort.ts <TICKER> <SIZE>
npx tsx src/scripts/hyperliquidShort.ts ETH 0.01
```

- Fetches current mid price
- Applies 0.5% slippage for IOC execution
- Formats price/size per Hyperliquid tick rules (5 sig figs, decimal limits)
- Executes on subaccount

### OKX Scripts (`src/scripts/`)

CLI utilities for manual OKX perpetual swap operations.

#### okxLong.ts

Opens a long position on OKX perpetual swaps with market execution.

```bash
npx tsx src/scripts/okxLong.ts <TICKER> <SIZE>
npx tsx src/scripts/okxLong.ts ETH 0.1
```

- Size is in base asset (e.g., 0.1 = 0.1 ETH), automatically converted to contracts
- Fetches instrument info (lot size, min size, contract value)
- Validates size against minimum and rounds to valid lot size
- Places market buy order with cross-margin mode
- Shows notional value in USD before execution
- Uses OKX REST API with HMAC-SHA256 authentication

**Note:** For ETH-USDT-SWAP, 1 contract = 0.01 ETH, so 0.1 ETH = 10 contracts.

### Boros Scripts (`src/scripts/`)

CLI utilities for Boros Yield Unit (YU) trading operations.

#### borosTrade.ts

Opens a long or short YU position on Boros markets.

```bash
npx tsx src/scripts/borosTrade.ts <SIDE> <MARKET_ID> <SIZE>
npx tsx src/scripts/borosTrade.ts long 31 1000
npx tsx src/scripts/borosTrade.ts short 33 500
```

- SIDE: `long` (receive floating, pay fixed) or `short` (pay floating, receive fixed)
- MARKET_ID: Boros market ID (use scanner to discover available markets)
- SIZE: Position size in YU tokens (1 YU = 1 notional unit of funding rate)
- Fetches market data to validate state and get tick parameters
- Uses order book to calculate limit price with 0.6% absolute slippage (rate ± 0.6%)
- Places IOC (Immediate-or-Cancel) order for market-like execution
- Uses official @pendle/sdk-boros SDK for transaction signing

**Environment variables:**
- `PRIVATE_KEY`: Wallet private key (required)
- `BOROS_ACCOUNT_ID`: Boros account ID (default: 0)
- `BOROS_RPC_URL`: Arbitrum RPC URL (default: public RPC)

### Strategy Scripts (`src/scripts/`)

CLI utilities for strategy analysis and execution.

#### getAPY.ts

Calculates real APY and slippage for a strategy at a given position size.

```bash
npx tsx src/scripts/getAPY.ts <STRATEGY_NAME> <SIZE>
npx tsx src/scripts/getAPY.ts ETH27Mar 100
```

- STRATEGY_NAME: Strategy from `src/config/strategies.ts` (e.g., "ETH27Mar")
- SIZE: Position size in asset units (e.g., 100 = 100 ETH)
- Fetches market data and order books for both Boros markets
- Calculates three APY estimates:
  - **Optimistic (market mid)**: shortMidApr - longMidApr
  - **Pessimistic (worst exec)**: shortExecApr - longExecApr (walks order book to SIZE)
  - **Realistic (VWAP)**: shortVwapApr - longVwapApr (volume-weighted average)
- Calculates TSI at worst-price and VWAP levels
- Displays available liquidity on both order book sides

#### openPosition.ts

Opens a full 4-legged strategy position across DEXes and Boros.

```bash
npx tsx src/scripts/openPosition.ts <STRATEGY_NAME> <SIZE>
npx tsx src/scripts/openPosition.ts ETH27Mar 0.01
```

- STRATEGY_NAME: Strategy from `src/config/strategies.ts`
- SIZE: Position size in asset units (e.g., 0.01 = 0.01 ETH)
- Creates Boros agent once, reuses for both YU positions
- Executes all 4 legs in parallel:
  - Leg 1: Short perp on shortDex (Hyperliquid)
  - Leg 2: Long perp on longDex (OKX)
  - Leg 3: Long YU on Boros
  - Leg 4: Short YU on Boros
- Reports detailed results for all legs

#### trackStrategy.ts

Tracks an active 4-legged strategy position across all venues.

```bash
npx tsx src/scripts/trackStrategy.ts <STRATEGY_NAME>
npx tsx src/scripts/trackStrategy.ts ETH27Mar
```

- STRATEGY_NAME: Strategy from `src/config/strategies.ts`
- Fetches data from Hyperliquid, OKX, and Boros in parallel
- Displays:
  - ETH price and implied APRs (long/short)
  - Liquidation prices (HL, OKX) and APRs (Boros)
  - Initial vs current balances (USD + ETH)
  - Real PnL calculation
- Also exports `trackStrategy()` function for programmatic use:
  ```typescript
  import { trackStrategy, StrategyTrackingResult } from "./trackStrategy.js";
  const result = await trackStrategy("ETH27Mar");
  ```

### Strategy Tracker (`src/strategy-tracker.ts`)

Continuous PnL tracking service with CSV logging.

```bash
npm run track
```

- Runs `trackStrategy("ETH27Mar")` every 5 minutes
- Creates `data/` directory and `pnl.csv` if they don't exist
- Appends timestamp and real PnL (3 decimal places) to CSV
- Shows live status in console

**CSV format:**
```csv
timestamp,realPnlUsd
2024-01-15T10:30:00.000Z,-0.098
2024-01-15T10:35:00.000Z,-0.087
```

### PnL Visualization (`helpers/visualize-pnl.py`)

Python script to visualize PnL history as a chart. Located in the `helpers/` directory.

```bash
# Install dependencies
pip install -r helpers/requirements.txt

# Display chart interactively
python helpers/visualize-pnl.py

# Save chart to file
python helpers/visualize-pnl.py --output chart.png

# Use custom CSV path
python helpers/visualize-pnl.py --csv data/pnl.csv
```

- Plots PnL over time with profit/loss areas colored green/red
- Shows stats: current PnL, min, max, data points
- Supports saving to PNG file

### Strategy Configuration (`src/config/strategies.ts`)

Defines 4-legged arbitrage strategy configurations.

```typescript
import { getStrategy, listStrategies } from "../config/strategies.js";

const strategy = getStrategy("ETH27Mar");
const allStrategies = listStrategies(); // ["ETH27Mar", ...]
```

Each strategy specifies:
- `name`: Strategy identifier (e.g., "ETH27Mar")
- `ticker`: Underlying asset (e.g., "ETH")
- `shortDex`: Exchange for short perp ("HL" or "OKX")
- `longDex`: Exchange for long perp ("HL" or "OKX")
- `borosLongMarketId`: Boros market ID for long YU
- `borosShortMarketId`: Boros market ID for short YU

---

## Existing Implementations

### Opportunity Layer (`src/`)

Tools for discovering and monitoring arbitrage opportunities.

#### arbitrage-monitor.ts

Real-time monitoring dashboard with TSI (Total Slippage Impact) tracking.

```bash
npm run monitor
```

- Polls Boros API every 60 seconds
- Tracks current and historical max APY for each pair
- Calculates TSI at three size thresholds ($0, $100k, $1M)
- Computes VWAP-based "real APY" after execution slippage
- Saves best snapshots to `./snapshots/{shortId}-{longId}/`
- Displays live console table with opportunities

#### arbitrage-scanner.ts

One-shot scanner for cross-exchange opportunities.

```bash
npm run scan
```

- Fetches all Boros markets once
- Identifies same-asset pairs across different platforms
- Outputs top 20 opportunities sorted by net APY

#### market-inspector.ts

CLI tool to inspect specific market details.

```bash
npx tsx src/market-inspector.ts <market_id> ...
npx tsx src/market-inspector.ts 31 33 45
```

- Displays market name, platform, APR, state, expiry
- Accepts multiple market IDs as arguments

### DEX Client Library (`src/lib/`)

Abstract client implementations for exchange interactions.

| File | Description | Status |
|------|-------------|--------|
| `DexClient.ts` | Abstract base class with OrderSide, Asset enums | Complete |
| `BinanceClient.ts` | Binance Futures (getBalance, getFunding) | Partial (order not implemented) |
| `HyperliquidClient.ts` | Hyperliquid (getFunding only) | Skeleton |

**Note:** For full Hyperliquid trading, use scripts in `src/scripts/` which use `@nktkas/hyperliquid` SDK. For OKX trading, use `okxLong.ts` which uses the OKX REST API directly.

### Boros API Library (`lib/functions/`)

Typed functions for Boros API access.

| File | Description |
|------|-------------|
| `getMarketById.ts` | Fetch market by ID with full type definitions |
| `getOrderBookByMarketId.ts` | Fetch order book (parallel arrays: ia, sz) |

### Strategy Demo (`src/index.ts`)

Calculation demo showing four-leg funding arbitrage math with Yield Units.

```bash
npm run dev
```

- Fetches live funding rates (Underlying APR) from Binance and Hyperliquid
- Fetches Boros market Implied APRs
- Demonstrates how floating rates cancel when YU + Perp positions are paired
- Shows net fixed APY = Implied APR spread between exchanges

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PRIVATE_KEY` | Yes | Wallet private key for Hyperliquid and Boros signing |
| `HYPERLIQUID_SUBACCOUNT` | Yes | Hyperliquid subaccount address for trading |
| `BINANCE_API_KEY` | Yes | Binance API key |
| `BINANCE_API_SECRET` | Yes | Binance API secret |
| `OKX_API_KEY` | Yes | OKX API key |
| `OKX_SECRET_KEY` | Yes | OKX API secret key |
| `OKX_API_PASSPHRASE` | Yes | OKX API passphrase |
| `BOROS_ACCOUNT_ID` | No | Boros account ID (default: 0) |
| `BOROS_RPC_URL` | No | Arbitrum RPC URL (default: public RPC) |

### Subaccount Architecture

```
Master Account (PRIVATE_KEY)
    │
    │ signs with vaultAddress parameter
    ▼
Subaccount (HYPERLIQUID_SUBACCOUNT)
    │
    └── Isolated margin, positions, leverage settings
```

---

## Planned Components

### Opportunity Detection Layer
- Funding rate scanner across venues
- Rate differential calculation
- Entry/exit signal generation
- Historical rate analysis

### Execution Layer
- Synchronized multi-leg entry/exit
- Position sizing based on available margin
- Slippage management
- Order status tracking

### Risk Layer
- Real-time liquidation distance monitoring
- Effective leverage calculation
- Cross-venue margin utilization
- Emergency position closure
- PnL tracking (**implemented**: `npm run track`, `trackStrategy.ts`)

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@pendle/sdk-boros` | Boros trading SDK |
| `@pendle/boros-offchain-math` | Rate/tick math utilities for Boros |
| `@nktkas/hyperliquid` | Hyperliquid SDK |
| `viem` | Ethereum wallet/signing |
| `axios` | HTTP client for Binance and OKX APIs |
| `dotenv` | Environment configuration |
