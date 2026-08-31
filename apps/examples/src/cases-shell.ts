/**
 * The case gallery shell — a list, hash routing, a dark toggle, and remounting.
 * That's all of it.
 *
 * A case is a `CaseModule` in `cases/*.ts` (title, description, mount →
 * dispose). Switching themes remounts the case — the cheapest way to put every
 * case through both themes without widening the contract. Theme switching that
 * keeps state is what trading.html proves out.
 *
 * `cases.html#<id>` opens a single case directly.
 */
import "./theme.css";
import type { CaseModule } from "./cases/case";
import * as areaFade from "./cases/area-fade";
import * as barIndex from "./cases/bar-index";
import * as candlesVolume from "./cases/candles-volume";
import * as channels from "./cases/channels";
import * as chartTypes from "./cases/chart-types";
import * as customSeries from "./cases/custom-series";
import * as drawing from "./cases/drawing";
import * as heikinAshi from "./cases/heikin-ashi";
import * as ichimoku from "./cases/ichimoku";
import * as infiniteHistoryCase from "./cases/infinite-history";
import * as oscillators from "./cases/oscillators";
import * as orderbookHeatmap from "./cases/orderbook-heatmap";
import * as overlays from "./cases/overlays";
import * as ownPanes from "./cases/own-panes";
import * as pivots from "./cases/pivots";
import * as realtime from "./cases/realtime";
import * as renkoCase from "./cases/renko";
import * as volumeProfileCase from "./cases/volume-profile";
import * as syncXCase from "./cases/sync-x";
import * as workerRender from "./cases/worker-render";

const CASES: readonly (readonly [string, CaseModule])[] = [
  ["candles-volume", candlesVolume],
  ["chart-types", chartTypes],
  ["area-fade", areaFade],
  ["heikin-ashi", heikinAshi],
  ["renko", renkoCase],
  ["overlays", overlays],
  ["ichimoku", ichimoku],
  ["oscillators", oscillators],
  ["channels", channels],
  ["pivots", pivots],
  ["volume-profile", volumeProfileCase],
  ["own-panes", ownPanes],
  ["realtime", realtime],
  ["infinite-history", infiniteHistoryCase],
  ["drawing", drawing],
  ["bar-index", barIndex],
  ["sync-x", syncXCase],
  ["custom-series", customSeries],
  ["orderbook-heatmap", orderbookHeatmap],
  ["worker-render", workerRender],
];

const list = document.getElementById("list")!;
const heading = document.getElementById("case-title")!;
const blurb = document.getElementById("case-description")!;
const stage = document.getElementById("stage")!;

let dispose: (() => void) | null = null;

function currentId(): string {
  const id = location.hash.slice(1);
  return CASES.some(([caseId]) => caseId === id) ? id : CASES[0][0];
}

function show(): void {
  const id = currentId();
  const [, module] = CASES.find(([caseId]) => caseId === id)!;

  dispose?.();
  stage.innerHTML = ""; // last safety net for DOM a dispose missed

  heading.textContent = module.title;
  blurb.textContent = module.description;
  for (const link of list.querySelectorAll("a")) {
    link.classList.toggle("active", link.hash === `#${id}`);
  }

  dispose = module.mount(stage);
}

for (const [id, module] of CASES) {
  const link = document.createElement("a");
  link.href = `#${id}`;
  link.textContent = module.title;
  list.appendChild(link);
}

document.getElementById("theme")!.addEventListener("click", (event) => {
  const dark = document.body.classList.toggle("dark");
  (event.currentTarget as HTMLElement).setAttribute("aria-pressed", String(dark));
  show(); // remount — every case goes through both themes
});

window.addEventListener("hashchange", show);
show();
