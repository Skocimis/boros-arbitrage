# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Cross-exchange funding rate arbitrage system that utilizes Boros markets to fix funding. On one leg, pay fixed and receive floating; on the other, pay floating and receive fixed. These cancel out with perp positions on the corresponding exchanges, leaving a delta-neutral fixed APY position equal to the Implied APR spread between exchanges.

## Commands

```bash
npm run build          # TypeScript compilation (tsc)
npm run typecheck      # Type-check without emitting (tsc --noEmit)
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

### Boros API Conventions

- Order books use **parallel arrays** (`ia[]` for Implied APR in basis points, `sz[]` for size in wei). Divide `ia` by 10,000 for decimal APR, `sz` by 1e18 for token amount.
- API field `"long"` = bid side (for shorting YU); `"short"` = ask side (for longing YU).
- Funding rate annualization: Binance uses `rate * 3 * 365` (8h intervals); Hyperliquid uses `rate * 24 * 365` (1h intervals).
- Slippage: scripts apply 0.5% (Hyperliquid) or 0.6% absolute (Boros) slippage buffers with IOC orders.

## Tech Stack

- **Runtime**: Node.js >= 22, ES Modules (`"type": "module"`)
- **Language**: TypeScript 5.7 with strict mode, `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`
- **Execution**: `tsx` for running .ts files directly during development
- **Module resolution**: `NodeNext` — use `.js` extensions in import paths
- **Key deps**: `@pendle/sdk-boros`, `@pendle/boros-offchain-math`, `@nktkas/hyperliquid`, `viem` (wallet/signing), `axios`
- **Exchange auth**: HMAC-SHA256 for OKX and Binance REST APIs; viem `privateKeyToAccount` for Hyperliquid/Boros signing

## Environment

Requires `.env` file (see `.env.example`). Key variables: `PRIVATE_KEY`, `HYPERLIQUID_SUBACCOUNT`, `BINANCE_API_KEY`, `BINANCE_API_SECRET`, `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_API_PASSPHRASE`. Optional: `BOROS_ACCOUNT_ID` (default 0), `BOROS_RPC_URL`.
