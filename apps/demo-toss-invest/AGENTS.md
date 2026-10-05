<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Privacy boundary

- Keep synthetic data as the default. Live mode requires explicit local opt-in.
- Never copy credentials, personal records, saved API responses, or private lab fixtures into this app.
- Authentication belongs in server-only modules. Never add credentials to client props or `NEXT_PUBLIC_*` variables.
- Project upstream market data through `lib/public-market-data.ts`; never forward raw upstream objects or error messages.
- Run the privacy regression tests after changing authentication or either API route. Use demo mode for browser checks and builds.
