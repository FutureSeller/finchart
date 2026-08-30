/**
 * An orderbook depth heatmap — a case that walks through two extension doors
 * at once.
 *
 * 1. A custom series (the 2-method contract): it draws an orderbook snapshot —
 *    a point type the core knows nothing about — with valueExtent and draw.
 *    The coordinates are what `coordinates` speaks for.
 * 2. A custom command: pushing thousands of cells out as drawShape blows up
 *    the command list. Instead the frame's whole cell grid rides in a single
 *    command, and a painter that knows that name plays it back. A surface that
 *    doesn't know it (headless, server) gets only the fallback — the top few
 *    liquidity walls.
 *
 * It uses nothing but fillRect, so it stays inside the Canvas2DContext
 * structural contract — zero lines of change on the core side.
 */
import type {
  CoordinateAccessor,
  CustomPainter,
  FallbackCommand,
  Renderer,
  RendererFactory,
  Series,
} from "@finchart/core";
import {
  createCanvasRenderer,
  drawCustom,
  lineSeries,
  priceFormat,
} from "@finchart/core";
import { PlotBuilder, browserDeps } from "@finchart/dom";
import { chartHost } from "./stage";

export const title = "Orderbook heatmap — a custom command";
export const description =
  "It paints resting liquidity onto a price×time grid. Thousands of cells ride in one custom command, and a renderer that knows the name plays it back with fillRect — a surface that doesn't know the name draws only the fallback (the top 8 liquidity walls). A custom series plus a custom command, zero lines of change in the core.";

/** Namespace the name — there is no global registry, so the name is the only thing preventing a collision. */
const DEPTH_HEATMAP = "examples/depth-heatmap";

// ---- Data: a synthetic orderbook ----

/** The price ladder — every snapshot uses the same one. The price of level i = min + i*step. */
interface Ladder {
  min: number;
  step: number;
  levels: number;
}

/** One snapshot — an x, and the resting size at each ladder level. It's a point type with no `y`, which is why it needs coordinates. */
interface DepthPoint {
  x: number;
  mid: number;
  sizes: Float64Array;
}

const priceOf = (ladder: Ladder, level: number) =>
  ladder.min + level * ladder.step;

/**
 * A walking mid plus liquidity walls that live and move. It imitates only two
 * properties of a real orderbook: a wall survives a few ticks (inertia), and
 * the space right beside the mid is empty (the spread).
 */
function syntheticBook(count: number): { ladder: Ladder; data: DepthPoint[] } {
  const ladder: Ladder = { min: 88, step: 0.25, levels: 96 };
  const top = priceOf(ladder, ladder.levels - 1);

  let mid = (ladder.min + top) / 2;
  /** Resting size per level — it carries across frames, which is how a wall "lives". */
  const book = new Float64Array(ladder.levels);
  const data: DepthPoint[] = [];

  let seed = 20260814;
  const random = () => {
    // The example data has to be the same on every reload for you to compare it by eye.
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  for (let t = 0; t < count; t++) {
    mid = Math.min(top - 2, Math.max(ladder.min + 2, mid + (random() - 0.5) * 0.6));

    for (let level = 0; level < ladder.levels; level++) {
      const distance = Math.abs(priceOf(ladder, level) - mid);
      // The further from the mid, the thinner the liquidity — walls and the
      // baseline both ride this decay.
      const proximity = Math.exp(-distance / 5);
      // A wall shrinks gradually, and the closer to the mid the more readily a new one stands up.
      book[level] *= 0.92;
      if (random() < 0.05 * proximity) book[level] += 60 + random() * 160;
      // Baseline liquidity.
      book[level] += 14 * proximity * random();
      // The spread — right beside the mid is empty.
      if (distance < ladder.step * 1.5) book[level] = 0;
    }

    data.push({ x: t, mid, sizes: Float64Array.from(book) });
  }

  return { ladder, data };
}

// ---- The command: the frame's whole grid rides in one ----

/** The contract between the painter and the series — the core is not a party to it (`params: unknown`). */
interface DepthHeatmapParams {
  /** The left x pixel of each column (snapshot). The width comes out of the neighbor spacing. */
  columnsLeft: Float64Array;
  columnWidth: number;
  /** The top y pixel of level 0 and the cell height — the ladder is evenly spaced, so these two are enough. */
  rowTop: number;
  rowHeight: number;
  /** column-major: cells[column * levels + level]. */
  cells: Float64Array;
  levels: number;
  /** The normalization basis for alpha. */
  max: number;
  /** The mid's y pixel per column — it divides the bid color from the ask color. */
  midY: Float64Array;
}

/**
 * A lookup of color strings with alpha quantized into 24 steps — building a
 * string per cell would be tens of thousands of allocations a frame.
 */
const ALPHA_STEPS = 24;
const buildRamp = (r: number, g: number, b: number) =>
  Array.from({ length: ALPHA_STEPS + 1 }, (_, i) => {
    const alpha = Math.min(0.85, (i / ALPHA_STEPS) ** 0.6);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
  });
const ASK_RAMP = buildRamp(244, 63, 94); // above the mid = an ask wall (rose)
const BID_RAMP = buildRamp(16, 185, 129); // below the mid = a bid wall (emerald)

/** How to draw this name — nothing but fillRect, so it stays inside the structural contract (`Canvas2DContext`). */
const paintDepthHeatmap: CustomPainter = (context, rawParams) => {
  const params = rawParams as DepthHeatmapParams;
  const { columnsLeft, columnWidth, rowTop, rowHeight, cells, levels, max, midY } =
    params;

  for (let column = 0; column < columnsLeft.length; column++) {
    const left = columnsLeft[column];
    for (let level = 0; level < levels; level++) {
      const size = cells[column * levels + level];
      if (size <= 0) continue;

      const step = Math.min(ALPHA_STEPS, Math.round((size / max) * ALPHA_STEPS));
      if (step === 0) continue;
      const y = rowTop + level * rowHeight;
      // draw() loads the ladder flipped, so that level 0 sits at the bottom rather than the top.
      context.fillStyle = y < midY[column] ? ASK_RAMP[step] : BID_RAMP[step];
      context.fillRect(left, y, columnWidth, rowHeight + 0.5);
    }
  }
};

/** The renderer that knows this painter. It goes straight into `browserDeps({ createRenderer })`. */
export const heatmapRenderer: RendererFactory = (surface): Renderer =>
  createCanvasRenderer(surface, {
    painters: { [DEPTH_HEATMAP]: paintDepthHeatmap },
  });

// ---- The series: the 2-method contract ----

const depthCoordinates: CoordinateAccessor<DepthPoint> = {
  getX: (point) => point.x,
  getY: (point) => point.mid,
};

/**
 * What a surface that doesn't know the name draws instead — a summary of the
 * few thickest liquidity walls. Turning the whole thing into an array and
 * sorting it would make tens of thousands of objects a frame, so a single pass
 * keeps the top K by insertion (O(n·K), zero allocations).
 */
function wallFallback(
  params: DepthHeatmapParams,
  topCount: number,
): FallbackCommand[] {
  const topIndex = new Int32Array(topCount).fill(-1);
  const topSize = new Float64Array(topCount);

  const total = params.columnsLeft.length * params.levels;
  for (let cell = 0; cell < total; cell++) {
    const size = params.cells[cell];
    if (size <= topSize[topCount - 1]) continue;

    let slot = topCount - 1;
    while (slot > 0 && topSize[slot - 1] < size) {
      topSize[slot] = topSize[slot - 1];
      topIndex[slot] = topIndex[slot - 1];
      slot--;
    }
    topSize[slot] = size;
    topIndex[slot] = cell;
  }

  const walls: FallbackCommand[] = [];
  for (let rank = 0; rank < topCount; rank++) {
    if (topIndex[rank] < 0) break;
    const column = Math.floor(topIndex[rank] / params.levels);
    const level = topIndex[rank] % params.levels;
    walls.push({
      type: "drawShape",
      shape: {
        shape: "rect",
        x: params.columnsLeft[column],
        y: params.rowTop + level * params.rowHeight,
        width: params.columnWidth,
        height: params.rowHeight,
        fill: `rgba(100, 116, 139, ${Math.min(0.8, topSize[rank] / params.max).toFixed(3)})`,
      },
    });
  }
  return walls;
}

function depthHeatmap(ladder: Ladder): Series<DepthPoint> {
  const top = priceOf(ladder, ladder.levels - 1);

  // Don't take ~200KB fresh every frame — grow only when the number of visible
  // columns grows. The command carries the buffers by reference, which is safe
  // for a surface that plays back within the same frame (a canvas), but a
  // consumer that means to hold params across several frames has to copy it
  // itself.
  let columnsLeft = new Float64Array(0);
  let midY = new Float64Array(0);
  let cells = new Float64Array(0);

  return {
    coordinates: depthCoordinates,
    valueExtent() {
      // The heatmap occupies the whole ladder — count only the mid and the walls get clipped off-screen.
      return { min: ladder.min, max: top + ladder.step };
    },
    draw(target, { data, x, yScale }) {
      if (data.length === 0) return;

      if (columnsLeft.length < data.length) {
        columnsLeft = new Float64Array(data.length);
        midY = new Float64Array(data.length);
        cells = new Float64Array(data.length * ladder.levels);
      }

      // The column width is the neighbor spacing — when decimation widens it, the cells thicken with it.
      const first = x.toPixel(data[0].x);
      const second =
        data.length > 1 ? x.toPixel(data[1].x) : first + 8;
      const columnWidth = Math.max(1, Math.abs(second - first));

      // Screen y grows downward, so the cell rows flip to "the highest price is row 0".
      const rowTop = yScale.scale(top + ladder.step);
      const rowHeight =
        Math.abs(yScale.scale(ladder.min) - rowTop) / ladder.levels;

      for (let column = 0; column < data.length; column++) {
        const point = data[column];
        columnsLeft[column] = x.toPixel(point.x) - columnWidth / 2;
        midY[column] = yScale.scale(point.mid);
        for (let level = 0; level < ladder.levels; level++) {
          // Flip level (ascending price) → row (top to bottom).
          const row = ladder.levels - 1 - level;
          cells[column * ladder.levels + row] = point.sizes[level];
        }
      }

      // When a zoom-out shrinks the column count, the previous frame lingers in
      // the tail of the buffer — so load exactly the right length as a view
      // (a subarray is a window, not a copy).
      const params: DepthHeatmapParams = {
        columnsLeft: columnsLeft.subarray(0, data.length),
        columnWidth,
        rowTop,
        rowHeight,
        cells: cells.subarray(0, data.length * ladder.levels),
        levels: ladder.levels,
        max: 220,
        midY: midY.subarray(0, data.length),
      };

      drawCustom(target, {
        name: DEPTH_HEATMAP,
        params,
        fallback: wallFallback(params, 8),
      });
    },
  };
}

// ---- The case ----

export function mount(container: HTMLElement): () => void {
  const { ladder, data } = syntheticBook(240);

  const host = chartHost(container, 420);
  const plot = PlotBuilder.create<DepthPoint>(
    browserDeps({ autoSize: true, createRenderer: heatmapRenderer }),
  )
    .setSize(container.clientWidth || 900, 420)
    .setShowGrid(false)
    .setAxis({ y: { position: "right", format: priceFormat({ locale: "en-US" }) } })
    .build(host);

  // The heatmap first — registration order is draw order, so the mid line lands on top.
  plot.mainPane.addSeries({
    series: depthHeatmap(ladder),
    data,
    name: "Liquidity",
  });
  plot.mainPane.addSeries({
    series: lineSeries({ line: { color: "#f8fafc", width: 1.5 } }),
    data: data.map((point) => ({ x: point.x, y: point.mid })),
    name: "mid",
  });

  return Object.assign(
    () => {
      plot.destroy();
      host.remove();
    },
    { requestRender: () => plot.requestRender() },
  );
}
