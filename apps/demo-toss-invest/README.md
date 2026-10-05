# Toss market-data demo

A Next.js consumer of the workspace's five `@finchart/*` packages. The chart
includes indicators, drawings, historical pagination, and optional live trades.
The default data is generated locally; no credentials or external API calls are
needed.

## Run locally

From the repository root, install dependencies and build the library packages
with `pnpm install` and `pnpm build`. Then:

```sh
cp apps/demo-toss-invest/.env.example apps/demo-toss-invest/.env.local
pnpm --filter charts-demo-toss-invest dev
```

Open `http://127.0.0.1:3000`. The development and production start scripts bind
to the loopback address.

## Optional live data

In your local `.env.local`, explicitly set `TOSSINVEST_MODE=live` and fill in
`TOSSINVEST_CLIENT_ID` and `TOSSINVEST_CLIENT_SECRET`. Restart the server.
Both credentials stay on the server. Setting credentials alone does not enable
live mode; absent mode or `TOSSINVEST_MODE=demo` always uses synthetic candles.

This is a local developer example. Its market-data routes do not authenticate
application users. Add authentication and request limits before making a live
instance accessible to other people.

## Privacy and data handling

- The import contains chart code and market-data routes. Credentials, personal
  records, private lab pages, saved market snapshots, caches, and source-repo
  metadata were excluded.
- No account, holdings, or order endpoints are used.
- Authentication and response projection use `server-only` modules. Access
  tokens stay in server memory and are never returned to the browser.
- Candle and trade responses select and validate individual public market
  fields. Unknown upstream fields are discarded. Raw upstream errors and
  exception messages are replaced with fixed messages.
- API responses use `Cache-Control: no-store`. Drawings stay in page memory.
- `.env.local`, `.next`, generated `next-env.d.ts`, coverage, and compiler caches are ignored by Git.
  Commit only the blank `.env.example` template.

## Data flow

`/api/candles` returns synthetic candles in demo mode or projected Toss candles
in live mode. `lib/candles.ts` converts API values into chart bars; minute candle
end timestamps are shifted back one minute to represent bar starts. Pagination
uses the upstream `nextBefore` cursor and removes overlap when merging history.

In live mode, `/api/realtime` translates server-side WebSocket trades into SSE.
The client aggregates individual trades and reconciles a REST snapshot every
15 seconds. Demo mode disables the live stream.

## Code organization

| Location | Responsibility |
| --- | --- |
| [MarketDashboard](app/market-dashboard.tsx) | Selected market, display preferences, and page composition |
| [DashboardToolbar](components/dashboard-toolbar.tsx) | Symbol input, intervals, display settings, and drawing controls |
| [QuoteRow](components/quote-row.tsx) | Price, connection/history status, and jump-to-date form |
| [MarketChart](components/market-chart.tsx) | Loading/error state and the time/Renko view switch |
| [TimeChart](components/time-chart.tsx) | Time-chart assembly, price/volume series, and plugins |
| [Indicator panes](components/indicator-panes.tsx) | MA/Bollinger overlays and RSI/MACD panels |
| [RenkoChart](components/renko-chart.tsx) | Brick calculation and ordinal chart rendering |
| [PeriodInput](components/period-input.tsx) | Editable period text and valid period commits |
| [useMarketData](hooks/use-market-data.ts) | Load cancellation, cursor paging, trades, and REST reconciliation |
| [useChartSession](hooks/use-chart-session.ts) | Retained drawings, viewport restoration, and chart focus |
| [Candle client](lib/candle-client.ts) | Shared browser-side candle request transport |
| [Candles](lib/candles.ts) | Timestamp conversion, trade aggregation, and snapshot merging |

The dashboard defines the client entrypoint. Components imported below it stay
in that client tree. Credentials and upstream response projection remain in
server-only modules behind the API routes.

## Verification

```sh
pnpm --filter charts-demo-toss-invest test
pnpm --filter charts-demo-toss-invest type-check
pnpm --filter charts-demo-toss-invest lint
pnpm --filter charts-demo-toss-invest build
```

Privacy tests use fabricated credentials and mocked upstream responses. Build
and browser verification should use `TOSSINVEST_MODE=demo`; they do not verify
real account permissions or live service behavior.
