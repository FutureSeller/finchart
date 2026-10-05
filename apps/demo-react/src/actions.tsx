/**
 * The header's right-hand actions — PNG, fit all, theme.
 *
 * All of them are the imperative lane: they happen the moment the user presses,
 * which is what `plotRef` is for (by then the chart has settled — see the
 * wrapper's README).
 */
import type { Plot } from "@finchart/core";

export function Actions({
  plot,
  light,
  onLight,
}: {
  /** The focused chart — PNG and fit all act on this one. */
  plot: Plot | null;
  light: boolean;
  onLight: () => void;
}) {
  const png = () => {
    if (!plot) return;

    const link = document.createElement("a");
    link.download = "chart.png";
    link.href = plot.takeScreenshot();
    link.click();
  };

  return (
    <div id="actions">
      <button type="button" onClick={png}>
        PNG
      </button>
      <button type="button" onClick={() => plot?.fitDomains()}>
        Fit all
      </button>
      <button type="button" onClick={onLight}>
        {light ? "Dark" : "Light"}
      </button>
    </div>
  );
}
