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
- `.env.local`, `.next`, coverage, and compiler caches are ignored by Git.
  Commit only the blank `.env.example` template.

## Data flow

`/api/candles` returns synthetic candles in demo mode or projected Toss candles
in live mode. `lib/candles.ts` converts API values into chart bars; minute candle
end timestamps are shifted back one minute to represent bar starts. Pagination
uses the upstream `nextBefore` cursor and removes overlap when merging history.

In live mode, `/api/realtime` translates server-side WebSocket trades into SSE.
The client aggregates individual trades and reconciles a REST snapshot every
15 seconds. Demo mode disables the live stream. See
[market-dashboard.tsx](app/market-dashboard.tsx) and
[candles.ts](lib/candles.ts) for the consumer flow.

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
