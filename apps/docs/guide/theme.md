---
description: "Every --chart-* CSS variable, the three-tier override > variable > fallback rule, typed theme objects, styling your own extensions, and the dark palette the docs validate against."
---

# Theming

Want the chart's colors to follow your app's dark/light theme? Set CSS
variables, and subscribe to the swap. The library ships no theme presets — in
the browser you set CSS variables on the container, and where there is no CSS
(server-side PNG, worker, tests) you hand over the same keys by
[injecting a StyleReader](#theming-without-css-—-headless).

**The subscription is not optional.** New values reach the DOM parts the
moment the cascade changes, but a canvas repaints only when asked —
`observeTheme` is the one line that asks
([below](#following-the-app-s-theme)).

```css
.chart {
  --chart-candle-up: #16a34a;
  --chart-candle-down: #dc2626;
  --chart-grid: #e2e8f0;
  --chart-crosshair: #94a3b8;
}
```

**The priority is config override > CSS variable > default.** With no value it
falls to the default. What happens to a value that can't be read **depends on
where it is drawn:**

| | Canvas (candles, lines, grid, crosshair…) | DOM (axis labels, tooltip, legend) |
|---|---|---|
| Number slots | Bare numbers and `px` only — `0.5rem` and `60%` fall to the **default** | — |
| Color slots | If the browser rejects it, **that element isn't drawn** | The browser resolves `var()`, so **plain CSS rules apply** |
| `light-dark(…)`, `color-mix(…)` | **The canvas can't read them** — nothing is drawn | **They work** |
| Typo (`nope`) | Nothing is drawn | **Depends on the kind of property — below** |

**There are actually three paths.** The crosshair badge and the price-line
label live in the DOM, but they arrive as a **resolved value**, not as `var()`
— validity follows DOM rules (`light-dark()` **works**) while the update waits
on `requestRender()`, like the canvas. This one inherited a trait from each of
the two columns above, which say opposite things — so if you read only the
table above and file the badge under canvas, you diagnose it backwards.

| | Validity | Update |
|---|---|---|
| Canvas (candles, lines, grid…) | If the canvas rejects it, nothing is drawn | `requestRender()` |
| DOM + `var()` (axis labels, tooltip, legend) | Plain CSS rules apply | **Immediate** |
| DOM + resolved value (badge, price-line label) | **Plain CSS rules apply** | `requestRender()` |

A typo on the DOM side won't fit on one line. Of all six DOM leaves, the
sentence was **true of only four**:

| Property the DOM leaf declares | With a typo in it |
|---|---|
| Color, font size (inherited properties) | You see **the value inherited from the page** |
| Background | Not inherited but the initial value — **it goes transparent.** The tooltip background vanishes whole and light text floats over the chart |
| Family | `nope` is a valid name, so nothing is invalidated — **there is no such font**, so it draws in the browser's default font |

> That's why `light-dark()` leaves **the tooltip and legend fine while only the
> grid and candles disappear.** To put one value on both paths, pick a syntax
> **the canvas reads too** — `#rrggbb`, `rgb()`.
>
> The canvas side reads *"nothing is drawn"* because it is the fix for
> **inheriting the color of whatever was drawn just before and painting in the
> wrong color** — `e2e/specs/canvas.spec.ts` holds it with real Chromium pixels.

## The variables it reads

`style-vars.test.ts` machine-checks the table below against the source — in
the table but not in the code, or in the code but not in the table, and the
test catches it. To land a typo you would have to make the same mistake in
both files.

| Variable | Target |
|---|---|
| `--chart-line`, `--chart-line-width`, `--chart-line-dash` | line |
| `--chart-point`, `--chart-point-radius` | data point |
| `--chart-candle-up`, `--chart-candle-down`, `--chart-candle-wick-width`, `--chart-candle-body-ratio` | candle |
| `--chart-bar-up`, `--chart-bar-down` | color of the OHLC bar |
| `--chart-bar-line-width` | **stroke width** of the OHLC bar (px) — the vertical line and the ticks |
| `--chart-bar-tick-ratio` | **horizontal width** of the OHLC bar — tick length against slot width (0..1) |
| `--chart-area`, `--chart-area-bottom`, `--chart-area-line`, `--chart-area-line-width`, `--chart-area-line-dash` | area (give `--chart-area-bottom` and you get a top→bottom vertical gradient) |
| `--chart-baseline-top`, `--chart-baseline-bottom` | baseline's upper/lower **line color** (above/below the baseline value) |
| `--chart-baseline-top-fill`, `--chart-baseline-bottom-fill` | baseline's upper/lower **fill color** |
| `--chart-baseline-line-width` | stroke width (px) of baseline's upper/lower **data line** — **not the baseline itself.** The line set by the `baseline` option is not drawn |
| `--chart-histogram`, `--chart-histogram-bar-ratio` | histogram |
| `--chart-grid`, `--chart-grid-width`, `--chart-grid-dash` | grid |
| `--chart-pane-divider`, `--chart-pane-divider-width` | pane border (when there is more than one pane) |
| `--chart-crosshair`, `--chart-crosshair-width`, `--chart-crosshair-dash` | crosshair line |
| `--chart-crosshair-badge`, `--chart-crosshair-badge-back` | crosshair axis badge |
| `--chart-price-line`, `--chart-price-line-width`, `--chart-price-line-dash`, `--chart-marker`, `--chart-watermark`, `--chart-span` | standard decorations |
| `--chart-label`, `--chart-label-font-size`, `--chart-label-font-family` | axis label |
| `--chart-tooltip`, `--chart-tooltip-back` | tooltip (DOM) |
| `--chart-legend` | legend (DOM) |
| `--chart-band` | band and channel fill (`@finchart/indicators`) |
| `--chart-profile`, `--chart-profile-poc` | Volume Profile bars and POC (`@finchart/indicators`) |
| `--chart-drawing`, `--chart-drawing-width`, `--chart-drawing-dash` | drawing tools (`@finchart/tools`) |

### Kinds of value — the name says it

| Suffix | Meaning | Example |
|---|---|---|
| `-width` · `-radius` | **px scalar.** A bare number or `px` | `--chart-line-width: 2` · `2px` |
| `-ratio` | **Unitless 0..1.** Out-of-range values get clamped | `--chart-candle-body-ratio: 0.6` |
| `-dash` | **CSS dash list.** Negatives are ignored | `--chart-grid-dash: 4,4` |
| `-font-size` · `-font-family` | **A CSS value verbatim.** The unit is **required** | `--chart-label-font-size: 12px` |
| everything else | color | `--chart-candle-up: #16a34a` |

> Only `-font-size` requires a unit, because that value goes into the `ctx.font`
> shorthand as it is — `12` is not valid as a CSS font, so it falls to the
> default. Widths and radii take a bare number because canvas coordinates are
> already px.

**The defaults are not written here.** Copy 47 of them by hand into a table and
that table goes stale at once, and unlike the other tables in this document no
machine holds it (most of the specs are not on the public surface).
The defaults for the six series, the chart, and the axis label are
**printable at runtime** —
`DEFAULT_LINE_STYLE`·`DEFAULT_AREA_STYLE`·`DEFAULT_BAR_STYLE`·
`DEFAULT_BASELINE_STYLE`·`DEFAULT_CANDLE_STYLE`·`DEFAULT_HISTOGRAM_STYLE`·
`DEFAULT_PLOT_STYLE`·`AXIS_LABEL_SPEC` are all public. No need to open the source.

The extension packages are the same — `VOLUME_PROFILE_STYLE_SPEC`·
`BAND_STYLE_SPEC` in `@finchart/indicators`, `DRAWING_STYLE_SPEC` in
`@finchart/tools`. **Invent** a value and nobody in code review catches that a
stroke width shifted a little.
The gap that remains is on the decoration side (crosshair, badge, price line,
marker, watermark, span, tooltip, legend), and
**whether to publish those specs is in the post-release queue.**

**Only what lives in the DOM overlay is the exception** — axis labels, tooltip,
and legend pass `var()` through and let the browser interpret it. So their
colors follow a changed CSS variable **without a re-render**, while the things
drawn on the canvas (candles, lines, grid…) land on the next render — that's
why the dark-switch recipe below needs its second line (`requestRender()`).

Fonts take size and family separately. The family defaults to `inherit`, so
**set nothing and it follows the font of the page the chart is mounted on** —
the text living in the DOM (legend, tooltip, DOM axis labels) as much as the
text drawn on the canvas (canvas axis labels, marker captions, Fibonacci
levels).

> The canvas's `ctx.font` knows nothing of `inherit`. So on the canvas side the
> core's `labelFontFamily(readStyle)` realizes `inherit` by resolving in the
> order **variable → the container's computed `font-family` → `sans-serif`**.
> Custom series and decorations use it too when they draw text — skip it and
> only that text won't follow the page font.

## DOM hook — the pane divider handle

The **border** between panes is drawn by the canvas (`--chart-pane-divider`,
table above). **The sign that it can be dragged** is a separate thing — a
transparent handle in the overlay carries the `[data-chart-divider]` attribute,
and `[data-dragging]` is added while dragging. Put the state styling on
`:hover` alone and it flickers every time the pointer leaves the handle
mid-drag, so the recipe is to write **both together**:

```css
.my-chart [data-chart-divider]:hover,
.my-chart [data-chart-divider][data-dragging] {
  background: rgba(41, 98, 255, 0.22);
}
```

Proof: the showcase (`apps/showcase/src/style.css`) is exactly this recipe.

## Theming without CSS — headless

There is no CSS in the core. Styles are read through a `StyleReader` —
`(name) => string` — and the browser wiring (`browserDeps`) merely plugs into
that slot an implementation that reads computed style (`cssReader`). An
environment without CSS plugs anything it likes into the same slot. The keys
are the `--chart-*` from the table above, unchanged — **one name carries across
both worlds.**

```ts
import { createPlotModel } from "@finchart/core";
import type { StyleVarName } from "@finchart/core";
import type { ShellStyleVarName } from "@finchart/dom";

// Typing the keys is what turns a misspelt variable from a value that
// silently falls back into a compile error naming the real one.
// `StyleVarName` covers everything the core draws; the shell's legend and
// tooltip add `ShellStyleVarName`, and the indicators' and drawing tools'
// names derive from their public specs with `StyleVarNamesOf`.
const dark: Partial<Record<StyleVarName | ShellStyleVarName, string>> = {
  "--chart-candle-up": "#22c55e",
  "--chart-candle-down": "#f87171",
  "--chart-grid": "#1e293b",
  // px scalars (-width, -radius) take a bare number too — canvas coordinates are already px.
  "--chart-line-width": "2",
  // **`-font-size` requires a unit** — this value goes into the `ctx.font`
  // shorthand as it is. `"12"` is not valid as a CSS font, so the canvas
  // silently rejects it.
  "--chart-label-font-size": "12px",
};

const model = createPlotModel({
  size: { width: 800, height: 400 },
  series: { series: candleSeries(), data },
  deps: { createStyleReader: () => (name) => dark[name] ?? "" },
});
```

> **Careful: the generalization "numbers go in as strings too — the core does
> the parsing" is false for `-font-size`.** Write `"12"` and the core's
> `applyFont` builds `"12 sans-serif"`, and the canvas rejects it. The rules
> per kind are entirely in the
> [Kinds of value](#kinds-of-value-—-the-name-says-it) table above, and **this section
> follows that table too** — writing it as a string does not mean any string
> will do.

An empty string is "no value" — that leaf falls to the default. To dress one
chart differently, the registration's `options` override comes before the
reader (rank 1 of the priority order).

Proof: the worker-render case of the example gallery (`cases.html#worker-render`)
wears dark by exactly this recipe — the whole chart lives in a worker so there
is no CSS, and the theme is a JS object in
`apps/examples/src/cases/worker-render.worker.ts`.

**Do not take this road in the browser.** `browserDeps` does accept
`createStyleReader`, but the DOM overlay (axis labels, tooltip, legend) has the
browser interpret `var()`, so it never rides the injected reader — the colors
of canvas and overlay split apart. In the browser, CSS variables are the
answer; injection is for where there is no CSS.

## Dark palette reference

Dark **ends at swapping the variables** — the core reads them every frame, so
toggling a class and one `requestRender()` re-dresses everything down to grid,
labels, badge, tooltip, watermark, and drawings.

```ts
document.body.classList.toggle("dark");
plot.requestRender();
```

With `observeTheme` subscribed, the second line is already taken care of.

### Following the app's theme

Swap the variables and **the chart changes only halfway** — axis labels,
tooltip, and legend follow at once while candles, grid, and crosshair stay in
the old colors. The values have already arrived; **nobody is there to redraw
the canvas** (third column of the table above).

`observeTheme` is that somebody. It watches both ways a value can move — the
OS switching `prefers-color-scheme`, and a `class` / `data-theme` / inline
`style` changing on the container or any ancestor:

```ts
import { observeTheme } from "@finchart/dom";

const stop = observeTheme(container, () => plot.requestRender());
```

In React, that call is the body of a `useEffect` and `stop` is its cleanup.

It is deliberately **not** wired by `browserDeps`: a page with one fixed
palette should not carry a `MutationObserver` it never uses. Import it when a
theme can actually change.

Two things stay out of reach, both by design — a theme applied by
restructuring the DOM above the chart rather than re-dressing it, and a
swapped stylesheet. Call `plot.requestRender()` yourself on those.

### Color vision

The palette below is a starting point **whose contrast was verified against a
`#0b1220` background** (the value the dogfooding screen uses — the background
is the app's, not one of our tokens, so it is only recorded here). Put it on a
white card and `--chart-label` lands at 2.56, short of AA, and then you have to
pick the colors again. Only the colors change —
widths, ratios, and dashes are not the theme's.

**Color vision is not verified.** Up/down is this library's primary encoding,
that encoding is nothing but color, and both the defaults and the palette below
are red-green. WCAG contrast after a deuteranopia simulation (Viénot 1999):

| Palette | up / down | normal | deuteranopia |
|---|---|---|---|
| core default | `#16a34a` / `#dc2626` | 1.47 | **1.16** |
| the dark below | `#22c55e` / `#f87171` | 1.21 | **1.01** |

1.01 means **the same color**. Switch to blue/orange and they separate:

```css
.dark .my-chart {
  --chart-candle-up: #2563eb;   --chart-candle-down: #ea580c;
  --chart-bar-up: #2563eb;      --chart-bar-down: #ea580c;
  --chart-baseline-top: #2563eb; --chart-baseline-bottom: #ea580c;
}
```

There is one reason we don't move the defaults to this — **the values belong to
the consumer**, and moving the defaults breaks apps already tuned to our colors.

```css
.dark .my-chart {
  /* background elements */
  --chart-grid: #1e293b;
  --chart-pane-divider: #334155;
  --chart-crosshair: #475569;
  --chart-label: #94a3b8;
  --chart-watermark: rgba(148, 163, 184, 0.1);
  --chart-span: rgba(148, 163, 184, 0.12);

  /* series */
  --chart-line: #60a5fa;
  --chart-point: #60a5fa;
  --chart-area: rgba(96, 165, 250, 0.18);
  --chart-area-line: #60a5fa;
  --chart-candle-up: #22c55e;
  --chart-candle-down: #f87171;
  --chart-bar-up: #22c55e;
  --chart-bar-down: #f87171;
  --chart-baseline-top: #34d399;
  --chart-baseline-bottom: #f87171;
  --chart-baseline-top-fill: rgba(52, 211, 153, 0.15);
  --chart-baseline-bottom-fill: rgba(248, 113, 113, 0.15);
  --chart-histogram: rgba(100, 116, 139, 0.5);
  --chart-area-bottom: rgba(96, 165, 250, 0.02);

  /* decorations — badge and tooltip are an inverted pair of back and text */
  --chart-crosshair-badge: #0f172a;
  --chart-crosshair-badge-back: #94a3b8;
  --chart-tooltip: #0f172a;
  --chart-tooltip-back: rgba(226, 232, 240, 0.92);
  --chart-legend: #cbd5e1;
  --chart-price-line: #f59e0b;
  --chart-marker: #e2e8f0;

  /* extension packages */
  --chart-band: rgba(96, 165, 250, 0.12);       /* @finchart/indicators */
  --chart-profile: rgba(148, 163, 184, 0.22);  /* @finchart/indicators */
  --chart-profile-poc: rgba(251, 191, 36, 0.5);/* @finchart/indicators */
  --chart-drawing: #818cf8;                 /* @finchart/tools */
}
```

**Eleven** of these values have been through real use — the dogfooding screen
(`apps/examples/src/theme.css`) carries that many. The rest (baseline, area,
profile, and so on) **have not been on a screen yet**. Going forward the
`apps/examples/src/trading.ts` screen switches to dark by this road and
verifies these values.

## Styling your own extension

A custom series or indicator joins the same three-tier system the built-in
ones use — declare a spec, resolve it at draw time. This is not a special
path: `@finchart/indicators` is written exactly this way, with zero special
access to the core.

```ts
import { resolveStyle, styleSpec } from "@finchart/core";
import type { StyleSpec, StyleVarNamesOf } from "@finchart/core";

interface RibbonStyle {
  fill: string;
  width: number;
}

export const RIBBON_STYLE_SPEC = /* @__PURE__ */ styleSpec({
  fill: { css: "--acme-ribbon", fallback: "rgba(148, 163, 184, 0.2)" },
  width: { css: "--acme-ribbon-width", fallback: 1 },
}) satisfies StyleSpec<RibbonStyle>;

// At draw time — context is the SeriesContext your draw() receives:
const style = resolveStyle(RIBBON_STYLE_SPEC, context.readStyle, overrides);
```

`context.readStyle` is the same reader the built-in series get, built once
per render — in the browser it reads computed style, headless it reads
whatever the consumer injected, and your spec cannot tell the difference.
Override > variable > fallback applies unchanged, and so does the `range`
clamp on numeric leaves.

Your names become types the same way ours do:

```ts
type RibbonVar = StyleVarNamesOf<typeof RIBBON_STYLE_SPEC>;
// a theme covering the chart and your extension:
type ThemeVar = StyleVarName | RibbonVar;
```

**Pick your own prefix** (`--acme-*` above) — the reader takes any name, and
`--chart-*` is a convention, not a filter. Reusing a `--chart-*` name is
allowed and does something useful: your extension inherits whatever the
consumer already set for that variable. Do it only on purpose, and keep the
fallback identical to the one the chart declares — the same name falling
back differently in two places means a consumer who sets nothing sees two
values for one variable.

## Related

- [glossary.md](/guide/glossary) — what layer and command mean
