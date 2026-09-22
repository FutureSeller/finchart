import type { InputConsumer, SeriesSample } from "@finchart/core";
import { drawingTools, type DrawingPane, type DrawingStage } from "../tools";

export const space = {
  area: { left: 0, right: 100, top: 0, bottom: 100 },
  xAt: (x: number) => x, pixelAtX: (x: number) => x,
  valueAt: (y: number) => y, pixelAtValue: (price: number) => price,
};

export function mountDrawingStage() {
  let consumer: InputConsumer | undefined;
  let samples: SeriesSample[] = [];
  const plot: DrawingStage = {
    ...space, requestRender() {},
    addInputConsumer(next) { consumer = next; return () => { consumer = undefined; }; },
    claimCursor: () => () => {},
    claimFocusArea: () => ({ contestedAt: () => false, release() {} }),
    crosshair() {},
  };
  const pane: DrawingPane = { ...space, xRange: () => null, probe: () => samples, addDecoration: () => () => {} };
  const api = drawingTools({ plot })(pane);
  const route = (type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number) =>
    consumer?.handle({ type, point: { x, y }, pointerId: 1 });
  return { api, route, setSamples(next: SeriesSample[]) { samples = next; } };
}
