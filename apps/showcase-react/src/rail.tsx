/**
 * The drawing rail down the left — where the tools' two halves meet.
 *
 * Installation and the localStorage round trip belong to `<DrawingToolsHost>`
 * (inside the container, the declarative lane), while the buttons' aria and
 * active state come from React state the App pushed up through subscriptions.
 * As in vanilla, deleting is not a separate API — it **synthesizes a Delete
 * keypress**, so keyboard and mouse erase down the same path (`routeInput`).
 */
import type { Plot } from "@finchart/core";
import { usePlugin } from "@finchart/react";
import { drawingTools, type DrawingToolsApi } from "@finchart/tools";
import { useEffect, useState } from "react";
import { ICONS } from "./icons";

export type ToolMode = ReturnType<DrawingToolsApi["mode"]>;

/**
 * Installs the tools on the chart and pushes the api up — it goes inside the
 * container. It wraps no pane, so it attaches to mainPane, the same as vanilla.
 */
export function DrawingToolsHost({
  symbol,
  onReady,
}: {
  /** Drawings belong to the symbol — the storage key is keyed on it. */
  symbol: string;
  onReady: (tools: DrawingToolsApi | null) => void;
}) {
  const tools = usePlugin((plot, pane) => pane.use(drawingTools({ plot })), []);
  const storageKey = `charts-showcase-drawings:${symbol}`;

  // Drawings belong to the symbol — a localStorage round trip (vanilla's rail.ts pattern).
  useEffect(() => {
    if (!tools) return;

    const saved = localStorage.getItem(storageKey);
    if (saved) tools.load(saved);

    const save = () => localStorage.setItem(storageKey, tools.serialize());
    // A move (reason: "move") arrives every frame, so only the save is debounced by 200ms.
    let timer: number | undefined;
    const off = tools.changes.subscribe(({ reason }) => {
      if (reason !== "move") {
        save();
        return;
      }
      clearTimeout(timer);
      timer = window.setTimeout(save, 200);
    });
    window.addEventListener("beforeunload", save);

    return () => {
      off();
      clearTimeout(timer);
      window.removeEventListener("beforeunload", save);
      save(); // unmounting is part of the round trip — a StrictMode remount reads this back
    };
  }, [tools, storageKey]);

  useEffect(() => {
    onReady(tools);
    return () => onReady(null);
  }, [tools, onReady]);

  return null;
}

const TOOL_KINDS = [
  ["horizontal", "Horizontal line"],
  ["trend", "Trend line"],
  ["fib", "Fibonacci retracement"],
] as const;

function RailButton({
  icon,
  label,
  pressed,
  disabled,
  onClick,
}: {
  icon: keyof typeof ICONS;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      // The SVG literals are assets, not code — our own files, which we trust.
      dangerouslySetInnerHTML={{ __html: ICONS[icon] }}
    />
  );
}

export function Rail({
  tools,
  plot,
  mode,
  hasSelection,
}: {
  tools: DrawingToolsApi | null;
  /** The focused chart — the synthesized Delete goes here. */
  plot: Plot | null;
  mode: ToolMode;
  hasSelection: boolean;
}) {
  // The magnet is the tools' state — read it back after toggling and mirror it into aria.
  const [snapping, setSnapping] = useState(false);
  useEffect(() => {
    setSnapping(tools?.snapping() ?? false);
  }, [tools]);

  return (
    <aside id="rail" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      <RailButton
        icon="cursor"
        label="Cursor (cancel drawing)"
        onClick={() => tools?.cancel()}
      />
      {TOOL_KINDS.map(([kind, label]) => (
        <RailButton
          key={kind}
          icon={kind}
          label={label}
          pressed={mode === kind}
          onClick={() => {
            if (!tools) return;
            if (tools.mode() === kind) tools.cancel();
            else tools.begin(kind);
          }}
        />
      ))}
      <RailButton
        icon="magnet"
        label="Magnet (snap to a bar's values)"
        pressed={snapping}
        onClick={() => {
          if (!tools) return;
          tools.setSnap(!tools.snapping());
          setSnapping(tools.snapping());
        }}
      />
      <div className="rail-gap" />
      <RailButton
        icon="trash"
        label="Delete the selected drawing (Delete)"
        disabled={!hasSelection}
        onClick={() => plot?.routeInput({ type: "keydown", key: "Delete" })}
      />
    </aside>
  );
}
