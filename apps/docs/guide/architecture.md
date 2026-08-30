---
description: "How the core is layered — data, scale, render, series, plot — and which direction each dependency is allowed to point."
---

# Architecture

## Headless Core

`@finchart/core` has zero dependencies and no DOM — it computes layout and
emits draw commands, nothing more.

- **Runs anywhere** — Node, workers, tests, SSR, no `jsdom` needed
- **Test without a browser** — assert on draw commands directly, no
  screenshots
- **Bring your own renderer** — `@finchart/dom` wires it to a real `<canvas>`,
  but that's just one wiring choice

## Framework Agnostic

The core doesn't know React exists. `@finchart/react` is a thin wrapper on top
of it, wired the same way `@finchart/dom` is.

- Use it from TypeScript directly, no framework required
- A wrapper for another framework would sit on the exact same core
