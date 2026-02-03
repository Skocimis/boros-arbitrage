# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Cross-exchange funding rate arbitrage system that utilizes Boros markets to fix funding. On one leg, pay fixed and receive floating; on the other, pay floating and receive fixed. These cancel out with perp positions on the corresponding exchanges, leaving a delta-neutral fixed APY position equal to the Implied APR spread between exchanges.

## Commands

```bash
npm run build          # TypeScript compilation (tsc)
npm run typecheck      # Type-check without emitting (tsc --noEmit)
npm run start          # Run compiled output (node dist/index.js)
npm run clean          # Remove build output (rm -rf dist)
npm run dev            # Run strategy calculation demo (src/index.ts)
npm run scan           # One-shot arbitrage opportunity scanner
npm run monitor        # Continuous monitoring dashboard (60s polling)
npm run track          # Continuous PnL tracker (5-minute intervals, CSV logging)
npm run opportunities  # Continuous APY tracker for ETH27Mar at 0.5 size (5-minute intervals, CSV logging)
```

Scripts are run directly with tsx (no build step needed for development):
```bash
npx tsx src/scripts/getAPY.ts <STRATEGY> <SIZE>
npx tsx src/scripts/openPosition.ts <STRATEGY> <SIZE>
npx tsx src/scripts/trackStrategy.ts <STRATEGY>
npx tsx src/scripts/borosTrade.ts <SIDE> <MARKET_ID> <SIZE>
npx tsx src/scripts/hyperliquidShort.ts <TICKER> <SIZE>
npx tsx src/scripts/okxLong.ts <TICKER> <SIZE>
npx tsx src/scripts/setHyperliquidLeverage.ts <TICKER> <LEVERAGE>
npx tsx src/market-inspector.ts <MARKET_ID> ...
```

No test framework is configured. There are no lint or format scripts.

## Architecture

### Four-Leg Strategy

The core strategy opens 4 simultaneous positions so all floating rates cancel, leaving a fixed yield equal to the Implied APR spread:

1. **Short YU on Boros** (higher-APR exchange) — pay floating, receive fixed
2. **Short Perp on that exchange** — receive floating funding (cancels leg 1 floating)
3. **Long YU on Boros** (lower-APR exchange) — receive floating, pay fixed
4. **Long Perp on that exchange** — pay floating funding (cancels leg 3 floating)

Legs 2 + 4 also provide delta-neutrality on the underlying asset price.

### Key Components

- **Opportunity layer** (`src/arbitrage-scanner.ts`, `src/arbitrage-monitor.ts`): Fetches all Boros markets, identifies same-asset pairs across exchanges, calculates Implied APR spreads and TSI (Total Slippage Impact) at various sizes.
- **Strategy config** (`src/config/strategies.ts`): Defines strategies mapping a name to Boros market IDs, exchange selections (HL/OKX), and ticker. Add new strategies to the `STRATEGIES` record.
- **Execution scripts** (`src/scripts/`): Single-purpose CLI tools. `openPosition.ts` coordinates all 4 legs in parallel via `Promise.all()`. Exchange-specific scripts handle individual legs.
- **DEX client abstraction** (`src/lib/DexClient.ts`): Abstract base class with `getBalance()`, `order()`, `getFunding()`. `BinanceClient` is partially implemented; `HyperliquidClient` is a skeleton. Full Hyperliquid trading uses `@nktkas/hyperliquid` SDK directly in scripts.
- **Boros API helpers** (`lib/functions/`): Typed HTTP wrappers for market and order book endpoints.
- **Tracking** (`src/strategy-tracker.ts`, `src/scripts/trackStrategy.ts`): Fetches balances/positions from all venues, calculates real PnL, logs to `data/pnl.csv`.
- **Opportunity tracking** (`src/opportunity-tracker.ts`): Periodically fetches VWAP APY for a strategy and logs to `data/opportunities.csv`.
- **Visualization helpers** (`helpers/`): Python scripts for charting CSV data. `visualize-pnl.py` plots PnL over time; `visualize-opportunities.py` plots realistic APY over time. Require `pandas` and `matplotlib`.

### File Map

| Path | Purpose |
|------|---------|
| `src/index.ts` | Strategy calculation demo (`npm run dev`) |
| `src/arbitrage-scanner.ts` | One-shot cross-exchange opportunity scanner (`npm run scan`) |
| `src/arbitrage-monitor.ts` | Continuous monitoring dashboard with TSI tracking (`npm run monitor`) |
| `src/strategy-tracker.ts` | Continuous PnL tracker with CSV logging (`npm run track`) |
| `src/opportunity-tracker.ts` | Continuous APY tracker with CSV logging (`npm run opportunities`) |
| `src/market-inspector.ts` | CLI tool to inspect Boros market details |
| `src/config/strategies.ts` | Strategy definitions mapping names to market IDs, exchanges, tickers |
| `src/lib/DexClient.ts` | Abstract base class: `getBalance()`, `order()`, `getFunding()` |
| `src/lib/BinanceClient.ts` | Binance Futures client (partial: balance + funding, no order) |
| `src/lib/HyperliquidClient.ts` | Hyperliquid client (skeleton: funding only) |
| `src/scripts/getAPY.ts` | Calculate APY and slippage for a strategy at a given size |
| `src/scripts/openPosition.ts` | Open full 4-legged strategy position across all venues |
| `src/scripts/trackStrategy.ts` | Track an active strategy position across all venues |
| `src/scripts/borosTrade.ts` | Open a long or short YU position on Boros |
| `src/scripts/hyperliquidShort.ts` | Open a short perp position on Hyperliquid |
| `src/scripts/okxLong.ts` | Open a long perp position on OKX |
| `src/scripts/setHyperliquidLeverage.ts` | Set leverage for an asset on Hyperliquid |
| `lib/functions/getMarketById.ts` | Boros API: fetch market by ID with full type definitions |
| `lib/functions/getOrderBookByMarketId.ts` | Boros API: fetch order book (parallel arrays: `ia[]`, `sz[]`) |
| `helpers/visualize-pnl.py` | Chart PnL history from `data/pnl.csv` |
| `helpers/visualize-opportunities.py` | Chart APY history from `data/opportunities.csv` |

### Conventions and Gotchas

**Boros API:**
- Order books use **parallel arrays** (`ia[]` for Implied APR in basis points, `sz[]` for size in wei). Divide `ia` by 10,000 for decimal APR, `sz` by 1e18 for token amount.
- API field `"long"` = bid side (for shorting YU); `"short"` = ask side (for longing YU).
- Market states: `Normal`, `CloseOnly`, `Paused`, `Settled`. Only `Normal` markets are tradeable.

**APR vs APY terminology:**
- **Implied APR** = the fixed rate on an individual Boros market (what order books trade).
- **Underlying APR** = the floating funding rate from the perpetual exchange.
- **APY** (in this codebase) = the net spread of a strategy (shortImpliedAPR - longImpliedAPR). This is the strategy's fixed yield.

**Size units — not uniform across scripts:**
- `getAPY.ts`, `openPosition.ts`, `hyperliquidShort.ts`, `okxLong.ts`: size in **asset units** (e.g., 0.01 = 0.01 ETH).
- `borosTrade.ts`: size in **YU notional ($)** (e.g., 1000 = $1000 collateral).

**Funding rate annualization:**
- Binance: `rate * 3 * 365` (8h intervals).
- Hyperliquid: `rate * 24 * 365` (1h intervals).

**Execution details:**
- Slippage buffers: 0.5% (Hyperliquid), 0.6% absolute (Boros) with IOC orders.
- `openPosition.ts` fires all 4 legs via `Promise.all()` — no rollback on partial failure.
- Hardcoded asset prices in `arbitrage-monitor.ts`: BTC=$100k, ETH=$3k, BNB=$1k (used for USD size conversion in TSI calculations).
- Strategy name `"ETH27Mar"` is hardcoded in `strategy-tracker.ts` and `opportunity-tracker.ts`.

**Subaccount signing (Hyperliquid):**
- Master account (`PRIVATE_KEY`) signs all transactions with the `vaultAddress` parameter set to `HYPERLIQUID_SUBACCOUNT`. Positions and margin live on the subaccount.

## Boros Indexer (`boros-indexer/`)

Standalone service that indexes all Boros markets and their 5-minute candle data into MongoDB, keeps data fresh with hourly updates, and exposes a REST API.

### Commands

```bash
cd boros-indexer
npm run dev            # Run with tsx (development)
npm run build          # TypeScript compilation
npm run start          # Run compiled output
npm run typecheck      # Type-check without emitting
```

### Prerequisites

- MongoDB running locally on `mongodb://localhost:27017` (override with `MONGO_URI` env var)
- Port 3001 available (override with `PORT` env var)

### REST API

- `GET /get-markets` — returns all market documents sorted by `marketId`, with `startTime` (earliest candle timestamp). Excludes internal fields (`_id`, `lastCandleTs`, `lastUpdatedAt`). No candle data in response.

### Architecture

| Path | Purpose |
|------|---------|
| `src/index.ts` | Entry point: connect DB, initial sync, start server + scheduler |
| `src/server.ts` | Express server with `GET /get-markets` |
| `src/config.ts` | Constants: URLs, DB name, delays, port, lookback |
| `src/types.ts` | TypeScript interfaces (BorosMarket, Candle, DB documents) |
| `src/db/connection.ts` | MongoDB client singleton |
| `src/db/collections.ts` | Typed collection accessors + index creation |
| `src/api/borosClient.ts` | Boros API: market list, market detail, chunked candle fetching |
| `src/indexer/marketIndexer.ts` | Market discovery: paginate list, iterate 1..maxId, fetch details |
| `src/indexer/candleIndexer.ts` | Candle backfill (full history) and incremental updates |
| `src/indexer/scheduler.ts` | Hourly `setInterval` coordinator |
| `src/util/retry.ts` | Generic retry with exponential backoff (3 attempts, 1s/2s/4s) |
| `src/util/sleep.ts` | Sleep helper |
| `src/util/logger.ts` | Timestamped console logger |

### MongoDB Collections

- **`markets`** — one doc per market. Full `GET /v1/markets/{id}` response plus `startTime`, `lastCandleTs`, `lastUpdatedAt`. Indexes: `{ marketId: 1 }` unique, `{ metadata.platformName: 1, metadata.name: 1 }`.
- **`candles`** — one doc per candle per market. All chart API fields (`ts`, `o`, `h`, `l`, `c`, `v`, `u`, `mr`, `ofr`, `b7dmafr`, `b30dmafr`, `fp`) plus `marketId`. Indexes: `{ marketId: 1, ts: 1 }` unique, `{ marketId: 1, ts: -1 }`.

### Startup Sequence

1. Connect MongoDB, ensure indexes
2. Discover markets via paginated `GET /v1/markets?isWhitelisted=true`, compute maxId
3. Fetch details for each market 1..maxId (100ms delay, 404s skipped), upsert to DB
4. Backfill candles for each market: initial run scans from 1 year ago in 150,000s chunks (50ms between chunks, 200ms between markets), skipping empty chunks until data is found
5. Start Express server on port 3001
6. Start hourly scheduler (re-indexes markets + incremental candle updates)

### Conventions and Gotchas

- **Boros chart API returns max ~500 candles per request.** Fetching uses 150,000-second chunks (500 × 5min) and pages through by advancing the cursor to `lastCandle.ts + 300`.
- **Empty chunk handling:** Before data is found, empty chunks advance the cursor forward (scanning). After data is found, an empty chunk means end-of-data and breaks the loop.
- **Initial backfill lookback** is 1 year (`INITIAL_LOOKBACK` in config). This covers all possible market history.
- **All DB writes are upserts** — restarts are safe and idempotent.
- **Rate limiting delays:** 100ms between market detail fetches, 50ms between candle chunks, 200ms between markets for candle operations.
- **Separate `package.json`** — the indexer has its own dependencies (`express`, `mongodb`). Run `npm install` inside `boros-indexer/` before use.

## Tech Stack

- **Runtime**: Node.js >= 22, ES Modules (`"type": "module"`)
- **Language**: TypeScript 5.7 with strict mode, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- **Execution**: `tsx` for running .ts files directly during development
- **Module resolution**: `NodeNext` — use `.js` extensions in import paths
- **Key deps**: `@pendle/sdk-boros`, `@pendle/boros-offchain-math`, `@nktkas/hyperliquid`, `viem` (wallet/signing), `axios`
- **Exchange auth**: HMAC-SHA256 for OKX and Binance REST APIs; viem `privateKeyToAccount` for Hyperliquid/Boros signing

## Environment

Requires `.env` file (see `.env.example`). Key variables: `PRIVATE_KEY`, `HYPERLIQUID_SUBACCOUNT`, `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_API_PASSPHRASE`. Optional: `BOROS_ACCOUNT_ID` (default 0), `BOROS_RPC_URL`.
