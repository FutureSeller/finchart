/**
 * The drawing rail down the left — one set of buttons, acting on the
 * **focused chart**.
 *
 * Persisting drawings (the localStorage round trip) moved into the instance,
 * because a tool lives exactly as long as its chart. What is left here is the
 * buttons, plus a subscription that mirrors the focused chart's state (mode and
 * selection) into aria. Deleting is not a separate API — it **synthesizes a
 * Delete keypress**, so keyboard and mouse erase down the same path
 * (`routeInput`).
 */
import type { ChartInstance } from "./chart-instance";
import { ICONS } from "./icons";

export interface Rail {
  /** Re-points the subscriptions when focus moves. */
  retarget(chart: ChartInstance): void;
}

export function installRail(
  getFocused: () => ChartInstance,
  stageEl: HTMLElement,
): Rail {
  const railEl = document.getElementById("rail")!;

  function railButton(
    icon: keyof typeof ICONS,
    label: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const el = document.createElement("button");
    el.innerHTML = ICONS[icon];
    el.title = label;
    el.setAttribute("aria-label", label);
    el.addEventListener("click", onClick);
    railEl.appendChild(el);
    return el;
  }

  railButton("cursor", "Cursor (cancel drawing)", () => {
    const chart = getFocused();
    chart.tools.cancel();
    chart.keyboardHost.focus(); // same reason as above — hand back the focus this button took
  });

  const toolButtons = new Map<"horizontal" | "trend" | "fib", HTMLButtonElement>();
  for (const [kind, label] of [
    ["horizontal", "Horizontal line"],
    ["trend", "Trend line"],
    ["fib", "Fibonacci retracement"],
  ] as const) {
    toolButtons.set(
      kind,
      railButton(kind, label, () => {
        const chart = getFocused();
        if (chart.tools.mode() === kind) chart.tools.cancel();
        else chart.tools.begin(kind);
        /**
         * **Hand focus back to the chart.**
         *
         * This button just took it. The key listeners and `tabindex` hang on
         * the element `build()` received (`pointer.ts` in `@finchart/dom`), so
         * without handing focus back **Esc, Delete, `]` and `[` are all dead**
         * — and turning a tool on, changing your mind, and pressing Esc is the
         * most common way anyone cancels.
         *
         * The separate *"Cursor (cancel drawing)"* button on this rail was a
         * workaround for that symptom — Esc was out of reach, so a button was
         * sold in its place.
         */
        chart.keyboardHost.focus();
      }),
    );
  }

  const magnetButton = railButton("magnet", "Magnet (snap to a bar's values)", () => {
    const tools = getFocused().tools;
    tools.setSnap(!tools.snapping());
    magnetButton.setAttribute("aria-pressed", String(tools.snapping()));
  });
  magnetButton.setAttribute("aria-pressed", "false");

  const gap = document.createElement("div");
  gap.className = "rail-gap";
  railEl.appendChild(gap);

  const trashButton = railButton("trash", "Delete the selected drawing (Delete)", () => {
    getFocused().plot.routeInput({ type: "keydown", key: "Delete" });
  });

  // --- The focused chart's state, mirrored into aria — `retarget` re-points the subscriptions ---
  let release: (() => void) | null = null;

  function retarget(chart: ChartInstance): void {
    release?.();

    const syncButtons = () => {
      const mode = chart.tools.mode();
      for (const [kind, el] of toolButtons) {
        el.setAttribute("aria-pressed", String(mode === kind));
      }
      magnetButton.setAttribute("aria-pressed", String(chart.tools.snapping()));
      trashButton.disabled = chart.tools.selection() === null;
      stageEl.style.cursor = mode ? "crosshair" : "";
    };
    syncButtons();

    const offMode = chart.tools.modeChanges.subscribe(syncButtons);
    const offChanges = chart.tools.changes.subscribe(syncButtons);
    const offClick = chart.plot.on("click", syncButtons);
    release = () => {
      offMode();
      offChanges();
      offClick();
    };
  }

  return { retarget };
}
