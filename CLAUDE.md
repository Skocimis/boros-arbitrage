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
npx tsx src/scripts/okxMakerHlTaker.ts <STRATEGY>
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
- **Execution scripts** (`src/scripts/`): Single-purpose CLI tools. `openPosition.ts` coordinates all 4 legs in parallel via `Promise.all()`. `okxMakerHlTaker.ts` runs a maker/taker workflow: monitors OKX limit order fills and automatically fires the remaining 3 taker legs (HL perp + 2 Boros YU) on each new fill. Exchange-specific scripts handle individual legs.
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
| `src/scripts/okxMakerHlTaker.ts` | OKX maker + HL/Boros taker: monitors OKX fills, auto-hedges with 3 taker legs |
| `src/scripts/setHyperliquidLeverage.ts` | Set leverage for an asset on Hyperliquid |
| `lib/functions/getMarketById.ts` | Boros API: fetch market by ID with full type definitions |
| `lib/functions/getOrderBookByMarketId.ts` | Boros API: fetch order book (parallel arrays: `ia[]`, `sz[]`) |
| `helpers/visualize-pnl.py` | Chart PnL history from `data/pnl.csv` |
| `helpers/visualize-opportunities.py` | Chart APY history from `data/opportunities.csv` |

### Boros REST API Reference

Base URL: `https://api.boros.finance/core` — Swagger docs: `https://api.boros.finance/core/docs`

All read endpoints are public (no API key needed).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/markets?skip={n}&limit={n}&isWhitelisted=true` | GET | Paginated market list (limit max 100). Response: `{ results: Market[], total, skip }` |
| `/v1/markets/{marketId}` | GET | Full market detail: `imData`, `config`, `extConfig`, `metadata`, `data` (live stats), `platform`, `state` |
| `/v1/markets/chart?marketId={id}&timeFrame=5m&startTimestamp={s}&endTimestamp={e}` | GET | OHLCV candles. Response: `{ results: Candle[] }`. Max ~500 per request; paginate in 150,000s chunks |
| `/v1/markets/market-trades?marketId={id}&skip={n}&limit={n}` | GET | Recent trades. Response: `{ results: [{ size, rate, txHash, blockTimestamp }], total, skip }` |
| `/v1/order-books/{marketId}?tickSize={t}` | GET | Order book depth. Tick sizes: `0.00001`–`0.1`. Response: `{ long: { ia[], sz[] }, short: { ia[], sz[] } }` |

**Key response fields:**
- **Market**: `marketId`, `imData.maturity` (Unix s), `imData.tickStep`, `metadata.name` (pair e.g. `"ETHUSDT"`), `metadata.assetSymbol` (e.g. `"ETH"`), `metadata.platformName`, `data.markApr`, `data.floatingApr`, `data.assetMarkPrice`, `state`
- **Candle**: `ts` (Unix s), `o`/`h`/`l`/`c` (decimal APR), `v` (volume), `u` (underlying rate), `mr` (mark rate), `ofr` (oracle funding rate), `b7dmafr`/`b30dmafr` (moving averages), `fp` (funding payment)
- **Order book**: `ia[]` values in basis points (divide by 10,000 for decimal APR, or by 100,000 per the raw tick format); `sz[]` in wei (divide by 1e18)

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
- `okxMakerHlTaker.ts`: no size argument — sizes are derived from OKX fills. Asset size = `fillSz * ctVal` (contracts × contract value) for HL; Boros notional = `assetSize * fillPx` for Boros.

**Funding rate annualization:**
- Binance: `rate * 3 * 365` (8h intervals).
- Hyperliquid: `rate * 24 * 365` (1h intervals).

**Execution details:**
- Slippage buffers: 0.5% (Hyperliquid), 0.6% absolute (Boros) with IOC orders.
- `openPosition.ts` fires all 4 legs via `Promise.all()` — no rollback on partial failure.
- `okxMakerHlTaker.ts` polls OKX every 3s. First poll seeds `seenTradeIds` without hedging. Subsequent polls detect new fills by `tradeId` and fire 3 taker legs in parallel. Boros agent is created once at startup and reused. OKX BUY → Boros OKX LONG + HL SHORT + Boros HL SHORT; OKX SELL → reverse.
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

## Historical Frontend (`historical-frontend/`)

React SPA for analyzing historical arbitrage opportunities between two Boros markets. Users pick two markets from dropdowns, the app validates they share the same underlying asset and have overlapping date ranges, then loads candle data and displays implied APRs, spread, and configurable leverage-based profit/ROI projections.

### Commands

```bash
cd historical-frontend
npm run dev            # Vite dev server (default port 5173)
npm run build          # tsc -b && vite build (production bundle)
npm run preview        # Serve production build locally
npm run lint           # ESLint
```

### Prerequisites

- **boros-indexer running on port 3001** — the frontend fetches market data via a Vite dev-server proxy (`/indexer` -> `localhost:3001`). Without the indexer, market dropdowns will fail to load.

### Architecture

Market data flows from the boros-indexer (MongoDB) through the Vite proxy into the React app. Chart candle data is fetched directly from the Boros API (`api.boros.finance`).

```
boros-indexer:3001  <──proxy──  Vite dev server:5173  ──>  Boros chart API
       │                              │
   /get-markets               /indexer/get-markets
                              (rewritten to /)
```

| Path | Purpose |
|------|---------|
| `src/App.tsx` | Root component: market state, validation logic (asset match, startTime, date overlap), live market detail fetch (merges onto indexer data, preserving `startTime`), asset price state |
| `src/api.ts` | `fetchAllMarkets()` via indexer proxy, `fetchChartData()` via Boros chart API, `fetchMarketDetail()` |
| `src/types.ts` | `Market`, `Candle`, `AlignedDataPoint` interfaces |
| `src/components/MarketSelector.tsx` | Two dropdowns (sorted by marketId desc) + Load button; shows start date per market |
| `src/components/ErrorDisplay.tsx` | Conditional error banner |
| `src/components/ChartView.tsx` | Unified chart with `lightweight-charts`: Boros overlay (market APRs + spread) and leverage overlays (profit metrics), resolution switching (5m/30m/3h) |
| `src/components/MarketData.tsx` | Sidebar cards showing platform, state, maturity, APR, price, volume, OI for each selected market (live data) |
| `src/components/LeveragePanel.tsx` | Sidebar panel in a single unified card (`settings-panel-card`): leverage add/remove, Days held (slider + textbox), Size + Price (2-col grid, auto-fetched, editable, refresh button) with notional display, Fees input with estimate buttons and dollar annotations, Annualized ROI display |
| `src/components/LoadingSpinner.tsx` | Spinner with optional message |
| `src/fees.ts` | Fee types (`FeeMode`), DEX fee rate constants, Boros swap fee computation, taker-taker/maker-taker estimation |
| `src/leverageColors.ts` | Shared color palette and `leverageColor()` helper for leverage series |
| `vite.config.ts` | React plugin + `/indexer` proxy to `localhost:3001` |

### Data Flow

1. On mount, `fetchAllMarkets()` calls `/indexer/get-markets` (proxied to the boros-indexer). Returns full `Market[]` with `startTime`.
2. User selects two markets. On "Load":
   - Validates same `metadata.assetSymbol` (falls back to `metadata.name`).
   - Validates both markets have non-null `startTime` (i.e., candle data exists).
   - Validates date ranges `[startTime, maturity]` overlap between the two markets.
3. If validation passes, chart candle data is fetched directly from `api.boros.finance` in 150,000-second chunks (same pagination as the indexer).
4. `App.tsx` aligns candles by timestamp (inner join via `Map`), producing `AlignedDataPoint[]` with `|apr1 - apr2|` spread. Live market details are fetched via `fetchMarketDetail()` for both markets and merged onto indexer objects (preserving `startTime`), so sidebar cards show live volume/OI/APR.
5. `ChartView` renders a unified chart with:
   - 3 core line series: market 1 APR, market 2 APR (hidden by default), absolute spread
   - Configurable leverage series showing annualized ROI at each point in time
   - Horizontal overlay cards: one "Boros" card (toggle APR lines), plus one card per leverage (Collateral, Total Profit, Annualized APY — values update on hover; Collateral and Total Profit display in USD when asset price is available)
   - Resolution switching (5m / 30m / 3h via downsampling, default 3h) preserves visible time range

### Conventions and Gotchas

- **Vite proxy for CORS** — the indexer has no CORS headers. The `/indexer` prefix is stripped by the proxy rewrite rule, so `/indexer/get-markets` becomes `GET /get-markets` on port 3001. This only works in dev mode; a production deployment needs its own proxy or CORS configuration.
- **No axios** — the frontend uses native `fetch` throughout. No HTTP client dependency.
- **Separate `package.json`** — the frontend has its own dependencies (React 19, Vite 7). Run `npm install` inside `historical-frontend/` before use.
- **`startTime` field** — returned by the indexer as a Unix timestamp (seconds) or `null` if no candles exist. Displayed in dropdowns as a formatted date.
- **Asset matching** uses `metadata.assetSymbol` (e.g., `"ETH"`), not `metadata.name` (e.g., `"ETHUSDT"`). Falls back to `metadata.name` when `assetSymbol` is undefined.
- **`lightweight-charts` v5 API** — uses `chart.addSeries(LineSeries, options)` (not v4's `addLineSeries()`). Series removal via `chart.removeSeries(series)`.
- **Chart view preservation** — adding/removing leverage series and switching resolution save and restore the visible time range via `getVisibleRange()` / `setVisibleRange()`. Only initial data load calls `fitContent()`.
- **Platform colors** — Hyperliquid `#2dd4bf`, OKX `#d1d5db`, Spread `#2962ff`. Determined by `metadata.platformName`. Leverage series use a rotating palette from `leverageColors.ts`.
- **Fee estimation** (`fees.ts`) — `FeeMode` is `{ type: 'manual', amount } | { type: 'taker-taker', dexFee } | { type: 'maker-taker', dexFee }`. Maker-taker is auto-selected on market load. DEX fee = `2 * size * (rate1 + rate2)`. Boros swap fee = `size * 2 * 0.05% * (minMaturity - entryTimestamp) / (365 * 86400)` — varies per x-axis data point. DEX fee rates: Hyperliquid maker 0.01%/taker 0.035%, OKX/Gate/Binance maker 0.02%/taker 0.05%. `estimateMakerTaker()` tries both permutations and picks the lowest-cost combo.
- **Profit/ROI formulas** — Configurable inputs: Size, Days held, Fees (manual or estimated). Formulas:
  - `Fee = dexFee + size * 2 * 0.05% * (minMaturity - entryTimestamp) / (365 * 86400)` (estimated mode; manual mode uses flat amount)
  - `Profit = held_days / 365 * (spread - 0.0001) * size - fee`  (0.01% Boros OI fee)
  - `Collateral = 2 * size / leverage + 0.006 * size` (0.6% accounts for Boros initial margin requirement on both legs)
  - `Annualized APY = (Profit / Collateral) * (365 / held_days) * 100`
  - `held_days = min(days_remaining_to_maturity, user_days_held_input)`
  - `max_days = floor((min(maturity1, maturity2) - max(startTime1, startTime2)) / 86400)`
- **Live market details** — On market load, `App.tsx` fetches live details for both markets via `fetchMarketDetail()` and merges them onto indexer objects (`{ ...indexer, ...live, startTime: indexer.startTime }`). This gives sidebar cards fresh `data` (volume, OI, APR, price) while preserving the indexer-only `startTime` field. Markets display immediately with indexer data; live data overwrites once fetched.
- **Asset price & dollar display** — Asset price comes from the live detail fetch (`data.assetMarkPrice`) and is stored as `assetPrice` state. `LeveragePanel` shows an editable price input (with refresh button) and "Notional: $X" below it. Fee breakdown rows show inline `($X.XX)` dollar annotations. `ChartView` overlay cards display Collateral and Total Profit in USD when price is available, falling back to asset units (`.toFixed(4)`) when not. Price is `number | null` — all dollar displays are conditional on `assetPrice != null`.
- **Overlay cards** — displayed horizontally (side by side). Boros card toggles APR series visibility. Leverage cards show profit metrics that update reactively on crosshair hover (using hovered spread, falling back to average spread when not hovering).
- **Hover timestamp sharing** — `ChartView` emits the hovered timestamp to `App.tsx` via `onHoverTimestampChange`. `LeveragePanel` receives it and uses it for the fee breakdown (Boros swap, total, ROI). Fallback when not hovering is `Date.now()` (current time).
- **Chart effects architecture** — six separate `useEffect` hooks: (1) core chart + 3 series (depends on data/levels only — not markets, to avoid recreation on live detail fetch), (2) leverage series lifecycle (depends on leverages), (3) resolution switching (depends on activeRes), (4) leverage visibility toggle (depends on hiddenLeverages), (5) Boros series visibility toggle (depends on showBoros/show1/show2/showSpread), (6) leverage data update (depends on size/daysHeld/feeMode). This separation prevents chart recreation on parameter changes.

## Tech Stack

- **Runtime**: Node.js >= 22, ES Modules (`"type": "module"`)
- **Language**: TypeScript 5.7 with strict mode, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- **Execution**: `tsx` for running .ts files directly during development
- **Module resolution**: `NodeNext` — use `.js` extensions in import paths
- **Key deps**: `@pendle/sdk-boros`, `@pendle/boros-offchain-math`, `@nktkas/hyperliquid`, `viem` (wallet/signing), `axios`
- **Exchange auth**: HMAC-SHA256 for OKX and Binance REST APIs; viem `privateKeyToAccount` for Hyperliquid/Boros signing
- **Historical frontend**: React 19, Vite 7, lightweight-charts 5, TypeScript ~5.9. No external HTTP client (native `fetch`). Separate `package.json` in `historical-frontend/`

## Environment

Requires `.env` file (see `.env.example`). Key variables: `PRIVATE_KEY`, `HYPERLIQUID_SUBACCOUNT`, `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_API_PASSPHRASE`. Optional: `BOROS_ACCOUNT_ID` (default 0), `BOROS_RPC_URL`.
