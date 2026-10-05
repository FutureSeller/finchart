---
layout: home

hero:
  name: "@finchart"
  text: A composable financial chart engine for TypeScript apps.
  tagline: Build candles, indicators, drawings, and live charts on a DOM-free core. Add the browser shell and React wrapper when you need them, and inspect draw commands to test chart output without a browser.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: How it works
      link: /guide/architecture
---

## Why @finchart?

- **Test chart output directly.** The core emits draw commands you can
  inspect in unit tests. [See the testing guide →](/guide/testing)
- **Build features on public contracts.** Indicators compose as computed data
  sources; drawing tools plug into the input stack. Both live outside the core.
  [See the architecture →](/guide/architecture)
- **Choose what enters the bundle.** Start with the browser preset, or supply
  only the renderers and interactions your app uses. See measured @finchart bundle
  scenarios in the [bundle guide →](/guide/explicit-wiring).
- **Connect charts through the same public API.** Synchronize their visible
  x ranges with `syncX`. [See chart synchronization →](/examples/sync-x)

## Want to see more?

Beyond the candle + volume combo, there are working examples covering
indicators, drawing tools, real-time updates, and chart synchronization.

[Browse the example gallery →](/examples/)
