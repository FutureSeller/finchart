---
layout: home

hero:
  name: "@finchart"
  text: Financial charts you can assemble and test
  tagline: A DOM-free TypeScript core with optional browser, React, indicators, and drawing tools.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: How it works
      link: /guide/architecture
---

## Why @finchart?

- **Test chart output without a browser.** The core emits draw commands you can
  inspect in unit tests. [See the testing guide →](/guide/testing)
- **Extend through public contracts.** Indicators compose as computed data
  sources; drawing tools plug into the input stack. Both live outside the core.
  [See the architecture →](/guide/architecture)
- **Choose the assembly.** Start with the browser preset, or supply only the
  renderers and interactions your app uses. See measured @finchart bundle
  scenarios in the [bundle guide →](/guide/explicit-wiring).

## Want to see more?

Beyond the candle + volume combo, there are working examples covering
indicators, drawing tools, real-time updates, and chart synchronization.

[Browse the example gallery →](/examples/)
