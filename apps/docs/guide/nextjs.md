---
description: "Where the client boundary goes in a Next.js app, why deps is read once at mount, what SSR and hydration do and do not touch, and what StrictMode runs twice."
---

# Next.js and React apps

Read this if your chart lives in a Next.js App Router page, or in any React
app that renders on the server first or runs under StrictMode. None of it is
special to Next.js — it is what a chart that draws on a canvas needs from a
framework that renders HTML first.

## Where the client boundary goes

`@finchart/react` is a client module: its bundle carries `"use client"`, so a
Server Component may import it without failing at the module. What a Server
Component cannot do is hand the chart its wiring — `browserDeps()` returns a
function (container in, the plot's collaborators out), and a function does
not cross the server–client boundary as a prop. So the chart itself, and the
`browserDeps()` call, live in one small client file of yours:

<<< ../snippets/nextjs-chart.client.tsx{tsx}

A Server Component renders it with plain data — `<PriceChart bars={bars} />`
— and the bars are serializable, so they cross. Everything else (`usePlot`,
`useChartPlot`, `usePlugin`, the components) is client-only, as hooks are.

## `deps` is read once, at mount

`<ChartContainer>` takes its `deps` when the chart is created and never again:
the props of the first render are kept, and later renders apply only what
changed (`data`, `options`, `showGrid`, the theme). For a fixed, pure wiring,
the three ways of writing it read the same:

```tsx
const deps = browserDeps();                    // module scope — one wiring for the module
const deps = useMemo(() => browserDeps(), []); // per component instance
<ChartContainer deps={browserDeps()} />        // inline — allocated every render, read once
```

The inline form makes a new wiring function per render that is thrown away;
that is its whole cost. What none of them do is **change** the wiring: a different
`createXMapping` or `mainPaneYScale` after mount is ignored, because those are
creation-time choices. To change a creation-time choice, remount with a `key`.
The ordinary `options` prop is not one of those — it is applied whenever it
changes.

## SSR and hydration

Importing the packages touches no DOM, so a page that renders on the server
imports and renders fine. What the server renders is the container element;
the canvas layers are created in an effect, on the client, after hydration.
There is nothing to hydrate inside the chart and nothing to match — the
server's HTML is an empty box of the right size.

`dynamic(() => import("./price-chart.client").then((m) => m.PriceChart), { ssr: false })`
is therefore **optional** (the `.then` is because the component is a named
export). Use it when you want the container itself left out of the
prerender (a page that must not carry chart markup); declare it inside a Client
Component, where `ssr: false` is allowed. It does not make the chart work where
it otherwise would not.

## StrictMode

Development StrictMode mounts, unmounts and mounts again, and replays effects.
The library is written for that:

- A pane is **acquired** once per mount — twice under the replay — so a
  `yScale` factory is called twice at mount and must be pure. After that a
  new factory identity installs a new scale, so pin it (a module constant or
  `useCallback`) rather than writing it inline.
- A plugin installed through `usePlugin` is installed, disposed and installed
  again. Its `install` may return `null` for "not yet".
- A decoration (`<PriceLine>`, `<Markers>`) is added, removed and added
  again: per mounted component, installs minus removes is one, and after
  unmount it is zero.

What you must not do is read `plotRef` from a parent's effect and keep the
instance: the replay throws that instance away. Effects that configure the
chart belong in a component *inside* the container, through `useChartPlot()`.

## What is not here

There is no way to place a chart from a Server Component alone, with
serializable props only — the wiring is a function, and a client file of yours
has to make it. One file, like the one above, is the whole cost.

See also: the [`@finchart/react` README](https://github.com/finchart/finchart/tree/main/packages/react),
[Time zones and sessions](/guide/time-zones) for why the axis should be told
its zone rather than left to the runtime.
