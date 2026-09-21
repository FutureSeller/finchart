import { describe, expect, it, vi } from 'vitest';
import type { OHLC } from '@finchart/core';
import { createPlotModel, candleSeries } from '@finchart/core';
import { bandSeries } from '../band-series';
import { bollingerBands, ichimoku, movingAverage, obv, vwap, macd, rsi } from '../factories';
import { heikinAshi, heikinAshiLast } from '../heikin-ashi';
import { attachMacd, attachRsi, attachBollingerBands } from '../plugins';
import { volumeProfile } from '../volume-profile';

const bar = (x: number, close: number, volume = 100): OHLC => ({
  x, open: close, high: close, low: close, close, volume,
});

describe('audit regressions', () => {
  it.each(['ema', 'macd', 'rsi'] as const)('%s lands nullable observations after a long gap exactly', kind => {
    let data: {
      x: number;
      y: number | null;
    }[] = [
      { x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 10 }, { x: 3, y: 20 },
      ...Array.from({ length: 200 }, (_, i) => ({ x: 4 + i, y: null })),
      { x: 204, y: 30 }, { x: 205, y: 20 },
    ];
    const make = (source: { read: () => typeof data }) =>
      kind === 'ema'
        ? movingAverage(source, { period: 3, type: 'ema', value: p => p.y })
        : kind === 'macd'
          ? macd(source, { fast: 2, slow: 3, signal: 2, value: p => p.y })
          : rsi(source, { period: 2, value: p => p.y });
    const node = make({ read: () => data });
    for (const out of Object.values(node.out)) {
      out.read();
    }
    data = [{ x: -4, y: 200 }, { x: -3, y: 100 }, { x: -2, y: 200 }, { x: -1, y: 100 }, ...data];
    const cold = make({ read: () => data });
    expect(Object.values(node.out).map(out => out.read())).toEqual(Object.values(cold.out).map(out => out.read()));
  });

  it('propagates upstream SMA corrections through a second SMA', () => {
    let data = Array.from({ length: 10 }, (_, i) => bar(i + 1, (i + 1) * 10));
    const inner = movingAverage({ read: () => data }, { period: 3 });
    const outer = movingAverage(inner.out.ma, { period: 3, value: p => p.y });
    outer.out.ma.read();
    data = [bar(0, 0), ...data];
    const cold = movingAverage(movingAverage({ read: () => data }, { period: 3 }).out.ma, { period: 3, value: p => p.y });
    expect(outer.out.ma.read()).toEqual(cold.out.ma.read());
    expect(outer.out.ma.read().find(p => p.x === 4)?.y).toBe(20);
  });

  it('recomputes both MACD recurrences even when fast exceeds slow', () => {
    let data = Array.from({ length: 1000 }, (_, i) => bar(i + 100, 10 + Math.sin(i)));
    const options = { fast: 100, slow: 3, signal: 2 };
    const node = macd({ read: () => data }, options);
    node.out.macd.read();
    data = [...Array.from({ length: 100 }, (_, i) => bar(i, 100)), ...data];
    const expected = macd({ read: () => data }, options).out.macd.read();
    node.out.macd.read().forEach((point, i) => {
      const want = expected[i].y;
      if (want === null) {
        expect(point.y).toBeNull();
      } else {
        expect(point.y).toBeCloseTo(want, 8);
      }
    });
  });

  it('does not retain a recursive tail after an arbitrarily large earlier seed', () => {
    let data = Array.from({ length: 100 }, (_, i) => bar(i, 10));
    const node = movingAverage({ read: () => data }, { period: 3, type: 'ema' });
    node.out.ma.read();
    data = [bar(-3, 1e100), bar(-2, 1e100), bar(-1, 1e100), ...data];
    const cold = movingAverage({ read: () => data }, { period: 3, type: 'ema' });
    expect(node.out.ma.read()).toEqual(cold.out.ma.read());
    expect(node.out.ma.read().at(-1)?.y).toBeGreaterThan(1e60);
  });

  it('recomputes a default EMA whose observations pause at the numeric boundary', () => {
    let data = [bar(0, 10), bar(1, 10), bar(2, 10),
      ...Array.from({ length: 100 }, (_, i) => bar(i + 3, Number.MAX_VALUE)), bar(103, 20)];
    const node = movingAverage({ read: () => data }, { period: 3, type: 'ema' });
    node.out.ma.read();
    data = [bar(-3, 100), bar(-2, 100), bar(-1, 100), ...data];
    const cold = movingAverage({ read: () => data }, { period: 3, type: 'ema' });
    expect(node.out.ma.read()).toEqual(cold.out.ma.read());
    expect(node.out.ma.read().at(-1)?.y).toBe(20.625);
  });

  it('claims both Ichimoku cloud bounds when span A falls below span B', () => {
    const data = Array.from({ length: 20 }, (_, i) => bar(i, 100 - i * 2));
    const cloud = ichimoku({ read: () => data }, { conversion: 2, base: 3, span: 5, displacement: 0 }).out.cloud.read();
    const values = cloud.flatMap(p => p.upper === null || p.lower === null ? [] : [p.upper, p.lower]);
    expect(bandSeries().valueExtent([...cloud])).toEqual({ min: Math.min(...values), max: Math.max(...values) });
  });

  it('rolls back an owned pane when its second series is rejected', () => {
    const model = createPlotModel({ size: { width: 400, height: 300 } });
    const original = model.plot.addPane.bind(model.plot);
    let disposed = vi.fn();
    vi.spyOn(model.plot, 'addPane').mockImplementation(options => {
      const pane = original(options);
      const add = pane.addSeries.bind(pane);
      let calls = 0;
      vi.spyOn(pane, 'addSeries').mockImplementation(options => {
        if (++calls === 2) {
          throw new Error('second series rejected');
        }
        const handle = add(options);
        disposed = vi.spyOn(handle, 'dispose');
        return handle;
      });
      return pane;
    });
    expect(() => model.plot.use(attachMacd({ source: { read: () => [] } }))).toThrow('second series rejected');
    expect(disposed).toHaveBeenCalledOnce();
    expect(model.plot.panes).toHaveLength(1);
    model.plot.destroy();
  });

  it('rolls back the owned pane when oscillator wiring rejects a level', () => {
    const model = createPlotModel({ size: { width: 400, height: 300 } });
    expect(() => model.plot.use(attachRsi({ source: { read: () => [] }, levels: { overbought: Infinity } }))).toThrow();
    expect(model.plot.panes).toHaveLength(1);
    model.plot.destroy();
  });

  it('rolls back earlier registrations while leaving a borrowed pane alive', () => {
    const model = createPlotModel({ size: { width: 400, height: 300 } });
    const pane = model.plot.mainPane;
    const add = pane.addSeries.bind(pane);
    let disposed = vi.fn();
    let calls = 0;
    vi.spyOn(pane, 'addSeries').mockImplementation(options => {
      if (++calls === 2) {
        throw new Error('borrowed rejection');
      }
      const handle = add(options);
      disposed = vi.spyOn(handle, 'dispose');
      return handle;
    });
    expect(() => pane.use(attachBollingerBands({ source: { read: () => [] } }))).toThrow('borrowed rejection');
    expect(disposed).toHaveBeenCalledOnce();
    expect(model.plot.panes).toEqual([pane]);
    model.plot.destroy();
  });

  it('turns overflowing Bollinger boundaries into gaps, including its band branch', () => {
    const node = bollingerBands({ read: () => [bar(0, 1), bar(1, 5)] }, { period: 2, multiplier: 1e308 });
    expect(node.out.upper.read()[1].y).toBeNull();
    expect(node.out.lower.read()[1].y).toBeNull();
    expect(node.out.band.read()[1]).toEqual({ x: 1, upper: null, lower: null });
  });

  it('does not commit overflowing OBV contributions', () => {
    const node = obv({ read: () => [bar(0, 1, 1e308), bar(1, 2, 1e308), bar(2, 1, 1e308)] });
    expect(node.out.obv.read().map(p => p.y)).toEqual([1e308, null, 0]);
  });

  it('keeps VWAP unknown after overflow until the next anchor', () => {
    const node = vwap({ read: () => [bar(0, 8e307), bar(1, 1), bar(2, 2)] }, { anchor: p => p.x === 2 });
    expect(node.out.vwap.read().map(p => p.y)).toEqual([null, null, 2]);
  });

  it('computes representable extreme HA means on the full and tail paths', () => {
    const data = [bar(0, 8e307), bar(1, 8e307)];
    const out = heikinAshi(data);
    expect(out).toEqual(data);
    expect(heikinAshiLast(out.slice(0, 1), data, { kind: 'append', count: 1 })).toEqual(out.slice(1));
    expect(heikinAshi([bar(0, Number.MIN_VALUE)])[0].close).toBe(Number.MIN_VALUE);
  });

  it('draws finite proportional profile rectangles when total volume overflows', () => {
    const data = [{ ...bar(0, 10, 1e308), high: 11, low: 9 }, { ...bar(1, 10, 1e308), high: 11, low: 9 }, { ...bar(2, 20, 1e308), high: 21, low: 19 }];
    const model = createPlotModel({ size: { width: 400, height: 300 }, series: { series: candleSeries(), data } });
    model.plot.setVisibleRange(0, 2);
    model.plot.mainPane.setValueDomain(0, 30);
    model.plot.mainPane.addDecoration(volumeProfile({ source: { read: () => data }, bins: 2, style: { fill: '#audit', poc: '#audit' } }));
    model.plot.render();
    const widths = model.commands().flatMap(c => c.type === 'drawShape' && c.shape.shape === 'rect' && c.shape.fill === '#audit' ? [c.shape.width] : []);
    expect(widths).toHaveLength(2);
    expect(widths.every(Number.isFinite)).toBe(true);
    expect(Math.max(...widths) / Math.min(...widths)).toBeCloseTo(2);
    model.plot.destroy();
  });
});
