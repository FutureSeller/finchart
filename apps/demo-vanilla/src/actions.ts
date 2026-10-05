/** The header's right-hand actions — PNG, fit all, theme. They act on the focused chart. */
import type { ChartInstance } from "./chart-instance";

export function installActions(
  getFocused: () => ChartInstance,
  /** The theme is every chart's business — this takes the charts to redraw. */
  repaintAll: () => void,
): void {
  const actionsEl = document.getElementById("actions")!;

  function actionButton(
    label: string,
    onClick: (self: HTMLButtonElement) => void,
  ): void {
    const el = document.createElement("button");
    el.textContent = label;
    el.addEventListener("click", () => onClick(el));
    actionsEl.appendChild(el);
  }

  actionButton("PNG", () => {
    const chart = getFocused();
    const link = document.createElement("a");
    link.download = `${chart.spec.symbol.replace("/", "-")}.png`;
    link.href = chart.plot.takeScreenshot();
    link.click();
  });

  actionButton("Fit all", () => getFocused().plot.fitDomains());

  actionButton("Light", (self) => {
    const light = document.body.classList.toggle("light");
    self.textContent = light ? "Dark" : "Light";
    repaintAll(); // colors are CSS variables — redrawing is the whole change
  });
}
