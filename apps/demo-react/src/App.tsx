/**
 * The React edition of the demo — a **focus model** over four chart slots.
 *
 * There is no primary/comparison split: every slot is a `<FullChart>` (its own
 * symbol, timeframe, type, indicators, drawings and feed), and the header
 * controls, price readout, rail and actions all reflect and drive the
 * **focused** chart. Linking x is `<SyncX>`; it speaks in data x, so charts keep
 * the same time window even when their settings differ.
 *
 * **The app owns the settings, the chart owns the data**: per-chart timeframe,
 * type and indicator set are state here, while bars, feed and hover live inside
 * `FullChart`.
 *
 * The tape (`data`, `feed`), the formatting (`format`) and the icons are copies
 * of vanilla's. This edition also adapts its layout to narrow screens.
 */
import type { Plot, XDomainChangePayload } from "@finchart/core";
import { SyncCrosshair, SyncX, usePluginState } from "@finchart/react";
import type { DrawingToolsApi } from "@finchart/tools";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Actions } from "./actions";
import {
  CHART_SLOTS,
  FullChart,
  SYMBOLS,
  isChartType,
  specOf,
  type ChartSettings,
  type ChartType,
  type FocusSnapshot,
} from "./full-chart";
import { SymbolHeader } from "./header";
import { IndicatorToggles, type IndicatorKey } from "./indicators";
import { LiveReturn } from "./live-return";
import { Rail, type ToolMode } from "./rail";

const TIMEFRAMES = [1, 5, 15, 60];
const LAYOUTS: ReadonlyArray<1 | 2 | 4> = [1, 2, 4];

/** The starting state from a shared URL — it belongs to slot 0. */
const INITIAL = (() => {
  const shared = new URLSearchParams(location.search);

  const tf = Number(shared.get("tf"));
  const timeframe = TIMEFRAMES.includes(tf) ? tf : 5;
  const typeParam = shared.get("type");
  const chartType: ChartType =
    typeParam && isChartType(typeParam) ? typeParam : "candle";
  // The symbol is read back too — an unknown name leaves the slot's default alone.
  const symbolParam = shared.get("symbol");
  const symbol = SYMBOLS.some((entry) => entry.symbol === symbolParam)
    ? symbolParam
    : null;
  return {
    timeframe,
    chartType,
    symbol,
  };
})();

const defaultSettings = (slot: number): ChartSettings => ({
  timeframe: slot === 0 ? INITIAL.timeframe : 5,
  chartType: slot === 0 ? INITIAL.chartType : "candle",
  active: new Set<IndicatorKey>(slot === 0 ? ["MA20"] : []),
});

/** Everything one slot knows — the settings the app owns, plus the handles the chart pushed up. */
interface SlotState {
  symbol: string;
  settings: ChartSettings;
  plot: Plot | null;
  tools: DrawingToolsApi | null;
}

// What usePluginState takes — a stable reference is the contract, so it's a module constant.
const subscribeMode = (tools: DrawingToolsApi, onChange: () => void) =>
  tools.modeChanges.subscribe(onChange);
const readMode = (tools: DrawingToolsApi) => tools.mode();
const readSelection = (tools: DrawingToolsApi) => tools.selection() !== null;

export function App() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [mobile, setMobile] = useState(() => matchMedia("(max-width: 768px)").matches);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const query = matchMedia("(max-width: 768px)");
    const update = () => {
      setMobile(query.matches);
      setSettingsOpen(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!mobile || !settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setSettingsOpen(false);
      settingsButtonRef.current?.focus();
    };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  }, [mobile, settingsOpen]);

  // --- Per-chart state — settings here, data inside FullChart ---
  const [layout, setLayout] = useState<1 | 2 | 4>(1);
  const [focus, setFocus] = useState(0);
  /**
   * One slot is one record. It used to be four parallel arrays — settings,
   * symbol, chart and tools — and every new field added another array. The app
   * holds the symbol, and the settings survive a change of symbol.
   */
  const [slots, setSlots] = useState<SlotState[]>(() =>
    CHART_SLOTS.map((spec, slot) => ({
      // Only slot 0 follows the shared link's symbol — the rest keep the default arrangement.
      symbol: slot === 0 ? (INITIAL.symbol ?? spec.symbol) : spec.symbol,
      settings: defaultSettings(slot),
      plot: null,
      tools: null,
    })),
  );

  const patchSlot = useCallback(
    (slot: number, patch: Partial<SlotState>) =>
      setSlots((prev) =>
        prev.map((entry, i) => (i === slot ? { ...entry, ...patch } : entry)),
      ),
    [],
  );
  const plots = useMemo(() => slots.map((entry) => entry.plot), [slots]);

  const [snapshot, setSnapshot] = useState<FocusSnapshot | null>(null);
  const [domain, setDomain] = useState<XDomainChangePayload | null>(null);
  const [light, setLight] = useState(false);

  const focused = slots[focus].settings;
  const focusedPlot = slots[focus].plot;
  const focusedTools = slots[focus].tools;

  // --- Tool state — a snapshot plus a subscription becomes React state through usePluginState ---
  const toolMode: ToolMode = usePluginState(
    focusedTools,
    subscribeMode,
    readMode,
    null,
  );
  // The selection changes both from the tools and from a click on the chart — the subscriptions are combined.
  const subscribeSelection = useCallback(
    (tools: DrawingToolsApi, onChange: () => void) => {
      const offChanges = tools.changes.subscribe(onChange);
      const offClick = focusedPlot?.on("click", onChange);
      return () => {
        offChanges();
        offClick?.();
      };
    },
    [focusedPlot],
  );
  const hasSelection = usePluginState(
    focusedTools,
    subscribeSelection,
    readSelection,
    false,
  );

  // A callback per slot — stable references keep onPlot/onTools from thrashing every render.
  const slotCallbacks = useMemo(
    () =>
      CHART_SLOTS.map((_, slot) => ({
        onPlot: (plot: Plot | null) => patchSlot(slot, { plot }),
        onTools: (tools: DrawingToolsApi | null) => patchSlot(slot, { tools }),
        onSymbol: (symbol: string) => patchSlot(slot, { symbol }),
        onFocus: () => setFocus(slot),
      })),
    [patchSlot],
  );

  const patchSettings = (slot: number, patch: Partial<ChartSettings>) =>
    setSlots((prev) =>
      prev.map((entry, i) =>
        i === slot ? { ...entry, settings: { ...entry.settings, ...patch } } : entry,
      ),
    );

  // When the layout shrinks, focus falls back to a cell that is still alive.
  useEffect(() => {
    if (focus >= layout) setFocus(0);
  }, [focus, layout]);

  // Number keys 1–4 move focus — click-only focus is an accessibility hole.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const slot = Number(event.key) - 1;
      if (Number.isInteger(slot) && slot >= 0 && slot < layout) setFocus(slot);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [layout]);

  // When the list of charts changes, the anchor's (slot 0's) window is restated
  // — a new cell inherits it, and the last noise a departing cell left behind is
  // painted over. The shared starting range was already applied by FullChart
  // (slot 0), so all this does is hand the current window around. <SyncX> is a
  // child, so its rewiring finishes first.
  useEffect(() => {
    const anchor = plots[0];
    if (!anchor) return;

    const window = anchor.getVisibleRange();
    if (window) anchor.setVisibleRange(window.min, window.max);
  }, [plots]);

  // --- Theme — colors are CSS variables; each chart redraws itself (`followTheme`) ---
  useEffect(() => {
    document.body.classList.toggle("light", light);
  }, [light]);

  // A functional update — read the render-time closure instead and, when
  // successive toggles batch into one frame, the later one overwrites the
  // earlier.
  const toggleIndicator = (key: IndicatorKey) => {
    setSlots((prev) =>
      prev.map((entry, i) => {
        if (i !== focus) return entry;
        const next = new Set(entry.settings.active);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...entry, settings: { ...entry.settings, active: next } };
      }),
    );
  };

  const drawingRail = (
    <Rail
      tools={focusedTools}
      plot={focusedPlot}
      mode={toolMode}
      hasSelection={hasSelection}
    />
  );

  return (
    <div id="app">
      <header id="header">
        <SymbolHeader
          symbol={snapshot?.symbol ?? slots[focus].symbol}
          last={snapshot?.last ?? null}
          shown={snapshot?.shown ?? null}
          refClose={snapshot?.refClose ?? 1}
        />
        <button
          id="settings-toggle"
          ref={settingsButtonRef}
          type="button"
          hidden={!mobile}
          aria-expanded={settingsOpen}
          aria-controls="controls"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          Settings
        </button>
        <div
          id="controls"
          hidden={mobile && !settingsOpen}
        >
          <div id="chart-types" role="group" aria-label="Chart type">
            {(
              [
                ["candle", "Candles"],
                ["bar", "Bars"],
                ["line", "Line"],
                ["area", "Area"],
              ] as ReadonlyArray<readonly [ChartType, string]>
            ).map(([type, label]) => (
              <button
                key={type}
                type="button"
                aria-pressed={focused.chartType === type}
                onClick={() => patchSettings(focus, { chartType: type })}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="divider" aria-hidden="true" />
          <div id="timeframes" role="group" aria-label="Timeframe">
            {TIMEFRAMES.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={focused.timeframe === n}
                onClick={() => patchSettings(focus, { timeframe: n })}
              >
                {n < 60 ? `${n}m` : `${n / 60}h`}
              </button>
            ))}
          </div>
          <span className="divider" aria-hidden="true" />
          <IndicatorToggles active={focused.active} onToggle={toggleIndicator} />
          <span className="divider" aria-hidden="true" />
          <div id="layouts" role="group" aria-label="Layout">
            {LAYOUTS.map((n) => (
              <button
                key={n}
                type="button"
                title={`${n} panel${n > 1 ? "s" : ""}`}
                aria-pressed={layout === n}
                onClick={() => setLayout(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <span className="divider" aria-hidden="true" />
          <Actions
            plot={focusedPlot}
            light={light}
            onLight={() => setLight((prev) => !prev)}
          />
          {mobile && drawingRail}
        </div>
      </header>

      {!mobile && drawingRail}

      <main
        id="stage"
        ref={stageRef}
        style={{ cursor: toolMode ? "crosshair" : undefined }}
      >
        <div id="charts" data-layout={layout}>
          {slots.slice(0, layout).map((entry, slot) => (
            <FullChart
              key={`${slot}:${entry.symbol}`}
              spec={specOf(entry.symbol)}
              settings={entry.settings}
              focused={focus === slot}
              onFocus={slotCallbacks[slot].onFocus}
              onSymbol={slotCallbacks[slot].onSymbol}
              onPlot={slotCallbacks[slot].onPlot}
              onTools={slotCallbacks[slot].onTools}
              onSnapshot={setSnapshot}
              onXDomainChange={slot === 0 ? setDomain : undefined}
            />
          ))}
        </div>
        <SyncX plots={plots} />
        <SyncCrosshair plots={plots} />
        <LiveReturn plot={plots[0] ?? null} stageRef={stageRef} domain={domain} />
      </main>

      <footer id="statusbar">
        <span id="live">
          <span className="dot" aria-hidden="true" />
          Live
        </span>
        <span id="status">
          {`${snapshot?.symbol ?? slots[focus].symbol} · ${
            focused.timeframe
          }m · ${(snapshot?.barCount ?? 0).toLocaleString("en")} bars · UTC`}
        </span>
      </footer>
    </div>
  );
}
