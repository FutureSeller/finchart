import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OHLC } from "@finchart/core";
import { ContractError, candleSeries, createPlotModel } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { movingAverage } from "../factories";
import {
  attachAdx,
  attachAtr,
  attachBollingerBands,
  attachIchimoku,
  attachMacd,
  attachMovingAverage,
  attachObv,
  attachParabolicSar,
  attachRsi,
  attachStochastic,
  attachVwap,
} from "../plugins";

function candle(x: number, close: number): OHLC {
  // volume is for VWAP/OBV — no other series reads it, so it's harmless.
  return { x, open: close, high: close + 1, low: close - 1, close, volume: 100 + x };
}

const candles = Array.from({ length: 40 }, (_, i) =>
  candle(i, 100 + Math.sin(i / 3) * 10),
);

function pricedModel() {
  const model = createPlotModel({
    size: { width: 800, height: 600 },
    config: {
      showGrid: false,
      axis: { x: { showLabels: false }, y: { showLabels: false } },
    },
  });
  const price = model.plot.mainPane.addSeries({
    series: candleSeries(),
    data: candles,
  });
  return { model, price };
}

const strokeCount = (model: ReturnType<typeof pricedModel>["model"]) =>
  model.commands().filter((c) => c.type === "drawLine").length;

describe("indicator plugins", () => {
  it("should install and uninstall a moving average in one round trip", () => {
    const { model, price } = pricedModel();
    const before = strokeCount(model);

    const ma = model.plot.mainPane.use(
      attachMovingAverage({ source: price, period: 5 }),
    );
    model.plot.render();
    expect(strokeCount(model)).toBeGreaterThan(before);

    ma.dispose();
    model.plot.render();
    expect(strokeCount(model)).toBe(before);
  });

  it("should give macd its own pane and take it back on dispose", () => {
    const { model, price } = pricedModel();
    expect(model.plot.panes).toHaveLength(1);

    const installed = model.plot.use(
      attachMacd({ source: price, fast: 3, slow: 6, signal: 3 }),
    );

    expect(model.plot.panes).toHaveLength(2);
    // The domain default is that a secondary pane is smaller than the
    // main one — back when it was uniform (1), stacking just three panes
    // squeezed the price pane down to the same size as the indicator.
    expect(model.plot.panes[1].flex).toBe(0.35);
    installed.dispose();
    expect(model.plot.panes).toHaveLength(1);
  });

  it("should let a consumer size an owned pane with ownPane", () => {
    const { model, price } = pricedModel();

    const installed = model.plot.use(
      attachMacd({ source: price, ownPane: { flex: 2, minHeight: 80 } }),
    );

    expect(model.plot.panes[1].flex).toBe(2);
    expect(model.plot.panes[1].minHeight).toBe(80);
    installed.dispose();
  });

  it("should reject pane and ownPane given together", () => {
    const { model, price } = pricedModel();

    expect(() =>
      model.plot.use(
        attachMacd({
          source: price,
          pane: model.plot.mainPane,
          ownPane: { flex: 2 },
        }),
      ),
    ).toThrow(ContractError);
  });

  it("should hand back the pane it created so paneMaximize can find it", () => {
    const { model, price } = pricedModel();

    const installed = model.plot.use(attachMacd({ source: price }));

    expect(installed.pane).toBe(model.plot.panes[1]);
    installed.dispose();
  });

  it("should return null for pane when it borrowed one instead", () => {
    const { model, price } = pricedModel();

    const installed = model.plot.use(
      attachMacd({ source: price, pane: model.plot.mainPane }),
    );

    expect(installed.pane).toBeNull();
    installed.dispose();
  });

  it("should expose the node so more indicators can build on it", () => {
    const { model, price } = pricedModel();

    const boll = model.plot.mainPane.use(
      attachBollingerBands({ source: price, period: 5 }),
    );
    // An installed indicator's branch is itself a Source — build another
    // calculation on top of it.
    const smoothed = movingAverage(boll.node.out.middle, {
      period: 3,
      value: (point) => point.y,
    });

    model.plot.render();
    expect(smoothed.out.ma.read().some((point) => point.y !== null)).toBe(true);
  });

  it("should wire an owned oscillator pane — fixed 0–100 and level lines", () => {
    const { model, price } = pricedModel();

    const installed = model.plot.use(attachRsi({ source: price, period: 5 }));

    expect(model.plot.panes).toHaveLength(2);
    // An oscillator's axis is set by its definition, not by the data —
    // autoScale is off.
    expect(model.plot.panes[1].autoScale).toBe(false);

    installed.dispose();
    expect(model.plot.panes).toHaveLength(1);
  });

  it("should leave a borrowed pane's axis alone", () => {
    const { model, price } = pricedModel();

    const installed = model.plot.use(
      attachRsi({ source: price, period: 5, pane: model.plot.mainPane }),
    );

    // A borrowed pane gets only the series — it never touches someone
    // else's axis.
    expect(model.plot.panes).toHaveLength(1);
    expect(model.plot.mainPane.autoScale).toBe(true);
    installed.dispose();
  });

  it("should draw the level lines only when they are wanted", () => {
    const { model, price } = pricedModel();
    const withLevels = model.plot.use(attachStochastic({ source: price }));
    model.plot.render();
    const levelled = strokeCount(model);
    withLevels.dispose();

    const without = model.plot.use(
      attachStochastic({ source: price, levels: false }),
    );
    model.plot.render();
    // Line count drops by exactly the two missing reference lines.
    expect(strokeCount(model)).toBe(levelled - 2);
    without.dispose();
  });

  it("should give atr its own auto-scaled pane and take it back", () => {
    const { model, price } = pricedModel();

    const installed = model.plot.use(attachAtr({ source: price, period: 5 }));

    expect(model.plot.panes).toHaveLength(2);
    // ATR is not an oscillator — the data sets the axis.
    expect(model.plot.panes[1].autoScale).toBe(true);

    installed.dispose();
    expect(model.plot.panes).toHaveLength(1);
  });

  it("should round-trip the price-pane overlays — vwap and sar", () => {
    const { model, price } = pricedModel();
    const before = strokeCount(model);

    const installed = [
      model.plot.mainPane.use(attachVwap({ source: price })),
      model.plot.mainPane.use(attachParabolicSar({ source: price })),
    ];
    model.plot.render();
    expect(strokeCount(model)).toBeGreaterThan(before);

    for (const plugin of installed) plugin.dispose();
    model.plot.render();
    expect(strokeCount(model)).toBe(before);
  });

  it("should give obv and adx their own auto-scaled panes", () => {
    const { model, price } = pricedModel();

    const installedObv = model.plot.use(attachObv({ source: price }));
    const installedAdx = model.plot.use(attachAdx({ source: price, period: 3 }));

    expect(model.plot.panes).toHaveLength(3);
    expect(model.plot.panes[1].autoScale).toBe(true);
    expect(model.plot.panes[2].autoScale).toBe(true);

    installedObv.dispose();
    installedAdx.dispose();
    expect(model.plot.panes).toHaveLength(1);
  });

  it("should install and uninstall the whole ichimoku set in one round trip", () => {
    const { model, price } = pricedModel();
    const before = strokeCount(model);

    const installed = model.plot.mainPane.use(
      attachIchimoku({
        source: price,
        conversion: 2,
        base: 3,
        span: 4,
        displacement: 2,
      }),
    );
    model.plot.render();
    expect(strokeCount(model)).toBeGreaterThan(before);

    installed.dispose();
    model.plot.render();
    expect(strokeCount(model)).toBe(before);
  });

  it("should survive plot.destroy without a manual dispose", () => {
    const { model, price } = pricedModel();
    model.plot.use(attachMacd({ source: price }));

    // Plugin cleanup is the Plot's destroy's responsibility — it must be
    // safe to call twice.
    expect(() => model.plot.destroy()).not.toThrow();
  });
});

describe("defaults stay single-source", () => {
  it("should not reinvent numeric defaults outside the factories", () => {
    // The single source of truth for defaults is the factory's *_DEFAULTS
    // — if the wiring re-derives them, the label silently lies.
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../plugins.ts"),
      "utf8",
    );
    expect(source.match(/\?\?\s*[0-9.]+/g)).toBeNull();
  });
});
