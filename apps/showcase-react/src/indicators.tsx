import { sessionStart } from "@finchart/core";
/**
 * Indicators — this is where the two lanes part.
 *
 * **The overlays (MA, BOLL, VWAP) take the declarative `input` lane**: one
 * computation node is built with `useMemo` and its branches (`node.out.*`) ride
 * in as `input`. BOLL's bands and its center line share **one** computation, and
 * the indicator math belongs to `@finchart/indicators` (the app used to
 * reimplement sma, stddev and VWAP by hand — a showcase that didn't use the
 * library).
 *
 * **The own-pane indicators (RSI, MACD) stay on `attach*`.** They make their own
 * pane and never overlap the declarative list, so `usePlugin` plus
 * `useDataSource` carries vanilla's one-liner across unchanged.
 */
import type { OHLC, Source } from "@finchart/core";
import {
  attachMacd,
  attachRsi,
  bandSeries,
  bollingerBands,
  movingAverage,
  periodAnchor,
  vwap,
} from "@finchart/indicators";
import { ChartLine, ChartSeries, usePlugin } from "@finchart/react";
import { useMemo } from "react";

export type IndicatorKey = "MA20" | "BOLL" | "RSI" | "MACD" | "VWAP";
const KEYS: readonly IndicatorKey[] = ["MA20", "BOLL", "RSI", "MACD", "VWAP"];

// --- The toggle UI (header) ---

export function IndicatorToggles({
  active,
  onToggle,
}: {
  active: ReadonlySet<IndicatorKey>;
  onToggle: (key: IndicatorKey) => void;
}) {
  return (
    <div id="indicators" role="group" aria-label="Indicators">
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed={active.has(key)}
          onClick={() => onToggle(key)}
        >
          {key}
        </button>
      ))}
    </div>
  );
}

// --- Overlays — one computation node, several branches ---

const MA_PERIOD = 20;
const BOLL_PERIOD = 20;

const BOLL_BAND_SERIES = bandSeries();

/** The things that overlay the price pane — they go inside `<ChartPane>`, after the price series. */
export function OverlayIndicators({
  active,
  source,
}: {
  active: ReadonlySet<IndicatorKey>;
  source: Source<OHLC>;
}) {
  // One node per mount — the reference is the identity (the `input` contract).
  // Computation is lazy, so nobody pulls on the node of an indicator that's off.
  const nodes = useMemo(
    () => ({
      ma: movingAverage(source, { period: MA_PERIOD }),
      boll: bollingerBands(source, { period: BOLL_PERIOD }),
      vwap: vwap(source, { anchor: periodAnchor({ barStart: sessionStart({ timeZone: "UTC" }) }) }),
    }),
    [source],
  );

  return (
    <>
      {active.has("BOLL") ? (
        <>
          <ChartSeries
            series={BOLL_BAND_SERIES}
            input={nodes.boll.out.band}
            name="BOLL"
          />
          {/* The center line shares the bands' node — sma isn't folded twice */}
          <ChartLine input={nodes.boll.out.middle} color="#8b5cf6" width={1} pointRadius={0} />
        </>
      ) : null}
      {active.has("MA20") ? (
        <ChartLine
          name={`MA${MA_PERIOD}`}
          input={nodes.ma.out.ma}
          color="#f59e0b"
          width={1.5}
          pointRadius={0}
        />
      ) : null}
      {active.has("VWAP") ? (
        <ChartLine
          name="VWAP"
          input={nodes.vwap.out.vwap}
          color="#0ea5e9"
          width={1.5}
          pointRadius={0}
        />
      ) : null}
    </>
  );
}

// --- Own-pane indicators — the imperative lane ---

function RsiPane({ source }: { source: Source<OHLC> }) {
  usePlugin((plot) => plot.use(attachRsi({ source })), [source]);
  return null;
}

function MacdPane({ source }: { source: Source<OHLC> }) {
  usePlugin((plot) => plot.use(attachMacd({ source })), [source]);
  return null;
}

/** The indicators that make their own pane — placed last so the leading pane indexes stay put. */
export function OwnedPaneIndicators({
  active,
  source,
}: {
  active: ReadonlySet<IndicatorKey>;
  source: Source<OHLC>;
}) {
  return (
    <>
      {active.has("RSI") ? <RsiPane source={source} /> : null}
      {active.has("MACD") ? <MacdPane source={source} /> : null}
    </>
  );
}
