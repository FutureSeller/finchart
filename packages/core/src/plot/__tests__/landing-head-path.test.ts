/**
 * The landing head path at the entry level — which route a prepend takes,
 * and what the dev verification flag catches.
 *
 * The equivalence net (landing-equivalence.test.ts) proves the results
 * are right; this file proves the fast road was actually taken — a fast
 * path that silently falls back to the full walk is a regression the
 * result can't show.
 */
import { describe, expect, it } from "vitest";
import { DataError } from "../../primitives";
import type {
  BaseDataPoint,
  CoordinateAccessor,
  DataManager,
  DecimationStrategy,
  LineDataPoint,
  OHLC,
} from "../../data";
import type { Scale } from "../../scale";
import { barIndexX, LinearScale } from "../../scale";
import { candleSeries, lineSeries } from "../../series";
import { computation, M4Decimation, SimpleDataManager } from "../../data";
import { createPlotModel } from "../model";
import { Pane } from "../pane";

const bar = (x: number): OHLC => ({ x, open: x, high: x + 1, low: x - 1, close: x + 0.5 });
const bars = (from: number, to: number): OHLC[] => {
  const out: OHLC[] = [];
  for (let i = from; i < to; i++) out.push(bar(i));
  return out;
};

const sma = (period: number) => (source: readonly OHLC[]): LineDataPoint[] => {
  const out: LineDataPoint[] = [];
  let sum = 0;
  for (let i = 0; i < source.length; i++) {
    sum += source[i].close;
    if (i >= period) sum -= source[i - period].close;
    out.push({ x: source[i].x, y: i >= period - 1 ? sum / period : null });
  }
  return out;
};

/** Renumbers its whole output on every prepend — must take the full route. */
const brick = (source: readonly OHLC[]): LineDataPoint[] =>
  source.filter((_, i) => i % 3 === 0).map((point, i) => ({ x: i, y: point.close }));

function chart(options: { brick?: boolean; verify?: boolean } = {}) {
  const probe = { fullRebuilds: 0, onFullRebuild: () => void probe.fullRebuilds++ };
  const model = createPlotModel({
    size: { width: 800, height: 500 },
    series: null,
    deps: {
      createXMapping: (scale: Scale) => barIndexX(scale, probe),
      verifyLandings: options.verify,
    },
  });
  const price = model.plot.mainPane.addSeries({ series: candleSeries(), data: bars(100, 300) });
  const derived = model.plot.mainPane.addSeries({
    series: lineSeries(),
    data: bars(100, 300),
    derive: sma(7),
  });
  const extra = options.brick
    ? model.plot.mainPane.addSeries({ series: lineSeries(), data: bars(100, 300), derive: brick })
    : null;
  model.plot.render();
  return { model, price, derived, extra, probe };
}

describe("landing head path", () => {
  it("should land a page on identity + windowed-derive without a full mapping re-merge", () => {
    const { model, price, derived, probe } = chart();
    const walks = probe.fullRebuilds;

    for (const page of [bars(80, 100), bars(60, 80), bars(59, 60)]) {
      price.prepend(page);
      derived.prepend(page);
      model.plot.render();
    }

    expect(probe.fullRebuilds).toBe(walks);
  });

  it("should keep the view still while pages land — old bars keep their pixels", () => {
    const { model, price, derived } = chart();
    model.plot.setVisibleRange(150, 250);
    model.plot.render();
    const before = model.plot.pixelAtX(200);

    price.prepend(bars(80, 100));
    derived.prepend(bars(80, 100));
    model.plot.render();

    expect(model.plot.pixelAtX(200)).toBe(before);
  });

  it("should send a reshaping derivation down the full route, and still draw it right", () => {
    const { model, price, derived, extra, probe } = chart({ brick: true });
    const walks = probe.fullRebuilds;

    price.prepend(bars(80, 100));
    derived.prepend(bars(80, 100));
    extra?.prepend(bars(80, 100));
    model.plot.render();

    // The brick output renumbered — its xs are a new world, so the
    // mapping walks once. Falling back is the correct price here.
    expect(probe.fullRebuilds).toBeGreaterThan(walks);
    expect(extra?.read().map((p) => p.x)).toEqual(
      brick(bars(80, 300)).map((p) => p.x),
    );

    /**
     * The absolute oracle. The equivalence net compares twins that share
     * every code path, so corruption both sides agree on slips through —
     * a reshaped derivation fed to the head path would poison the merged
     * index identically in both charts. Present bars must sit on integer
     * ranks and round-trip; a poisoned merge breaks both.
     */
    model.plot.render();
    // The sample straddles both x worlds the merged index holds — the
    // brick ordinals and the price bars. A poisoned merge breaks the
    // ladder inside the brick region even when the price region still
    // lines up.
    const brickXs = brick(bars(80, 300)).map((point) => point.x);
    const sample = [
      brickXs[0],
      brickXs[Math.floor(brickXs.length / 2)],
      brickXs[brickXs.length - 1],
      85,
      150,
      250,
      299,
    ];
    for (const x of sample) {
      const rank = model.plot.xAt(model.plot.pixelAtX(x));
      expect(rank, `roundtrip of ${x}`).toBeCloseTo(x, 6);
    }
    const pixels = sample.map((x) => model.plot.pixelAtX(x));
    for (let i = 1; i < pixels.length; i++) {
      expect(pixels[i], "pixel monotonicity").toBeGreaterThan(pixels[i - 1]);
    }

    // Consecutive union values sit exactly one rank apart. Monotonicity
    // and round-trips both survive a merge with phantom duplicate slots —
    // this ladder is what doesn't.
    const union = [
      ...new Set([...brickXs, ...bars(80, 300).map((point) => point.x)]),
    ].sort((a, b) => a - b);
    const ladder = union.map((x) => model.plot.pixelAtX(x));
    const step = ladder[1] - ladder[0];
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i] - ladder[i - 1], `rank gap into ${union[i]}`).toBeCloseTo(
        step,
        6,
      );
    }
  });

  it("should keep a lone derivation's index whole through the fast path — non-uniform bars", () => {
    // No identity sibling: the derived registration's own xs cache is the
    // only source the mapping sees, so an off-by-one in the head growth
    // has nothing to hide behind. Non-uniform spacing on purpose — with
    // uniform bars, linear extrapolation of a missing value lands on the
    // right answer by coincidence.
    const probe = { fullRebuilds: 0, onFullRebuild: () => void probe.fullRebuilds++ };
    const model = createPlotModel({
      size: { width: 800, height: 500 },
      series: null,
      deps: { createXMapping: (scale: Scale) => barIndexX(scale, probe) },
    });
    const irregular = (from: number, to: number): OHLC[] => {
      const out: OHLC[] = [];
      for (let i = from; i < to; i++) out.push(bar(i * i));
      return out;
    };
    const derived = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: irregular(20, 40),
      derive: sma(5),
    });
    model.plot.render();
    const walks = probe.fullRebuilds;

    derived.prepend(irregular(12, 20));
    model.plot.render();

    expect(probe.fullRebuilds).toBe(walks);
    // Every bar answers to an integer rank spaced exactly one apart —
    // a swallowed or duplicated head bar shifts the ladder.
    const origin = model.plot.mainPane.area.left;
    void origin;
    const xsAll = irregular(12, 40).map((point) => point.x);
    const first = model.plot.pixelAtX(xsAll[0]);
    const step = model.plot.pixelAtX(xsAll[1]) - first;
    for (let i = 0; i < xsAll.length; i++) {
      expect(model.plot.pixelAtX(xsAll[i]), `rank of ${xsAll[i]}`).toBeCloseTo(
        first + step * i,
        6,
      );
    }
  });

  it("should honor deriveFirst — the landing pays the head, not a re-derivation", () => {
    const calls = { full: 0, head: 0 };
    const probe = { fullRebuilds: 0, onFullRebuild: () => void probe.fullRebuilds++ };
    const model = createPlotModel({
      size: { width: 800, height: 500 },
      series: null,
      deps: { createXMapping: (scale: Scale) => barIndexX(scale, probe) },
    });
    const derived = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: bars(100, 300),
      derive: (source) => {
        calls.full++;
        return sma(7)(source);
      },
      deriveFirst: {
        lookback: 6,
        head: (previous, source, change) => {
          calls.head++;
          return sma(7)(source.slice(0, change.count + Math.min(6, previous.length)));
        },
      },
    });
    model.plot.render();
    const fullBefore = calls.full;
    const walks = probe.fullRebuilds;

    derived.prepend(bars(80, 100));
    model.plot.render();

    expect(calls.full).toBe(fullBefore); // no re-derivation
    expect(calls.head).toBe(1);
    expect(probe.fullRebuilds).toBe(walks); // and the mapping stayed fast
    expect(derived.read()).toEqual(sma(7)(bars(80, 300)));
  });

  it("should safely fall back when a custom manager has no head landing door", () => {
    const calls = { full: 0, head: 0, setData: 0 };
    const pane = new Pane(
      new LinearScale(),
      <P extends BaseDataPoint>(coordinates: CoordinateAccessor<P>): DataManager<P> => {
        const inner = new SimpleDataManager<P>({
          coordinates,
          decimation: new M4Decimation(coordinates),
        });
        return {
          read: () => inner.read(),
          setData: (data) => {
            calls.setData++;
            inner.setData(data);
          },
          append: (data) => inner.append(data),
          prepend: (data) => inner.prepend(data),
          replaceLast: (point) => inner.replaceLast(point),
          getVisibleData: (viewport) => inner.getVisibleData(viewport),
          getXRange: () => inner.getXRange(),
        };
      },
    );
    const derived = pane.addSeries({
      series: lineSeries(),
      data: bars(100, 300),
      derive: (source) => {
        calls.full++;
        return sma(7)(source);
      },
      deriveFirst: {
        lookback: 6,
        head: (previous, source, change) => {
          calls.head++;
          return sma(7)(source.slice(0, change.count + Math.min(6, previous.length)));
        },
      },
    });
    const fullBefore = calls.full;
    const writesBefore = calls.setData;

    derived.prepend(bars(80, 100));

    expect(calls.head).toBe(0);
    expect(calls.full).toBe(fullBefore + 1);
    expect(calls.setData).toBe(writesBefore + 1);
    expect(derived.read()).toEqual(sma(7)(bars(80, 300)));
  });

  it("should refuse a deriveFirst head of the wrong length — the declaration is the contract", () => {
    const model = createPlotModel({ size: { width: 800, height: 500 }, series: null });
    const derived = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: bars(100, 300),
      derive: sma(7),
      deriveFirst: {
        lookback: 6,
        head: (previous, source, change) =>
          sma(7)(source.slice(0, change.count + Math.min(6, previous.length))).slice(1),
      },
    });
    model.plot.render();

    expect(() => derived.prepend(bars(80, 100))).toThrow(DataError);
  });

  it("should refuse a deriveFirst declaration with a negative or fractional lookback at the door", () => {
    // Math.min(-1, len) = -1 turns previous.slice(corrected) into
    // slice(-1) — the whole retained body silently truncates to one
    // point while the length check expects count - 1 and agrees. The
    // declaration is a chokepoint and gets refused before any landing.
    const model = createPlotModel({ size: { width: 800, height: 500 }, series: null });
    for (const lookback of [-1, 1.5, Number.NaN]) {
      expect(() =>
        model.plot.mainPane.addSeries({
          series: lineSeries(),
          data: bars(100, 300),
          derive: sma(7),
          deriveFirst: {
            lookback,
            head: (_p, source, change) => sma(7)(source.slice(0, change.count)),
          },
        }), `lookback ${lookback}`).toThrow(/lookback/);
    }
  });

  it("should refuse a short head even when there is no corrected zone to cross-check", () => {
    // With lookback 0 the corrected-x comparison has nothing to compare —
    // the length declaration is the only net, which is exactly why it is
    // a declaration and not an inference.
    const model = createPlotModel({ size: { width: 800, height: 500 }, series: null });
    const derived = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: bars(100, 300),
      derive: (source) => source.map((p) => ({ x: p.x, y: p.close })),
      deriveFirst: {
        lookback: 0,
        head: (_previous, source, change) =>
          source.slice(1, change.count).map((p) => ({ x: p.x, y: p.close })),
      },
    });
    model.plot.render();

    expect(() => derived.prepend(bars(80, 100))).toThrow(DataError);
  });

  it("should refuse a deriveFirst correction whose x drifts off the old head", () => {
    const model = createPlotModel({ size: { width: 800, height: 500 }, series: null });
    const derived = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: bars(100, 300),
      derive: sma(7),
      deriveFirst: {
        lookback: 6,
        head: (previous, source, change) => {
          const upto = change.count + Math.min(6, previous.length);
          const head = sma(7)(source.slice(0, upto));
          head[change.count] = { x: head[change.count].x + 0.5, y: head[change.count].y };
          return head;
        },
      },
    });
    model.plot.render();

    expect(() => derived.prepend(bars(80, 100))).toThrow(DataError);
  });

  it("should carry a calcFirst landing through the input registration without a full setData", () => {
    const calls = { full: 0 };
    const probe = { fullRebuilds: 0, onFullRebuild: () => void probe.fullRebuilds++ };
    const model = createPlotModel({
      size: { width: 800, height: 500 },
      series: null,
      deps: { createXMapping: (scale: Scale) => barIndexX(scale, probe) },
    });
    const price = model.plot.mainPane.addSeries({ series: candleSeries(), data: bars(100, 300) });
    const node = computation({
      inputs: [price],
      calc: (candles) => {
        calls.full++;
        return { ma: sma(7)(candles) };
      },
      calcFirst: (previous, [candles], [change]) => {
        if (change.kind === "none") return previous;
        const upto = change.count + Math.min(6, previous.ma.length);
        const head = sma(7)(candles.slice(0, upto));
        return { ma: [...head, ...previous.ma.slice(Math.min(6, previous.ma.length))] };
      },
    });
    model.plot.mainPane.addSeries({ series: lineSeries(), input: node.out.ma });
    model.plot.render();
    const fullBefore = calls.full;
    const walks = probe.fullRebuilds;

    price.prepend(bars(80, 100));
    model.plot.render();

    expect(calls.full).toBe(fullBefore);
    expect(probe.fullRebuilds).toBe(walks); // input xs grew in place too
    expect(node.out.ma.read()).toEqual(sma(7)(bars(80, 300)));
  });

  it("should reject a non-finite fresh derived body in production", () => {
    let poison = false;
    const evil = (source: readonly OHLC[]): LineDataPoint[] =>
      source.map((point, i) => ({
        x: point.x,
        y: poison && i === 150 ? Number.NaN : point.close,
      }));
    const probe = { fullRebuilds: 0, onFullRebuild: () => {} };
    const model = createPlotModel({
      size: { width: 800, height: 500 },
      series: null,
      deps: { createXMapping: (scale: Scale) => barIndexX(scale, probe) },
    });
    const derived = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: bars(100, 300),
      derive: evil,
    });
    model.plot.render();

    poison = true;
    expect(() => derived.prepend(bars(80, 100))).toThrow(DataError);
  });

  it("should preserve a fresh derived gap during a production landing", () => {
    let observedGapFree: boolean | undefined;
    const model = createPlotModel({
      size: { width: 800, height: 500 },
      series: null,
      deps: {
        createDecimation: <P extends BaseDataPoint>(
          coordinates: CoordinateAccessor<P>,
        ): DecimationStrategy<P> => {
          const inner = new M4Decimation<P>(coordinates);
          return {
            decimate(data, range, threshold, screenXScan, gapFree) {
              observedGapFree = gapFree;
              return inner.decimate(data, range, threshold, screenXScan, gapFree);
            },
          };
        },
      },
    });
    let leaveGap = false;
    const derived = model.plot.mainPane.addSeries({
      series: lineSeries(),
      data: bars(100, 300),
      derive: (source) =>
        source.map((point, i) => ({
          x: point.x,
          // Deliberately in the retained body, not the newly landed page.
          y: leaveGap && i === 150 ? null : point.close,
        })),
    });
    model.plot.render();
    expect(observedGapFree).toBe(true);

    leaveGap = true;
    derived.prepend(bars(80, 100));
    model.plot.render();

    // `gapFree: false` makes M4 preserve the whitespace instead of joining
    // the two value runs with a line. This is production mode: no dev flag.
    expect(observedGapFree).toBe(false);
  });
});
