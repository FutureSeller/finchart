import { createPlotModel, lineSeries } from '@finchart/core';
import type { InputConsumer, SeriesSample } from '@finchart/core';
import { describe, expect, it } from 'vitest';
import { distanceToSegment } from '../geometry';
import { gripAt, infiniteEndpoints, moveGrip } from '../hit';
import { channelParallel, fibExtensionPrice, fibLevelPrice, parseDrawings, pitchforkLines, serializeDrawings, toOwnedDrawing } from '../drawings';
import type { Drawing } from '../drawings';
import { drawingTools } from '../tools';
import type { DrawingPane, DrawingStage } from '../tools';

const space = {
  area: { left: 0, right: 100, top: 0, bottom: 100 },
  xAt: (x: number) => x, pixelAtX: (x: number) => x,
  valueAt: (y: number) => y, pixelAtValue: (price: number) => price,
};

function mounted() {
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

describe('algorithm audit regressions', () => {
  it('clips rays and extended lines whose defining anchors are far off screen', () => {
    for (const type of ['ray', 'extended'] as const) {
      const drawing = { type, id: type, a: { x: -1000, price: 50 }, b: { x: -900, price: 50 } };
      expect(infiniteEndpoints(type, { x: -1000, y: 50 }, { x: -900, y: 50 }, space)).toEqual([{ x: 0, y: 50 }, { x: 100, y: 50 }]);
      expect(gripAt([drawing], space, { x: 50, y: 50 })?.part).toBe('whole');
      expect(infiniteEndpoints(type, { x: 1e308, y: 1e308 }, { x: 0, y: 0 }, space)).toEqual([{ x: 100, y: 100 }, { x: 0, y: 0 }]);
      // Reversing a ray points away; extending the full line still crosses.
      expect(gripAt([{ ...drawing, a: drawing.b, b: drawing.a }], space, { x: 50, y: 50 })?.part).toBe(type === 'ray' ? undefined : 'whole');
    }
  });

  it('keeps finite linear geometry when intermediate sums or differences overflow', () => {
    const a = { x: 0, price: 1e308 }, b = { x: 1, price: -1e308 };
    const fib = { type: 'fib' as const, id: 'f', a, b };
    expect(fibLevelPrice(fib, 0)).toBe(b.price);
    expect(fibLevelPrice(fib, 1)).toBe(a.price);
    expect(fibLevelPrice(fib, 0.5)).toBe(0);
    const origin = { x: 0, price: 1e16 };
    expect(fibExtensionPrice({ a: origin, b: { x: 1, price: 1 }, c: origin }, 1)).toBe(1);
    expect(channelParallel({ a, b, c: { x: 0, price: 0 } })[0].price).toBe(0);
    const fork = pitchforkLines({ a: { x: 0, price: 1e308 }, b: { x: 1, price: 1e308 }, c: { x: 3, price: 1e308 } });
    expect(fork.every((pair) => pair.every((anchor) => anchor.price === 1e308))).toBe(true);
    expect(distanceToSegment({ x: 0, y: 0 }, { x: -1e200, y: 0 }, { x: 1e200, y: 0 })).toBe(0);
    expect(distanceToSegment({ x: 1e16 + 2, y: 3 }, { x: 1e16, y: 0 }, { x: 1e16 + 4, y: 0 })).toBe(3);
  });

  it('keeps repaired IDs valid and avoids collisions with existing shortened IDs', () => {
    const id = 'a'.repeat(128);
    const drawings = [id, id, `${'a'.repeat(126)}#2`, id].map((id, price) => ({ type: 'horizontal', price, id }));
    const parsed = parseDrawings(JSON.stringify({ version: 2, drawings }));
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(new Set(parsed.map((drawing) => drawing.id)).size).toBe(4);
    expect(parsed.every((drawing) => drawing.id.length <= 128)).toBe(true);
    expect(parseDrawings(serializeDrawings(parsed))).toEqual(parsed);
    expect(parseDrawings(JSON.stringify({ version: 2, drawings }))).toEqual(parsed);
  });

  it('does not complete a stationary click merely because the first anchor snapped', () => {
    const { api, route, setSamples } = mounted();
    api.setSnap(true);
    setSamples([{ series: lineSeries(), name: null, color: null, x: 50, value: 56, min: null, max: null, index: 0 }]);
    api.begin('trend');
    route('pointerdown', 50, 50); route('pointerup', 50, 50);
    expect(api.list()).toEqual([]);
    expect(api.mode()).toBe('trend');
    route('pointerdown', 80, 80); route('pointerup', 80, 80);
    expect(api.list()).toHaveLength(1);
    api.dispose();
  });

  it('rejects a complete additive drag candidate before writing any anchor', () => {
    const drawing: Drawing = { type: 'trend', id: 't', a: { x: 1, price: 1e308 }, b: { x: 2, price: 10 } };
    const original = toOwnedDrawing(drawing);
    moveGrip({ grip: { drawing, part: 'whole' }, offsets: [{ x: 1, price: 1e308 }, { x: 2, price: 10 }], original }, { x: 50, price: 1e308 });
    expect(drawing).toEqual(original);
  });

  it('keeps saving and history valid after an out-of-range finite pixel drag', () => {
    const model = createPlotModel({ size: { width: 800, height: 600 }, series: { series: lineSeries(), data: [{ x: 0, y: 1e307 }, { x: 10, y: 2e307 }] } });
    const api = model.plot.mainPane.use(drawingTools({ plot: model.plot }));
    const handle = api.add({ type: 'horizontal', price: 1.5e307 });
    const before = handle.read();
    model.plot.routeInput({ type: 'pointerdown', point: { x: 400, y: model.plot.mainPane.pixelAtValue(1.5e307) }, pointerId: 1 });
    model.plot.routeInput({ type: 'pointermove', point: { x: 400, y: -10000 }, pointerId: 1 });
    model.plot.routeInput({ type: 'pointerup', point: { x: 400, y: -10000 }, pointerId: 1 });
    expect(handle.read()).toEqual(before);
    expect(parseDrawings(api.serialize())).toEqual([before]);
    api.undo(); // Only the add was committed.
    expect(api.list()).toEqual([]);
    model.plot.destroy();
  });

  it('does not add after an input getter disposes the toolbox', () => {
    const { api } = mounted();
    expect(() => api.add({ type: 'horizontal', get price() { api.dispose(); return 50; } })).toThrow(/disposed/);
    expect(api.list()).toEqual([]);
  });

  it('does not write or record history for a target removed by a patch getter', () => {
    const { api } = mounted();
    const handle = api.add({ type: 'horizontal', price: 50 });
    expect(() => handle.update({ get price() { api.clear(); return 60; } })).toThrow(/changed while reading/);
    expect(handle.read()).toMatchObject({ price: 50 });
    expect(api.list()).toEqual([]);
    expect(api.canUndo()).toBe(false);
    api.dispose();
  });

  it('rolls back focus and decoration acquisitions if input installation fails', () => {
    let focus = 0, decorations = 0;
    const plot: DrawingStage = {
      ...space, requestRender() {}, crosshair() {}, claimCursor: () => () => {},
      claimFocusArea() { focus++; return { contestedAt: () => false, release() { focus--; } }; },
      addInputConsumer() { throw new Error('registration failed'); },
    };
    const pane: DrawingPane = { ...space, xRange: () => null, probe: () => [], addDecoration() { decorations++; return () => { decorations--; }; } };
    expect(() => drawingTools({ plot })(pane)).toThrow('registration failed');
    expect({ focus, decorations }).toEqual({ focus: 0, decorations: 0 });
  });
});
