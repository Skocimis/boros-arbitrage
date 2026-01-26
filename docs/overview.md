# Boros System Overview

System for executing delta-neutral, fixed-yield funding rate arbitrage using Boros Yield Units (YUs) across perpetual exchanges.

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

**Note:** For full Hyperliquid trading, use scripts in `src/scripts/` which use `@nktkas/hyperliquid` SDK.

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
| `PRIVATE_KEY` | Yes | Master account private key for Hyperliquid |
| `HYPERLIQUID_SUBACCOUNT` | Yes | Hyperliquid subaccount address for trading |
| `BINANCE_API_KEY` | Yes | Binance API key |
| `BINANCE_API_SECRET` | Yes | Binance API secret |

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
- PnL tracking

---

## Dependencies

| Package | Purpose |
|---------|---------|
| `@nktkas/hyperliquid` | Hyperliquid SDK |
| `viem` | Ethereum wallet/signing |
| `axios` | HTTP client for Binance API |
| `dotenv` | Environment configuration |
