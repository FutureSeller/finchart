/**
 * Measures what the series/decoration components do on your behalf.
 *
 * These are thin layers that build a core object and hand it to
 * `<ChartSeries>`. So there are two things to check — **does what you gave
 * it actually get drawn**, and does adding one more layer still **preserve
 * JSX order and the derive cache**.
 */
import type { DataView, DrawCommand, LineDataPoint, OHLC, Plot } from '@finchart/core';
import { OHLCAccessor } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChartCandles,
  ChartContainer,
  ChartLine,
  ChartPane,
  Crosshair,
} from '../components';
import { layersSpy } from './fake-layers';
import { rendererSpy } from './recording-renderer';

afterEach(cleanup);

const candles: OHLC[] = [
  { x: 0, open: 10, high: 14, low: 9, close: 12 },
  { x: 1, open: 12, high: 16, low: 11, close: 15 },
  { x: 2, open: 15, high: 17, low: 12, close: 13 },
];

function setup() {
  const layers = layersSpy();
  const renderer = rendererSpy();
  const deps = browserDeps({
    createLayers: layers.createLayers,
    createRenderer: renderer.createRenderer,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
  });
  const ref = createRef<Plot>();

  const plot = () => {
    if (!ref.current) throw new Error('plot is not mounted');
    return ref.current;
  };

  /** Draws once from the current state and returns the resulting commands. */
  const drawn = (): readonly DrawCommand[] => {
    act(() => plot().render());
    return renderer.committed;
  };

  return { deps, ref, plot, drawn };
}

const mount = (ui: ReactElement) => render(ui);

const lines = (commands: readonly DrawCommand[]) =>
  commands.filter((command) => command.type === 'drawLine');

/**
 * Why `flatMap` instead of `filter`: with two conditions, TS can't infer a
 * type predicate, so the result stays `DrawCommand[]` (`lines` gets away
 * with `filter` because it only has one comparison). Inside the ternary,
 * control flow narrowing gives us a narrow type with no assertion needed.
 */
const rects = (commands: readonly DrawCommand[]) =>
  commands.flatMap((command) =>
    command.type === 'drawShape' && command.shape.shape === 'rect'
      ? [command]
      : [],
  );

const MA_COLOR = '#7c3aed';

const closes = (source: DataView<OHLC>): LineDataPoint[] =>
  source.map((candle) => ({ x: candle.x, y: candle.close }));

describe('<ChartCandles>', () => {
  it('should draw a body per candle', () => {
    const { deps, ref, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartCandles />
      </ChartContainer>,
    );

    expect(rects(drawn())).toHaveLength(candles.length);
  });

  it('should take the colors it is given', () => {
    const { deps, ref, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartCandles style={{ up: "#00ff00", down: "#ff0000" }} />
      </ChartContainer>,
    );

    const fills = rects(drawn()).map((command) => command.shape.fill);

    expect(fills).toContain('#00ff00');
    expect(fills).toContain('#ff0000');
  });
});

describe('<ChartLine>', () => {
  it('should draw a line with the given look', () => {
    const { deps, ref, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartLine coordinates={new OHLCAccessor()} style={{ line: { color: "#f59e0b", width: 1.5 } }} />
      </ChartContainer>,
    );

    const drawnLines = lines(drawn());

    expect(drawnLines).toHaveLength(1);
    expect(drawnLines[0].style.color).toBe('#f59e0b');
    expect(drawnLines[0].style.width).toBe(1.5);
  });

  it('should hide points when the radius is zero', () => {
    const { deps, ref, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartLine coordinates={new OHLCAccessor()} style={{ point: { radius: 0 } }} />
      </ChartContainer>,
    );

    const circles = drawn().filter(
      (command) =>
        command.type === 'drawShape' && command.shape.shape === 'circle',
    );

    expect(circles).toHaveLength(0);
  });

  /**
   * The `style` prop is the imperative lane's override shape, not a mirror
   * of it — so a field the mirror never had (`dashArray`) is reachable.
   */
  it('should pass a style field that has no flat prop through — dashArray', () => {
    const { deps, ref, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartLine coordinates={new OHLCAccessor()} style={{ line: { dashArray: '4 2' } }} />
      </ChartContainer>,
    );

    expect(lines(drawn())[0].style.dashArray).toBe('4 2');
  });

  /** `color` used to feed the legend swatch as well as the stroke; the swatch now reads `style.line.color`. */
  it('should register the line color as the legend swatch', () => {
    const { deps, ref, plot } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartLine name="MA" coordinates={new OHLCAccessor()} style={{ line: { color: '#123456' } }} />
      </ChartContainer>,
    );

    const sample = plot().mainPane.probe(1).find((entry) => entry.name === 'MA');
    expect(sample?.color).toBe('#123456');
  });

  it('should register the swatch on the derive and input branches too', () => {
    const { deps, ref, plot } = setup();
    const source = { read: () => [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }] };

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartLine name="D" derive={closes} deriveKey={[]} style={{ line: { color: '#00d' } }} />
        <ChartLine name="I" input={source} style={{ line: { color: '#010' } }} />
      </ChartContainer>,
    );

    const samples = plot().mainPane.probe(1);
    expect(samples.find((entry) => entry.name === 'D')?.color).toBe('#00d');
    expect(samples.find((entry) => entry.name === 'I')?.color).toBe('#010');
  });

  it('should carry readout={false} on the candle, plain line, derive and input branches', () => {
    const { deps, ref, plot } = setup();
    const source = { read: () => [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 3 }] };

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartCandles name="P" readout={false} />
        <ChartLine name="L" data={[{ x: 0, y: 1 }, { x: 1, y: 2 }]} readout={false} />
        <ChartLine name="D" derive={closes} deriveKey={[]} readout={false} />
        <ChartLine name="I" input={source} readout={false} />
        <ChartLine name="shown" derive={closes} deriveKey={[]} />
      </ChartContainer>,
    );

    const samples = plot().mainPane.probe(1);
    expect(samples.map((entry) => [entry.name, entry.readout === false])).toEqual([
      ['P', true],
      ['L', true],
      ['D', true],
      ['I', true],
      ['shown', false],
    ]);
  });

  it('should draw what derive returned', () => {
    const { deps, ref, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartLine derive={closes} deriveKey={[]} style={{ line: { color: "#7c3aed" }, point: { radius: 0 } }} />
      </ChartContainer>,
    );

    const drawnLines = lines(drawn());

    expect(drawnLines).toHaveLength(1);
    expect(drawnLines[0].points).toHaveLength(candles.length);
    expect(drawnLines[0].style.color).toBe('#7c3aed');
  });

  /** Even with a thin layer in between, placement still follows render order. */
  it('should keep JSX order next to other series', () => {
    const { deps, ref, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartPane>
          <ChartCandles />
          <ChartLine derive={closes} deriveKey={[]} style={{ line: { color: MA_COLOR }, point: { radius: 0 } }} />
        </ChartPane>
      </ChartContainer>,
    );

    // Candles draw their wicks as lines too, so we distinguish by color, not command type.
    const commands = drawn();
    const lastBody = commands.findLastIndex(
      (command) =>
        command.type === 'drawShape' && command.shape.shape === 'rect',
    );
    const indicator = commands.findIndex(
      (command) => command.type === 'drawLine' && command.style.color === MA_COLOR,
    );

    expect(lastBody).toBeGreaterThan(-1);
    expect(indicator).toBeGreaterThan(lastBody);
  });

  /** This component builds a new series on every render too, just like the others. */
  it('should not recompute derive on a re-render', () => {
    const { deps, ref, plot } = setup();
    let calls = 0;

    const derive = (source: DataView<OHLC>) => {
      calls += 1;
      return closes(source);
    };

    const view = () => (
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartLine derive={derive} deriveKey={[1]} />
      </ChartContainer>
    );

    const mounted = mount(view());
    act(() => plot().render());
    expect(calls).toBe(1);

    mounted.rerender(view());
    act(() => plot().render());

    expect(calls).toBe(1);
  });
});

describe('<Crosshair>', () => {
  it('should draw nothing until the cursor arrives', () => {
    const { deps, ref, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartCandles />
        <Crosshair />
      </ChartContainer>,
    );

    const dashed = lines(drawn()).filter((command) => command.style.dashArray);

    expect(dashed).toHaveLength(0);
  });

  it('should follow the cursor once it moves', () => {
    const { deps, ref, plot, drawn } = setup();

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartCandles />
        <Crosshair />
      </ChartContainer>,
    );

    // The pane's area isn't settled until a render has actually run once.
    act(() => plot().render());
    act(() => plot().crosshair({ x: 400, y: 300 }));

    const dashed = lines(drawn()).filter((command) => command.style.dashArray);

    expect(dashed.length).toBeGreaterThan(0);
  });

  it('should stop drawing when it unmounts', () => {
    const { deps, ref, plot, drawn } = setup();

    const view = (withCrosshair: boolean) => (
      <ChartContainer deps={deps} data={candles} plotRef={ref} showGrid={false}>
        <ChartCandles />
        {withCrosshair && <Crosshair />}
      </ChartContainer>
    );

    const mounted = mount(view(true));
    act(() => plot().render());
    act(() => plot().crosshair({ x: 400, y: 300 }));
    expect(lines(drawn()).filter((c) => c.style.dashArray).length).toBeGreaterThan(0);

    mounted.rerender(view(false));

    expect(lines(drawn()).filter((c) => c.style.dashArray)).toHaveLength(0);
  });
});


describe('the input lane', () => {
  it('should draw from a computation source and follow its reference changes', () => {
    const { deps, ref, drawn } = setup();
    let points: LineDataPoint[] = [
      { x: 0, y: 5 },
      { x: 1, y: 6 },
      { x: 2, y: 7 },
    ];
    // The Source contract, unchanged — if the reference changed, it changed.
    const source = { read: () => points };

    mount(
      <ChartContainer deps={deps} data={candles} plotRef={ref}>
        <ChartLine input={source} name="MA" />
      </ChartContainer>,
    );

    const ys = () =>
      lines(drawn())
        .map((command) => command.points.map((point) => point.y))
        .filter((line) => line.length === 3);

    expect(ys().length).toBeGreaterThan(0); // the input's set of three points got drawn as a line

    const before = ys()[0];
    points = [
      { x: 0, y: 20 },
      { x: 1, y: 21 },
      { x: 2, y: 22 },
    ];
    const after = ys()[0];
    // If the value changed, the pixels changed too — the next draw picked up the new reference.
    expect(after).not.toEqual(before);
  });
});
