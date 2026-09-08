import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { OHLC, PaneHost, Plugin, PluginApi, SeriesHost, Source } from "@finchart/core";
import { ContractError, candleSeries, createPlotModel } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { MOVING_AVERAGE_DEFAULTS, movingAverage } from "../factories";
import {
  MFI_LEVELS,
  PSY_LEVELS,
  KDJ_LEVELS,
  PIVOT_POINTS_DEFAULTS,
  RSI_LEVELS,
  STOCHASTIC_RSI_LEVELS,
  ULTIMATE_OSCILLATOR_LEVELS,
  attachAdx,
  attachAtr,
  attachAwesomeOscillator,
  attachBbi,
  attachBollingerBands,
  attachBrar,
  attachCr,
  attachKdj,
  attachDma,
  attachEmv,
  attachElderRay,
  attachIchimoku,
  attachMacd,
  attachMfi,
  attachMomentum,
  attachMovingAverage,
  attachObv,
  attachParabolicSar,
  attachPivotPoints,
  attachPsy,
  attachPvt,
  attachRoc,
  attachRsi,
  attachSqueezeMomentum,
  attachStochastic,
  attachStochasticRsi,
  attachTrix,
  attachUltimateOscillator,
  attachVr,
  attachVwap,
} from "../plugins";

function candle(x: number, close: number): OHLC {
  // volume feeds VWAP, OBV, VR, EMV and PVT; the price-only series ignore it.
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

/**
 * The legend reads series names. Every attach* builds one from the formula,
 * and `name` replaces its head — so two instances of one indicator can be
 * told apart, and a bare "P" never has to mean "which pivot?".
 */
describe("names — the label and its override", () => {
  const namesOn = (model: ReturnType<typeof pricedModel>["model"], x: number) => {
    model.plot.render();
    return model.plot.mainPane
      .probe(x)
      .map((sample) => sample.name)
      .filter((name): name is string => name !== null);
  };
  const anchor = (_: OHLC, index: number) => index % 10 === 0;

  it("pivot levels carry the indicator's name — two instances stay apart", () => {
    const { model, price } = pricedModel();
    model.plot.mainPane.use(attachPivotPoints({ source: price, anchor }));
    model.plot.mainPane.use(attachPivotPoints({ source: price, anchor, name: "Weekly" }));
    const names = namesOn(model, 35);
    expect(names).toEqual(
      expect.arrayContaining(["Pivot P", "Pivot R1", "Pivot S1", "Weekly P", "Weekly R1", "Weekly S1"]),
    );
    expect(names).not.toContain("P");
    expect(names).not.toContain("R1");
  });

  it("the default depth is the exported default — PIVOT_POINTS_DEFAULTS.depth tiers", () => {
    const { model, price } = pricedModel();
    model.plot.mainPane.use(attachPivotPoints({ source: price, anchor }));
    const names = namesOn(model, 35).filter((name) => name.startsWith("Pivot"));
    expect(PIVOT_POINTS_DEFAULTS.depth).toBe(2);
    expect(names).toHaveLength(1 + 2 * PIVOT_POINTS_DEFAULTS.depth);
    expect(names).not.toContain("Pivot R3");
  });

  it("name replaces the head of a multi-series label — the parts stay appended", () => {
    const { model, price } = pricedModel();
    model.plot.mainPane.use(attachBollingerBands({ source: price, period: 5, name: "Bands" }));
    const names = namesOn(model, 30);
    expect(names).toEqual(expect.arrayContaining(["Bands", "Bands Upper", "Bands Lower"]));
    expect(names.some((name) => name.startsWith("BB("))).toBe(false);
  });

  it("ADX's direction lines hang off the same head", () => {
    const { model, price } = pricedModel();
    model.plot.use(attachAdx({ source: price, period: 3, pane: model.plot.mainPane }));
    model.plot.use(attachAdx({ source: price, period: 3, pane: model.plot.mainPane, name: "Trend" }));
    const names = namesOn(model, 30);
    expect(names).toEqual(
      expect.arrayContaining(["ADX(3)", "ADX(3) +DI", "ADX(3) -DI", "Trend", "Trend +DI", "Trend -DI"]),
    );
  });

  it("a single-series label takes the name whole", () => {
    const { model, price } = pricedModel();
    model.plot.use(attachRsi({ source: price, period: 5, pane: model.plot.mainPane, name: "Momentum" }));
    model.plot.mainPane.use(attachMovingAverage({ source: price, period: 5, name: "Fast" }));
    const names = namesOn(model, 30);
    expect(names).toEqual(expect.arrayContaining(["Momentum", "Fast"]));
    expect(names).not.toContain("RSI(5)");
    expect(names).not.toContain("MA(5)");
  });

  it("the default label reads from the exported default — a typeless moving average is an MA", () => {
    const { model, price } = pricedModel();
    model.plot.mainPane.use(attachMovingAverage({ source: price, period: 5 }));
    model.plot.mainPane.use(attachMovingAverage({ source: price, period: 5, type: "ema" }));
    expect(MOVING_AVERAGE_DEFAULTS.type).toBe("sma");
    expect(namesOn(model, 30)).toEqual(expect.arrayContaining(["MA(5)", "EMA(5)"]));
  });
});

/**
 * Wave 1's oscillators take the same door as RSI: an own pane with a
 * fixed 0–100 axis and two reference lines, a borrowed pane left alone,
 * levels that can be turned off, a name that replaces the label's head.
 */
describe("own-pane oscillators — the attach mould", () => {
  interface Mould {
    source: Source<OHLC>;
    pane?: SeriesHost;
    levels?: false;
    name?: string;
  }
  const attaches: [string, (o: Mould) => Plugin<PaneHost, PluginApi>, string][] = [
    ["attachStochasticRsi", (o) => attachStochasticRsi({ rsiPeriod: 5, period: 5, ...o }), "StochRSI(5,5,3,3) %K"],
    ["attachMfi", (o) => attachMfi({ period: 5, ...o }), "MFI(5)"],
    ["attachUltimateOscillator", (o) => attachUltimateOscillator({ fast: 2, middle: 3, slow: 4, ...o }), "UO(2,3,4)"],
    ["attachPsy", (o) => attachPsy({ period: 5, signal: 3, ...o }), "PSY(5,3)"],
  ];

  it.each(attaches)("%s — owns a fixed-axis pane and takes it back", (_name, make) => {
    const { model, price } = pricedModel();
    const installed = model.plot.use(make({ source: price }));
    expect(model.plot.panes).toHaveLength(2);
    expect(model.plot.panes[1].autoScale).toBe(false);
    installed.dispose();
    expect(model.plot.panes).toHaveLength(1);
  });

  it.each(attaches)("%s — leaves a borrowed pane's axis alone", (_name, make) => {
    const { model, price } = pricedModel();
    const installed = model.plot.use(make({ source: price, pane: model.plot.mainPane }));
    expect(model.plot.panes).toHaveLength(1);
    expect(model.plot.mainPane.autoScale).toBe(true);
    installed.dispose();
  });

  it.each(attaches)("%s — draws the level lines only when wanted", (_name, make) => {
    const { model, price } = pricedModel();
    const withLevels = model.plot.use(make({ source: price }));
    model.plot.render();
    const levelled = strokeCount(model);
    withLevels.dispose();
    const without = model.plot.use(make({ source: price, levels: false }));
    model.plot.render();
    expect(strokeCount(model)).toBe(levelled - 2);
    without.dispose();
  });

  it.each(attaches)("%s — the label reads from the defaults and name replaces its head", (_name, make, label) => {
    const { model, price } = pricedModel();
    model.plot.use(make({ source: price, pane: model.plot.mainPane }));
    model.plot.use(make({ source: price, pane: model.plot.mainPane, name: "Mine" }));
    model.plot.render();
    const names = model.plot.mainPane
      .probe(30)
      .map((sample) => sample.name)
      .filter((name): name is string => name !== null);
    expect(names).toContain(label);
    expect(names.some((name) => name === "Mine" || name.startsWith("Mine "))).toBe(true);
  });

  it("the reference levels are exported — the same values the panes draw", () => {
    expect(RSI_LEVELS).toEqual({ overbought: 70, oversold: 30 });
    expect(STOCHASTIC_RSI_LEVELS).toEqual({ overbought: 80, oversold: 20 });
    expect(MFI_LEVELS).toEqual({ overbought: 80, oversold: 20 });
    expect(ULTIMATE_OSCILLATOR_LEVELS).toEqual({ overbought: 70, oversold: 30 });
    expect(PSY_LEVELS).toEqual({ overbought: 75, oversold: 25 });
    expect(KDJ_LEVELS).toEqual({ overbought: 80, oversold: 20 });
  });
});

/**
 * Wave 1's histogram and line indicators take the ATR door: an own pane
 * whose axis stays autoScale (they are unbounded), a borrowed pane left
 * alone, a name that replaces the label's head.
 */
describe("unbounded indicators — the own-pane mould", () => {
  interface Mould {
    source: Source<OHLC>;
    pane?: SeriesHost;
    name?: string;
  }
  const attaches: [string, (o: Mould) => Plugin<PaneHost, PluginApi>, string][] = [
    ["attachAwesomeOscillator", (o) => attachAwesomeOscillator({ fast: 2, slow: 5, ...o }), "AO(2,5)"],
    ["attachMomentum", (o) => attachMomentum({ period: 3, signal: 2, ...o }), "MTM(3,2)"],
    ["attachElderRay", (o) => attachElderRay({ period: 3, ...o }), "Elder-Ray(3) Bull"],
    ["attachRoc", (o) => attachRoc({ period: 3, signal: 2, ...o }), "ROC(3,2)"],
    ["attachTrix", (o) => attachTrix({ period: 3, signal: 2, ...o }), "TRIX(3,2)"],
    ["attachDma", (o) => attachDma({ fast: 2, slow: 4, signal: 2, ...o }), "DMA(2,4,2)"],
    ["attachBrar", (o) => attachBrar({ period: 3, ...o }), "BRAR(3) BR"],
    ["attachVr", (o) => attachVr({ period: 3, signal: 2, ...o }), "VR(3,2)"],
    ["attachEmv", (o) => attachEmv({ period: 3, ...o }), "EMV(3)"],
    ["attachPvt", (o) => attachPvt({ ...o }), "PVT"],
  ];

  it.each(attaches)("%s — owns an auto-scaled pane and takes it back", (_name, make) => {
    const { model, price } = pricedModel();
    const installed = model.plot.use(make({ source: price }));
    expect(model.plot.panes).toHaveLength(2);
    expect(model.plot.panes[1].autoScale).toBe(true);
    installed.dispose();
    expect(model.plot.panes).toHaveLength(1);
  });

  it.each(attaches)("%s — leaves a borrowed pane alone", (_name, make) => {
    const { model, price } = pricedModel();
    const before = strokeCount(model);
    const installed = model.plot.use(make({ source: price, pane: model.plot.mainPane }));
    expect(model.plot.panes).toHaveLength(1);
    installed.dispose();
    model.plot.render();
    expect(strokeCount(model)).toBe(before);
  });

  it.each(attaches)("%s — the label reads from the defaults and name replaces its head", (_name, make, label) => {
    const { model, price } = pricedModel();
    model.plot.use(make({ source: price, pane: model.plot.mainPane }));
    model.plot.use(make({ source: price, pane: model.plot.mainPane, name: "Mine" }));
    model.plot.render();
    const names = model.plot.mainPane
      .probe(30)
      .map((sample) => sample.name)
      .filter((name): name is string => name !== null);
    expect(names).toContain(label);
    expect(names.some((name) => name === "Mine" || name.startsWith("Mine "))).toBe(true);
  });

  it("bbi is a price-pane overlay — one line, the label shows the four windows", () => {
    const { model, price } = pricedModel();
    model.plot.mainPane.use(attachBbi({ source: price, periods: [2, 3, 4, 5] }));
    model.plot.mainPane.use(attachBbi({ source: price, name: "Mine" }));
    model.plot.render();
    expect(model.plot.panes).toHaveLength(1);
    const names = model.plot.mainPane.probe(30).map((sample) => sample.name);
    expect(names).toContain("BBI(2,3,4,5)");
    expect(names).toContain("Mine");
    // A JavaScript caller's longer array is refused by the factory before any label is made.
    const fresh = pricedModel();
    const longer: unknown = [2, 3, 4, 5, 99];
    expect(() => fresh.model.plot.mainPane.use(attachBbi({ source: fresh.price, periods: longer as never }))).toThrow(ContractError);
  });

  it("cr is five lines on an own pane — the band and four averages labelled with their windows", () => {
    const { model, price } = pricedModel();
    model.plot.use(attachCr({ source: price, period: 2, periods: [1, 2, 3, 4] }));
    model.plot.use(attachCr({ source: price, name: "Mine", period: 2, periods: [1, 2, 3, 4] }));
    model.plot.render();
    expect(model.plot.panes).toHaveLength(3);
    const names = model.plot.panes.flatMap((pane) => pane.probe(30).map((sample) => sample.name));
    for (const head of ["CR(2)", "Mine"]) {
      expect(names).toContain(head);
      for (const window of [1, 2, 3, 4]) expect(names).toContain(`${head} MA(${window})`);
    }
    // A JavaScript caller's shorter array is refused by the factory before any label is made.
    const fresh = pricedModel();
    const shorter: unknown = [1, 2];
    expect(() => fresh.model.plot.use(attachCr({ source: fresh.price, periods: shorter as never }))).toThrow(ContractError);
  });

  it("cr colours — the band primary, the four averages one secondary by default, each overridable", () => {
    const { model, price } = pricedModel();
    model.plot.use(attachCr({ source: price, period: 2, periods: [1, 2, 3, 4] }));
    model.plot.use(attachCr({ source: price, name: "Mine", period: 2, periods: [1, 2, 3, 4], colors: { cr: "#111111", ma1: "#222222", ma2: "#333333", ma3: "#444444", ma4: "#555555" } }));
    model.plot.render();
    const byName = new Map(model.plot.panes.flatMap((pane) => pane.probe(30)).map((sample) => [sample.name, sample.color]));
    expect(byName.get("CR(2)")).toBe("#3b82f6");
    for (const window of [1, 2, 3, 4]) expect(byName.get(`CR(2) MA(${window})`)).toBe("#f59e0b");
    expect(byName.get("Mine")).toBe("#111111");
    expect([1, 2, 3, 4].map((window) => byName.get(`Mine MA(${window})`))).toEqual(["#222222", "#333333", "#444444", "#555555"]);
  });

  it("kdj — three lines on an own pane left to autoScale, with the 80/20 lines unless refused", () => {
    const { model, price } = pricedModel();
    const installed = model.plot.use(attachKdj({ source: price, period: 3 }));
    model.plot.render();
    expect(model.plot.panes).toHaveLength(2);
    // J runs outside 0–100, so the pane is not fixed to it — CCI's door, not Stochastic's.
    expect(model.plot.panes[1].autoScale).toBe(true);
    const names = model.plot.panes[1].probe(30).map((sample) => sample.name);
    for (const line of ["%K", "%D", "%J"]) expect(names).toContain(`KDJ(3,3,3) ${line}`);
    const levelled = strokeCount(model);
    installed.dispose();
    expect(model.plot.panes).toHaveLength(1);
    const without = model.plot.use(attachKdj({ source: price, period: 3, levels: false }));
    model.plot.render();
    expect(strokeCount(model)).toBe(levelled - 2);
    without.dispose();
    // A name replaces the head of all three labels; the colours are primary, secondary and the lagging violet
    // by default, each overridable.
    model.plot.use(attachKdj({ source: price, period: 3, name: "Mine", pane: model.plot.mainPane }));
    model.plot.use(attachKdj({ source: price, period: 3, name: "Own", pane: model.plot.mainPane, colors: { k: "#111111", d: "#222222", j: "#333333" } }));
    model.plot.render();
    const byName = new Map(model.plot.mainPane.probe(30).map((sample) => [sample.name, sample.color]));
    expect(["%K", "%D", "%J"].map((line) => byName.get(`Mine ${line}`))).toEqual(["#3b82f6", "#f59e0b", "#8b5cf6"]);
    expect(["%K", "%D", "%J"].map((line) => byName.get(`Own ${line}`))).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("cr draws its 100 line only on an own pane", () => {
    const strokes = (
      make: (price: Source<OHLC>, pane: SeriesHost | undefined) => Plugin<PaneHost, PluginApi>,
      borrow: boolean,
    ) => {
      const { model, price } = pricedModel();
      const installed = model.plot.use(make(price, borrow ? model.plot.mainPane : undefined));
      model.plot.render();
      const count = strokeCount(model);
      installed.dispose();
      return count;
    };
    const atr = (price: Source<OHLC>, pane: SeriesHost | undefined) => attachAtr({ source: price, period: 3, pane });
    const five = (price: Source<OHLC>, pane: SeriesHost | undefined) => attachCr({ source: price, period: 2, periods: [1, 2, 3, 4], pane });
    const paneOverhead = strokes(atr, false) - strokes(atr, true);
    expect(strokes(five, false) - strokes(five, true) - paneOverhead).toBe(1);
  });

  it("brar draws its 100 line only on an own pane", () => {
    const strokes = (
      make: (price: Source<OHLC>, pane: SeriesHost | undefined) => Plugin<PaneHost, PluginApi>,
      borrow: boolean,
    ) => {
      const { model, price } = pricedModel();
      const installed = model.plot.use(make(price, borrow ? model.plot.mainPane : undefined));
      model.plot.render();
      const count = strokeCount(model);
      installed.dispose();
      return count;
    };
    const atr = (price: Source<OHLC>, pane: SeriesHost | undefined) => attachAtr({ source: price, period: 3, pane });
    const two = (price: Source<OHLC>, pane: SeriesHost | undefined) => attachBrar({ source: price, period: 3, pane });
    const paneOverhead = strokes(atr, false) - strokes(atr, true);
    expect(strokes(two, false) - strokes(two, true) - paneOverhead).toBe(1);
  });

  it("momentum, elder-ray, roc, trix and emv draw their zero line only on an own pane", () => {
    // An own pane costs strokes of its own (its axis), so measure that
    // overhead with ATR — one line, no zero line — and take it out.
    const strokes = (
      make: (price: Source<OHLC>, pane: SeriesHost | undefined) => Plugin<PaneHost, PluginApi>,
      borrow: boolean,
    ) => {
      const { model, price } = pricedModel();
      const installed = model.plot.use(make(price, borrow ? model.plot.mainPane : undefined));
      model.plot.render();
      const count = strokeCount(model);
      installed.dispose();
      return count;
    };
    const atr = (price: Source<OHLC>, pane: SeriesHost | undefined) => attachAtr({ source: price, period: 3, pane });
    const mtm = (price: Source<OHLC>, pane: SeriesHost | undefined) =>
      attachMomentum({ source: price, period: 3, signal: 2, pane });
    const elder = (price: Source<OHLC>, pane: SeriesHost | undefined) =>
      attachElderRay({ source: price, period: 3, pane });
    const rocLines = (price: Source<OHLC>, pane: SeriesHost | undefined) =>
      attachRoc({ source: price, period: 3, signal: 2, pane });
    const trixLines = (price: Source<OHLC>, pane: SeriesHost | undefined) =>
      attachTrix({ source: price, period: 3, signal: 2, pane });
    const emvLines = (price: Source<OHLC>, pane: SeriesHost | undefined) =>
      attachEmv({ source: price, period: 3, pane });
    const paneOverhead = strokes(atr, false) - strokes(atr, true);
    expect(strokes(mtm, false) - strokes(mtm, true) - paneOverhead).toBe(1);
    expect(strokes(elder, false) - strokes(elder, true) - paneOverhead).toBe(1);
    expect(strokes(rocLines, false) - strokes(rocLines, true) - paneOverhead).toBe(1);
    expect(strokes(trixLines, false) - strokes(trixLines, true) - paneOverhead).toBe(1);
    expect(strokes(emvLines, false) - strokes(emvLines, true) - paneOverhead).toBe(1);
  });

  it("the two-line attaches register both suffixes with their own swatches", () => {
    const { model, price } = pricedModel();
    model.plot.use(attachMomentum({ source: price, period: 3, signal: 2, pane: model.plot.mainPane, name: "M" }));
    model.plot.use(attachElderRay({ source: price, period: 3, pane: model.plot.mainPane, name: "E", colors: { bull: "#111111", bear: "#222222" } }));
    model.plot.render();
    const samples = model.plot.mainPane.probe(30).filter((sample) => sample.name !== null);
    const byName = new Map(samples.map((sample) => [sample.name, sample.color]));
    expect([...byName.keys()]).toEqual(expect.arrayContaining(["M", "M Signal", "E Bull", "E Bear"]));
    expect(byName.get("E Bull")).toBe("#111111");
    expect(byName.get("E Bear")).toBe("#222222");
  });
});

describe("attachSqueezeMomentum", () => {
  it("owns an auto-scaled pane and takes it back", () => {
    const { model, price } = pricedModel();
    const installed = model.plot.use(attachSqueezeMomentum({ source: price, bbPeriod: 5, kcPeriod: 5 }));
    expect(model.plot.panes).toHaveLength(2);
    expect(model.plot.panes[1].autoScale).toBe(true);
    installed.dispose();
    expect(model.plot.panes).toHaveLength(1);
  });

  it("names the histogram from the defaults and keeps the marker rows out of the legend", () => {
    const { model, price } = pricedModel();
    model.plot.use(attachSqueezeMomentum({ source: price, bbPeriod: 5, kcPeriod: 5, pane: model.plot.mainPane }));
    model.plot.use(attachSqueezeMomentum({ source: price, bbPeriod: 5, kcPeriod: 5, pane: model.plot.mainPane, name: "Sq" }));
    model.plot.render();
    const samples = model.plot.mainPane.probe(30);
    const names = samples.map((sample) => sample.name).filter((name): name is string => name !== null);
    expect(names).toEqual(expect.arrayContaining(["Squeeze(5,2,5,1.5)", "Sq"]));
    // The two momentum histograms carry names; the four marker rows do not —
    // nor does the fixture's price series, which is the fifth unnamed sample.
    expect(samples.filter((sample) => sample.name === null)).toHaveLength(5);
  });

  it("colours the momentum bars on request and the marker rows by default", () => {
    const { model, price } = pricedModel();
    model.plot.use(
      attachSqueezeMomentum({
        source: price,
        bbPeriod: 5,
        kcPeriod: 5,
        pane: model.plot.mainPane,
        colors: { momentum: "#123456", squeezeOn: "#654321", squeezeOff: "#abcdef" },
      }),
    );
    model.plot.render();
    const samples = model.plot.mainPane.probe(30);
    expect(samples.find((sample) => sample.name === "Squeeze(5,2,5,1.5)")?.color).toBe("#123456");
    // The marker rows carry no registration colour (they carry no name either) — their colour is the series style.
    expect(samples.filter((sample) => sample.name === null).every((sample) => sample.color === null || sample.color === undefined)).toBe(true);
  });
});

describe("histogram colour shortcuts", () => {
  it("one colour given to the attach keeps every toned bar — the tone slots do not take it away", () => {
    const fillsOf = (colors: { histogram?: string } | undefined) => {
      const model = createPlotModel({
        size: { width: 800, height: 600 },
        config: { showGrid: false, axis: { x: { showLabels: false }, y: { showLabels: false } } },
        deps: { createStyleReader: () => (name) => ({ "--chart-histogram-up": "#0a0", "--chart-histogram-down": "#a00" })[name] ?? "" },
      });
      const price = model.plot.mainPane.addSeries({ series: candleSeries(), data: candles });
      model.plot.use(attachMacd({ source: price, fast: 3, slow: 6, signal: 3, colors }));
      model.plot.render();
      return new Set(model.commands().flatMap((c) => (c.type === "drawShape" && c.shape.shape === "rect" ? [c.shape.fill] : [])));
    };
    const themed = fillsOf(undefined);
    expect(themed.has("#0a0") && themed.has("#a00"), "without a shortcut the bars read the tone slots").toBe(true);
    const forced = fillsOf({ histogram: "#123456" });
    expect(forced.has("#123456")).toBe(true);
    expect(forced.has("#0a0") || forced.has("#a00"), "with one colour no bar reads a slot").toBe(false);
  });
});

describe("ownPane.stateKey", () => {
  it("names the own pane in persisted state, and stays off when not given", () => {
    const { model, price } = pricedModel();
    model.plot.use(attachRsi({ source: price, period: 5, ownPane: { stateKey: "rsi" } }));
    model.plot.use(attachMfi({ source: price, period: 5 }));
    expect(model.plot.panes[1].stateKey).toBe("rsi");
    expect(model.plot.panes[2].stateKey).toBeNull();
    expect(model.plot.getState().panes.map((pane) => pane.stateKey)).toEqual([undefined, "rsi", undefined]);
  });
});
