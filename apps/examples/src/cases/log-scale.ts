import { PlotBuilder, browserDeps } from "@finchart/dom";
import type { Plot } from "@finchart/core";
import {
  crosshair,
  LinearScale,
  lineSeries,
  LogScale,
  priceFormat,
} from "@finchart/core";
import { chartHost } from "./stage";

export const title = "Log price scale — decade ticks and the local ruler";
export const description =
  "The same exponential series twice, on a log axis. Ticks come from the scale's own geometry (decades × 1·2·5), so the bottom of the axis is populated instead of everything crowding the top. " +
  "The top chart leaves axis.y.format unset — its badges fall back to two decimals. The bottom one uses priceFormat(), which reads the log axis's local step, so the crosshair shows 0.87 near the floor and 1,800 near the top. " +
  "Toggle to linear to compare — this pair of charts is also the standing judgment fixture for whether the unset-format split needs unifying.";

/**
 * Three decades of deterministic growth, ~0.5 → ~2000 — the domain the
 * log-ticks review measured. Deterministic (no Math.random) so the case
 * screenshots the same every time.
 */
function growth(): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  const count = 300;
  const totalLog = Math.log(2000 / 0.5);
  for (let i = 0; i < count; i++) {
    const trend = 0.5 * Math.exp((i / (count - 1)) * totalLog);
    const wobble = 1 + 0.15 * Math.sin(i / 7) + 0.08 * Math.sin(i / 23);
    points.push({ x: i, y: trend * wobble });
  }
  return points;
}

function caption(container: HTMLElement, text: string): void {
  const p = document.createElement("p");
  p.textContent = text;
  p.style.cssText = "margin: 12px 0 4px; font-size: 13px; opacity: 0.75";
  container.append(p);
}

export function mount(container: HTMLElement): () => void {
  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display: flex; gap: 8px; margin-bottom: 4px";
  container.append(toolbar);

  const toggle = document.createElement("button");
  toolbar.append(toggle);

  const build = (host: HTMLElement, format?: ReturnType<typeof priceFormat>) => {
    let builder = PlotBuilder.create<{ x: number; y: number }>(
      browserDeps({ autoSize: true }),
    ).setSize(container.clientWidth || 900, 280);
    builder = builder.setAxis({
      y: format ? { position: "right", format } : { position: "right" },
    });
    const plot = builder.build(host);
    plot.mainPane.addSeries({
      series: lineSeries(),
      data: growth(),
      name: "Growth",
    });
    plot.use(crosshair({ magnet: true }));
    return plot;
  };

  caption(container, "axis.y.format unset — ticks print values as-is, badges fall back to two decimals");
  const bare = build(chartHost(container, 280));

  caption(container, "axis.y.format: priceFormat() — the log recipe; badges read the local decade step");
  const formatted = build(
    chartHost(container, 280),
    priceFormat({ locale: "en-US" }),
  );

  const plots: Plot[] = [bare, formatted];
  let log = false;
  const setScales = (next: boolean): void => {
    log = next;
    for (const plot of plots) {
      plot.mainPane.setYScale(log ? new LogScale() : new LinearScale());
    }
    toggle.textContent = log ? "Scale: log (switch to linear)" : "Scale: linear (switch to log)";
  };
  toggle.addEventListener("click", () => setScales(!log));
  setScales(true);

  return () => {
    for (const plot of plots) plot.destroy();
    container.replaceChildren();
  };
}
