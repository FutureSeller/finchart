/**
 * `no-amplifier` is a contract, not just a claim — it moves what used to be
 * checked by hand (feed a hostile value -> zero state residue by the next
 * frame, command count unchanged) into machine verification. It reads
 * `tag: "no-amplifier"` from `boundary-values`'s `EXEMPT`, so tagging an
 * entry puts it under this probe's jurisdiction.
 *
 * What the probe checks: a stage that had a door fed a hostile value
 * attached and then detached must match, command for command, a stage
 * where nothing happened at all. If a bad value leaves any trace of state
 * behind, this is where it shows up.
 *
 * Not every door is wired up yet — `UNWIRED` is an exact roster, so if it
 * grows, this fails loudly (a new no-amplifier tag must ship with its
 * feeding recipe).
 */
import { describe, expect, it } from "vitest";
import type { LineDataPoint, OHLC } from "../data";
import { LineDataAccessor } from "../data";
import {
  crosshair,
  crosshairLine,
  markers,
  priceLine,
  span,
  syncCrosshair,
  timeCursor,
} from "../extensions";
import {
  AreaSeries,
  areaSeries,
  BarSeries,
  barSeries,
  BaselineSeries,
  baselineSeries,
  CandleSeries,
  candleSeries,
  HistogramSeries,
  histogramSeries,
  LineSeries,
  StepLineSeries,
  lineSeries,
  stepLineSeries,
} from "../series";
import type { Series } from "../series";
import { AREA_STYLE_SPEC } from "../series/area-series";
import { BAR_STYLE_SPEC } from "../series/bar-series";
import { BASELINE_STYLE_SPEC } from "../series/baseline-series";
import { CANDLE_STYLE_SPEC } from "../series/candle-series";
import { HISTOGRAM_STYLE_SPEC } from "../series/histogram-series";
import { LINE_STYLE_SPEC } from "../series/line-series";
import { createPlotModel } from "../plot/model";
import { InputRouter } from "../interaction/input-router";
import type { InputEvent } from "../interaction/input-router";
import {
  drawCustom,
  eachFallback,
  fillLinearGradient,
  isLinearGradientParams,
  noStyle,
  paintLinearGradient,
  recordingRenderer,
  resolveStyle,
  styleVars,
} from "../render";
import { ContractError } from "../primitives";
import { fakeCanvasContext } from "./dom-fakes";
import { EXEMPT } from "./exemptions";

/** The hostile numbers JSON can carry — shares a root with `HOSTILE_NUMBERS`. */
const HOSTILE = [
  ["NaN", NaN],
  ["Infinity", Infinity],
  ["-Infinity", -Infinity],
] as const;

const line: LineDataPoint[] = Array.from({ length: 30 }, (_, i) => ({
  x: i,
  y: 100 + (i % 7),
}));

function stage() {
  return createPlotModel({
    size: { width: 400, height: 300 },
    series: { series: lineSeries(), data: line },
    config: { showGrid: false },
  });
}

type Stage = ReturnType<typeof stage>;

/**
 * A feeding recipe for each door — puts a hostile value into that door's
 * numeric slot, attaches it to the stage, and returns a handle to detach
 * it. The probe attaches, draws, detaches, and draws again.
 */
const candles: OHLC[] = Array.from({ length: 30 }, (_, i) => ({
  x: i,
  open: 100 + i,
  high: 104 + i,
  low: 98 + i,
  close: 102 + (i % 3),
}));

/**
 * The feeding shared by the whole series family — attaches, then detaches,
 * a series carrying a hostile style value. The numeric slots come from
 * each spec table (the "numeric slot count matches spec" check below
 * guards that derivation — it fails loudly if the hand-written list falls
 * behind the spec).
 */
function seriesDoor<P extends LineDataPoint | OHLC>(
  build: (bad: number) => Series<P>,
  data: readonly P[],
): (model: Stage, bad: number) => () => void {
  return (model, bad) => {
    const handle = model.plot.mainPane.addSeries({
      series: build(bad),
      data: [...data],
    });
    return () => handle.dispose();
  };
}

const RESIDUE_PROBES: Record<string, (model: Stage, bad: number) => () => void> =
  {
    lineSeries: seriesDoor(
      (bad) => lineSeries({ line: { width: bad }, point: { radius: bad } }),
      line,
    ),
    // The step variant only differs in its draw path — the door is the same one as its sibling.
    stepLineSeries: seriesDoor(
      (bad) => stepLineSeries({ line: { width: bad }, point: { radius: bad } }),
      line,
    ),
    areaSeries: seriesDoor(
      (bad) => areaSeries({ line: { width: bad } }),
      line,
    ),
    baselineSeries: seriesDoor(
      (bad) => baselineSeries({ baseline: 100, style: { lineWidth: bad } }),
      line,
    ),
    histogramSeries: seriesDoor(
      (bad) => histogramSeries({ style: { barRatio: bad } }),
      line,
    ),
    candleSeries: seriesDoor(
      (bad) => candleSeries({ wickWidth: bad, bodyRatio: bad }),
      candles,
    ),
    barSeries: seriesDoor(
      (bad) => barSeries({ lineWidth: bad, tickRatio: bad }),
      candles,
    ),
    LineSeries: seriesDoor(
      (bad) =>
        new LineSeries({
          coordinates: new LineDataAccessor(),
          style: { line: { width: bad }, point: { radius: bad } },
        }),
      line,
    ),
    StepLineSeries: seriesDoor(
      (bad) =>
        new StepLineSeries({
          coordinates: new LineDataAccessor(),
          style: { line: { width: bad }, point: { radius: bad } },
        }),
      line,
    ),
    AreaSeries: seriesDoor(
      (bad) =>
        new AreaSeries({
          coordinates: new LineDataAccessor(),
          style: { line: { width: bad } },
        }),
      line,
    ),
    BaselineSeries: seriesDoor(
      (bad) => new BaselineSeries({ style: { lineWidth: bad } }),
      line,
    ),
    HistogramSeries: seriesDoor(
      (bad) => new HistogramSeries({ style: { barRatio: bad } }),
      line,
    ),
    CandleSeries: seriesDoor(
      (bad) => new CandleSeries({ wickWidth: bad, bodyRatio: bad }),
      candles,
    ),
    BarSeries: seriesDoor(
      (bad) => new BarSeries({ lineWidth: bad, tickRatio: bad }),
      candles,
    ),
    priceLine: (model, bad) =>
      model.plot.mainPane.addDecoration(priceLine({ value: bad })),
    markers: (model, bad) =>
      model.plot.mainPane.addDecoration(markers([{ x: bad, price: 100 }])),
    span: (model, bad) =>
      model.plot.addDecoration(span({ from: bad, to: 20 })),
    timeCursor: (model, bad) => {
      const cursor = timeCursor();
      const off = model.plot.addDecoration(cursor);
      cursor.follow(bad);
      return () => {
        cursor.follow(null);
        off();
      };
    },
    crosshairLine: (model, bad) => {
      const decoration = crosshairLine();
      const off = model.plot.addDecoration(decoration);
      decoration.follow({ x: bad, y: bad });
      return () => {
        decoration.follow(null);
        off();
      };
    },
    crosshair: (model, bad) => {
      const api = model.plot.use(crosshair());
      // The feed travels via an event here — it arrives as cursor
      // coordinates. If the door rejects it, the probe's rejection branch
      // catches it.
      model.plot.crosshair({ x: bad, y: bad });
      return () => api.dispose();
    },
    syncCrosshair: (model, bad) => {
      // The ghost cursor lives on the receiving stage — feed the hostile
      // cursor to the sending stage so the ghost lands on the stage under
      // test (model).
      const sender = stage();
      sender.plot.render();
      const off = syncCrosshair(sender.plot, model.plot);
      sender.plot.crosshair({ x: bad, y: bad });
      return off;
    },
  };

/**
 * The probe for doors that have no stage — call determinism. Pure
 * functions and standalone classes have nothing to attach to or detach
 * from. The definition of residue stays the same: a normal call made
 * after a hostile feed must produce the same result as a normal call made
 * from a clean start.
 */
const goodGradient = () => ({
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  from: { x: 0, y: 0 },
  to: { x: 0, y: 10 },
  stops: [
    { offset: 0, color: "#000000" },
    { offset: 1, color: "#ffffff" },
  ],
});


/** The surface the recording renderer requires — only the size matters. */
const fakeSurface = () => ({
  width: 100,
  height: 100,
  context: fakeCanvasContext(),
});

const goodPointerSequence: InputEvent[] = [
  { type: "pointerdown", point: { x: 10, y: 10 }, pointerId: 1 },
  { type: "pointermove", point: { x: 12, y: 12 }, pointerId: 1 },
  { type: "pointerup", point: { x: 12, y: 12 }, pointerId: 1 },
];

const FUNCTION_PROBES: Record<
  string,
  { control: () => unknown; probed: (bad: number) => unknown }
> = {
  styleVars: {
    control: () => styleVars({ w: { css: "--w", fallback: 2 } }),
    probed: (bad) => {
      styleVars({ w: { css: "--w", fallback: bad } });
      return styleVars({ w: { css: "--w", fallback: 2 } });
    },
  },
  resolveStyle: {
    control: () =>
      resolveStyle({ w: { css: "--w", fallback: 2 } }, noStyle, { w: 3 }),
    probed: (bad) => {
      resolveStyle({ w: { css: "--w", fallback: 2 } }, noStyle, { w: bad });
      return resolveStyle({ w: { css: "--w", fallback: 2 } }, noStyle, { w: 3 });
    },
  },
  isLinearGradientParams: {
    control: () => isLinearGradientParams(goodGradient()),
    probed: (bad) => {
      isLinearGradientParams({ ...goodGradient(), from: { x: bad, y: bad } });
      return isLinearGradientParams(goodGradient());
    },
  },
  fillLinearGradient: {
    control: () => {
      const recorder = recordingRenderer();
      const target = recorder.factory(fakeSurface());
      fillLinearGradient(target, goodGradient());
      target.commit();
      return recorder.commands();
    },
    probed: (bad) => {
      fillLinearGradient(recordingRenderer().factory(fakeSurface()), {
        ...goodGradient(),
        from: { x: bad, y: bad },
      });
      const recorder = recordingRenderer();
      const target = recorder.factory(fakeSurface());
      fillLinearGradient(target, goodGradient());
      target.commit();
      return recorder.commands();
    },
  },
  paintLinearGradient: {
    control: () => {
      const context = fakeCanvasContext();
      paintLinearGradient(context, goodGradient());
      // The recording carries the gradient object (which has a function
      // field), so deep-equal would fail on identity instead — project onto
      // the call sequence and compare that.
      return context.calls.map((call) => call.method);
    },
    probed: (bad) => {
      paintLinearGradient(fakeCanvasContext(), {
        ...goodGradient(),
        from: { x: bad, y: bad },
      });
      const context = fakeCanvasContext();
      paintLinearGradient(context, goodGradient());
      return context.calls.map((call) => call.method);
    },
  },
  drawCustom: {
    control: () => {
      const recorder = recordingRenderer();
      const target = recorder.factory(fakeSurface());
      drawCustom(target, {
        name: "probe",
        params: null,
        fallback: [
          {
            type: "drawLine",
            points: [
              { x: 0, y: 0 },
              { x: 5, y: 5 },
            ],
            style: { width: 1, color: "#000000" },
          },
        ],
      });
      target.commit();
      return recorder.commands();
    },
    probed: (bad) => {
      drawCustom(recordingRenderer().factory(fakeSurface()), {
        name: "probe",
        params: null,
        fallback: [
          {
            type: "drawLine",
            points: [
              { x: bad, y: bad },
              { x: 5, y: 5 },
            ],
            style: { width: bad, color: "#000000" },
          },
        ],
      });
      const recorder = recordingRenderer();
      const target = recorder.factory(fakeSurface());
      drawCustom(target, {
        name: "probe",
        params: null,
        fallback: [
          {
            type: "drawLine",
            points: [
              { x: 0, y: 0 },
              { x: 5, y: 5 },
            ],
            style: { width: 1, color: "#000000" },
          },
        ],
      });
      target.commit();
      return recorder.commands();
    },
  },
  eachFallback: {
    control: () => {
      const seen: string[] = [];
      eachFallback(
        {
          name: "probe",
          params: null,
        fallback: [
            {
              type: "drawLine",
              points: [{ x: 1, y: 1 }],
              style: { width: 1, color: "#000000" },
            },
          ],
        },
        (command) => seen.push(command.type),
      );
      return seen;
    },
    probed: (bad) => {
      eachFallback(
        {
          name: "probe",
          params: null,
        fallback: [
            {
              type: "drawLine",
              points: [{ x: bad, y: bad }],
              style: { width: bad, color: "#000000" },
            },
          ],
        },
        () => {},
      );
      const seen: string[] = [];
      eachFallback(
        {
          name: "probe",
          params: null,
        fallback: [
            {
              type: "drawLine",
              points: [{ x: 1, y: 1 }],
              style: { width: 1, color: "#000000" },
            },
          ],
        },
        (command) => seen.push(command.type),
      );
      return seen;
    },
  },
  InputRouter: {
    control: () => {
      const log: string[] = [];
      const router = new InputRouter();
      router.add({
        handle: (event) => {
          log.push(
            "point" in event
              ? `${event.type} ${event.point.x},${event.point.y}`
              : event.type,
          );
          return false;
        },
      });
      for (const event of goodPointerSequence) router.route(event);
      return log;
    },
    // The router carries instance state (captures), so the contamination
    // check only means something **inside the same instance**: the normal
    // sequence played after a hostile-coordinate gesture must match the
    // normal sequence on a fresh router.
    probed: (bad) => {
      const log: string[] = [];
      const router = new InputRouter();
      router.add({
        handle: (event) => {
          log.push(
            "point" in event
              ? `${event.type} ${event.point.x},${event.point.y}`
              : event.type,
          );
          return false;
        },
      });
      const hostile: InputEvent[] = [
        { type: "pointerdown", point: { x: bad, y: bad }, pointerId: 7 },
        { type: "pointermove", point: { x: bad, y: bad }, pointerId: 7 },
        { type: "pointerup", point: { x: bad, y: bad }, pointerId: 7 },
      ];
      for (const event of hostile) router.route(event);
      log.length = 0;
      for (const event of goodPointerSequence) router.route(event);
      return log;
    },
  },
};

/** no-amplifier doors that don't have a recipe yet — an exact roster, so it cannot grow. A new tag ships its recipe alongside it. */
const UNWIRED = [] as const;

describe("no-amplifier — a bad value leaves no residue", () => {
  /**
   * Derives the feed's scope from the spec tables. Because the series
   * recipes' numeric slots were written by hand, this fails loudly whenever
   * a spec gains a new numeric leaf, forcing the recipe to catch up.
   */
  it("series feed's numeric slot count matches the spec table", () => {
    const numericLeaves = (node: object): number => {
      let count = 0;
      for (const value of Object.values(node)) {
        if (typeof value !== "object" || value === null) continue;
        if ("fallback" in value) {
          if (typeof value.fallback === "number") count += 1;
          continue;
        }
        count += numericLeaves(value);
      }
      return count;
    };

    expect(
      [
        LINE_STYLE_SPEC,
        AREA_STYLE_SPEC,
        BASELINE_STYLE_SPEC,
        HISTOGRAM_STYLE_SPEC,
        CANDLE_STYLE_SPEC,
        BAR_STYLE_SPEC,
      ].map(numericLeaves),
      // line {width·radius} · area {width} · baseline {lineWidth} ·
      // histogram {barRatio} · candle {wickWidth·bodyRatio} · bar {lineWidth·tickRatio}
    ).toEqual([2, 1, 1, 1, 2, 2]);
  });

  it("every tag is either a recipe or on the roster — a new tag ships its recipe alongside it", () => {
    const tagged = Object.entries(EXEMPT)
      .filter(([, exemption]) => exemption.tag === "no-amplifier")
      .map(([name]) => name)
      .sort();

    expect(tagged).toEqual(
      [
        ...Object.keys(RESIDUE_PROBES),
        ...Object.keys(FUNCTION_PROBES),
        ...UNWIRED,
      ].sort(),
    );
  });

  /**
   * Covers both faces of non-amplification — rejection (throws in contract
   * vocabulary and leaves nothing behind) and harmlessness (accepts it but
   * leaves no trace by the next frame). Either way, zero residue is the
   * contract, and when it rejects, the vocabulary it rejects with is part
   * of the contract too.
   */
  describe.each(Object.keys(RESIDUE_PROBES))("%s", (name) => {
    it.each(HOSTILE)("a stage fed %s and then detached is clean", (_label, bad) => {
      const control = stage();
      control.plot.render();
      control.plot.render();

      const probed = stage();
      probed.plot.render();
      let detach: (() => void) | null = null;
      try {
        detach = RESIDUE_PROBES[name](probed, bad);
      } catch (error) {
        // If it rejects, it must be contract vocabulary, not a raw TypeError.
        expect(error).toBeInstanceOf(ContractError);
      }
      probed.plot.render();
      detach?.();
      probed.plot.render();

      expect(probed.commands()).toEqual(control.commands());
    });
  });

  /** Doors with no stage — a normal call after a hostile feed must match,
   * result for result, one made from a clean start. Rejecting the feed with
   * contract vocabulary counts as non-amplification too. */
  describe.each(Object.keys(FUNCTION_PROBES))("%s", (name) => {
    it.each(HOSTILE)("the answer stays deterministic even after a feed of %s", (_label, bad) => {
      const door = FUNCTION_PROBES[name];
      const control = door.control();
      let after: unknown;
      try {
        after = door.probed(bad);
      } catch (error) {
        expect(error).toBeInstanceOf(ContractError);
        after = door.control();
      }
      expect(after).toEqual(control);
    });
  });
});
