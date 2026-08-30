import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { OHLC } from "@finchart/core";
import { candleSeries, crosshair, priceFormat, timeTicks } from "@finchart/core";
import { drawingTools } from "@finchart/tools";
import { fixtureCandles } from "./fixture";
import { chartHost } from "./stage";

export const title = "Drawing tools";
export const description =
  "Press a button and click the chart to draw — once for a horizontal line, twice for a trend line or a Fibonacci. Esc cancels, Delete removes the selection, dragging an endpoint edits. " +
  "`]` and `[` cycle the selection without a pointer (the keys only arrive once you've clicked the chart to give it focus). " +
  "For touch and anything else without a keyboard, the three buttons below (deselect · delete · clear all) do the same work. " +
  "What you draw is saved to localStorage — a serialize()/load() round trip, so it survives a refresh and a theme switch (a remount). A drag-move carries reason \"move\", so only its save is deferred. " +
  "Turn the magnet on and drawing and endpoint drags snap to a bar's close, low, and high (and the bar's x) — you don't leave a peak to pixel luck.";

/** Background for the pressed button — the case stands on its own without the shell's CSS. */
function paintPressed(el: HTMLButtonElement, pressed: boolean): void {
  el.style.background = pressed ? "#3b82f6" : "";
  el.style.color = pressed ? "#fff" : "";
}

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.setAttribute("role", "group");
  toolbar.setAttribute("aria-label", "Drawing tools");
  toolbar.style.cssText = "display: flex; gap: 8px; margin-bottom: 8px; flex-wrap: wrap";
  container.append(toolbar);
  const host = chartHost(container, 480);

  const plot = PlotBuilder.create<OHLC>(browserDeps({ autoSize: true }))
    .setSize(container.clientWidth || 900, 480)
    .setAxis({
      x: { ticks: timeTicks({ timeZone: "UTC", locale: "en-US" }) },
      y: { position: "right", format: priceFormat({ compact: true, locale: "en-US" }) },
    })
    .build(host);

  plot.mainPane.addSeries({
    series: candleSeries(),
    data: fixtureCandles(),
    name: "Price",
  });
  plot.use(crosshair({ magnet: true }));

  const tools = plot.mainPane.use(drawingTools({ plot }));

  /**
   * The serialization round trip — an app only needs this upper layer
   * (`tools.serialize()`/`load()`). The low-level `serializeDrawings`/
   * `parseDrawings` (drawing array ↔ string) belong to apps with a storage
   * format of their own. If `load` can't read it, it returns false and keeps
   * the existing list — a stale save can't break the chart.
   */
  const STORAGE_KEY = "charts-case-drawings";
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) tools.load(saved);

  // A drag-move fires on every pointermove (reason "move"), so defer just that one.
  let saveTimer: number | undefined;
  tools.changes.subscribe(({ reason }) => {
    if (reason !== "move") {
      localStorage.setItem(STORAGE_KEY, tools.serialize());
      return;
    }
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(
      () => localStorage.setItem(STORAGE_KEY, tools.serialize()),
      200,
    );
  });

  const buttons = new Map<string, HTMLButtonElement>();
  for (const [label, kind] of [
    ["Horizontal line", "horizontal"],
    ["Trend line", "trend"],
    ["Fibonacci", "fib"],
  ] as const) {
    const el = document.createElement("button");
    el.textContent = label;
    el.addEventListener("click", () => {
      if (tools.mode() === kind) tools.cancel();
      else tools.begin(kind);
    });
    toolbar.appendChild(el);
    buttons.set(kind, el);
  }
  tools.modeChanges.subscribe(({ mode }) => {
    for (const [kind, el] of buttons) {
      const pressed = mode === kind;
      el.setAttribute("aria-pressed", String(pressed));
      paintPressed(el, pressed);
    }
    host.style.cursor = mode ? "crosshair" : "";
  });

  // A door to selection and deletion for environments without a keyboard
  // (touch) — the spot the drawing-tools senior review (2026-08-13) caught as
  // "there is no way to erase a line you drew on a phone." Delete is not a new
  // API; it goes through the same door the real key does (routeInput) — with
  // nothing selected it simply does nothing.
  const deselect = document.createElement("button");
  deselect.textContent = "Deselect";
  deselect.addEventListener("click", () => tools.select(null));

  const remove = document.createElement("button");
  remove.textContent = "Delete";
  remove.title = "Delete the selected drawing (same as the Delete key)";
  remove.addEventListener("click", () => {
    plot.routeInput({ type: "keydown", key: "Delete" });
  });

  const clearAll = document.createElement("button");
  clearAll.textContent = "Clear all";
  clearAll.addEventListener("click", () => tools.clear());

  // Snapping — drawing and anchor drags stick to a bar's values (close, low,
  // high) and the bar's x. It's off by default, so it takes a button to turn on
  // before you can see the real thing (round 16).
  const magnet = document.createElement("button");
  magnet.textContent = "Magnet";
  magnet.title = "Snap to a bar's values — catch peaks and troughs exactly";
  magnet.addEventListener("click", () => {
    tools.setSnap(!tools.snapping());
    magnet.setAttribute("aria-pressed", String(tools.snapping()));
    paintPressed(magnet, tools.snapping());
  });

  toolbar.append(deselect, remove, clearAll, magnet);

  return Object.assign(
    () => {
      clearTimeout(saveTimer); // so a deferred save can't call into dead tools
      plot.destroy(); // destroy tears down the plugins (tools included)
      toolbar.remove();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
