# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Boros is a cross-exchange funding rate arbitrage system that executes delta-neutral, fixed-yield strategies using Boros Yield Units (YUs) across perpetual exchanges (Hyperliquid, OKX, Binance). It locks in fixed yield by exploiting Implied APR spreads on Boros markets for the same asset across different exchanges.

## Commands

```bash
npm run dev          # Run strategy calculation demo (tsx, no compile)
npm run build        # Compile TypeScript (tsc)
npm run start        # Run compiled output
npm run typecheck    # Type check only (tsc --noEmit)
npm run scan         # One-shot arbitrage opportunity scanner
npm run monitor      # Real-time monitoring dashboard (60s polling)
npm run track        # Continuous PnL tracker (5-min intervals, CSV to data/pnl.csv)
```

Individual scripts are run via `npx tsx src/scripts/<script>.ts <args>`. Key ones:
- `getAPY.ts <STRATEGY> <SIZE>` — APY/slippage calculator for entry assessment
- `openPosition.ts <STRATEGY> <SIZE>` — Execute full 4-leg strategy in parallel
- `trackStrategy.ts <STRATEGY>` — One-shot position tracking across all venues
- `borosTrade.ts <SIDE> <MARKET_ID> <SIZE>` — Manual Boros YU trade
- `hyperliquidShort.ts <TICKER> <SIZE>` — Manual Hyperliquid short
- `okxLong.ts <TICKER> <SIZE>` — Manual OKX long

## Tech Stack

- **TypeScript** (strict mode, ES2022 target, ESM via NodeNext)
- **Node.js >=22.0.0**, **npm**
- **Key deps:** `@pendle/sdk-boros`, `@pendle/boros-offchain-math`, `@nktkas/hyperliquid`, `viem`, `axios`
- No test framework, no linter configured

## Architecture

### Four-Leg Strategy Pattern

Each strategy opens 4 simultaneous positions to achieve delta-neutral fixed yield:

1. **Short perp** on one DEX (e.g., Hyperliquid) — receive floating funding
2. **Long perp** on another DEX (e.g., OKX) — pay floating funding
3. **Long YU** on Boros — receive floating, pay fixed (Implied APR)
4. **Short YU** on Boros — pay floating, receive fixed (Implied APR)

Floating rates cancel out. Net yield = high Implied APR - low Implied APR.

### DexClient Abstraction (`src/lib/DexClient.ts`)

Abstract base class with `getBalance()`, `order()`, `getFunding()` methods. Implementations: `BinanceClient` (partial), `HyperliquidClient` (skeleton). Full trading for Hyperliquid/OKX is done through the scripts in `src/scripts/` using their respective SDKs/REST APIs directly.

### Strategy Registry (`src/config/strategies.ts`)

Strategies are defined in the `STRATEGIES` record. Each strategy specifies the ticker, which DEX is short/long, and the two Boros market IDs. To add a strategy, add an entry to this record.

### Script Dual-Mode Pattern

All execution scripts (`borosTrade.ts`, `hyperliquidShort.ts`, `okxLong.ts`) work both as CLI tools (`npx tsx script.ts <args>`) and as importable modules. This allows `openPosition.ts` to compose them programmatically.

### Order Execution

- All orders use IOC (Immediate-or-Cancel) for market-like execution
- Boros slippage: 0.6 percentage points absolute (rate ± 0.6%)
- Hyperliquid slippage: 50 basis points (0.5%)
- OKX: market orders directly
- `openPosition.ts` executes all 4 legs via `Promise.all()` — no rollback on partial failure

### Funding Rate Annualization

Rates are annualized differently per exchange:
- **Binance**: `fundingRate * 3 * 365` (8-hour intervals)
- **Hyperliquid**: `fundingRate * 24 * 365` (hourly intervals)
- **Boros**: Implied APRs are already annualized decimals

### Key Boros Concepts

- **Order book structure**: parallel arrays — `ia[]` (Implied APR in basis points), `sz[]` (size in wei)
- **VWAP**: `Σ(levelSize × levelApr) / totalSize`
- **TSI (Total Slippage Impact)**: `|longExecApr - longMid| + |shortMid - shortExecApr|`
- Only trade markets in "Normal" state (not CloseOnly, Paused, or Settled)
- Boros agent creation requires ETH on Arbitrum for gas — create once and reuse

### Data

- PnL history: `data/pnl.csv` (timestamp,realPnlUsd) — gitignored
- Monitor snapshots: `snapshots/{shortId}-{longId}/`
- `trackStrategy.ts` has hardcoded `INITIAL_BALANCES` — must be updated when opening new positions

## Environment

Required in `.env` (copy from `.env.example`):
- `PRIVATE_KEY`, `HYPERLIQUID_SUBACCOUNT` — wallet/subaccount
- `BINANCE_API_KEY`, `BINANCE_API_SECRET` — Binance
- `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_API_PASSPHRASE` — OKX
- Optional: `BOROS_ACCOUNT_ID` (default 0), `BOROS_RPC_URL` (default public Arbitrum RPC)
