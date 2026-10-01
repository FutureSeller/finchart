/**
 * `<Legend>` follows the pane it sits in, and `<Tooltip offset>` reaches the
 * DOM plugin on install, change and removal. The overlay boxes are the
 * observable — which series a legend lists says which pane it reads.
 */
import type { LineDataPoint, Pane, Plot } from '@finchart/core';
import { browserDeps, legend, tooltip } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartContainer, ChartLine, ChartPane, Legend, Tooltip } from '../components';
import { PaneProvider } from '../components/chart-context';
import { layersSpy } from './fake-layers';

// The real plugins, watched — what an install was handed is otherwise
// indistinguishable from the options applied right after it.
vi.mock('@finchart/dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@finchart/dom')>();
  return { ...actual, legend: vi.fn(actual.legend), tooltip: vi.fn(actual.tooltip) };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const upper: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];
const lower: LineDataPoint[] = [
  { x: 0, y: 1 },
  { x: 50, y: 2 },
  { x: 100, y: 3 },
];

function setup() {
  const spy = layersSpy();
  const deps = browserDeps({
    createLayers: spy.createLayers,
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
  const overlay = () => {
    const layers = spy.created[spy.created.length - 1];
    const element = layers?.overlay;
    if (!(element instanceof HTMLElement)) throw new Error('no overlay');
    return element;
  };
  const legends = () => [...overlay().querySelectorAll('[data-chart-legend]')];
  const frame = () => act(() => plot().render());
  return { deps, ref, plot, overlay, legends, frame };
}

const fixed = (digits: number) => (value: number) => value.toFixed(digits);

describe('<Legend> inside a <ChartPane>', () => {
  it('lists the series of the pane it sits in, not mainPane', () => {
    const { deps, ref, legends, plot, frame } = setup();
    render(
      <ChartContainer deps={deps} data={upper} plotRef={ref}>
        <ChartPane>
          <ChartLine name="PRICE" data={upper} />
        </ChartPane>
        <ChartPane>
          <ChartLine name="RSI" data={lower} />
          <Legend formatValue={fixed(1)} />
        </ChartPane>
      </ChartContainer>,
    );
    frame();
    expect(plot().panes).toHaveLength(2);
    const boxes = legends();
    expect(boxes).toHaveLength(1);
    expect(boxes[0].textContent).toContain('RSI 3.0');
    expect(boxes[0].textContent).not.toContain('PRICE');
    const { top } = plot().panes[1].area;
    expect(boxes[0]).toHaveProperty('style.top', `${top + 6}px`);
  });

  it('moves to a new pane with the latest format, whether the format changed earlier or in the same commit', () => {
    const { deps, ref, legends, plot, frame } = setup();
    const called: number[] = [];
    // One function per digit count — a rerender with the same count keeps the
    // reference, so a pane-only switch really changes nothing but the pane.
    const formats = new Map<number, (value: number) => string>();
    const logged = (digits: number) => {
      const known = formats.get(digits);
      if (known) return known;
      const format = (value: number) => {
        called.push(digits);
        return value.toFixed(digits);
      };
      formats.set(digits, format);
      return format;
    };
    const ui = (target: Pane | null, digits: number): ReactElement => (
      <ChartContainer deps={deps} data={upper} plotRef={ref}>
        <ChartPane>
          <ChartLine name="PRICE" data={upper} />
        </ChartPane>
        <ChartPane>
          <ChartLine name="RSI" data={lower} />
        </ChartPane>
        <PaneProvider value={target}>
          <Legend formatValue={logged(digits)} />
        </PaneProvider>
      </ChartContainer>
    );
    const view = render(ui(null, 1));
    frame();
    expect(legends()[0].textContent).toContain('PRICE 15.0');

    const [main, second] = plot().panes;

    // Format first, then the pane on its own — the reinstall reads the format given before.
    view.rerender(ui(null, 3));
    frame();
    expect(legends()[0].textContent).toContain('PRICE 15.000');
    view.rerender(ui(second, 3));
    frame();
    expect(legends()).toHaveLength(1);
    expect(legends()[0].textContent).toContain('RSI 3.000');
    expect(vi.mocked(legend)).toHaveBeenLastCalledWith({ formatValue: logged(3), formatRow: undefined, pane: second });

    // Pane and format in one commit — the new pane shows the new format, and
    // the replaced formatter is never called again, not even for the
    // reinstall's first paint.
    called.length = 0;
    view.rerender(ui(main, 2));
    expect(called).not.toContain(3);
    frame();
    expect(legends()).toHaveLength(1);
    expect(legends()[0].textContent).toContain('PRICE 15.00');
    expect(legends()[0].textContent).not.toContain('PRICE 15.000');
  });

  it('leaves no box and no subscription behind under StrictMode or once removed', () => {
    const { deps, ref, legends, plot, frame } = setup();
    let calls = 0;
    const counted = (value: number) => {
      calls += 1;
      return value.toFixed(1);
    };
    const ui = (shown: boolean): ReactElement => (
      <StrictMode>
        <ChartContainer deps={deps} data={upper} plotRef={ref}>
          <ChartPane>
            <ChartLine name="PRICE" data={upper} />
          </ChartPane>
          <ChartPane>
            <ChartLine name="RSI" data={lower} />
            {shown && <Legend formatValue={counted} />}
          </ChartPane>
        </ChartContainer>
      </StrictMode>
    );
    const view = render(ui(true));
    frame();
    expect(legends()).toHaveLength(1);
    expect(calls).toBeGreaterThan(0);

    // The chart stays; only the legend goes. A frame and a cursor move after
    // that reach no formatter — nothing is still listening.
    view.rerender(ui(false));
    expect(legends()).toHaveLength(0);
    calls = 0;
    frame();
    const { area } = plot().panes[1];
    act(() => plot().crosshair({ x: area.left + 5, y: area.top + 5 }));
    expect(calls).toBe(0);
  });
});

describe('<Tooltip offset>', () => {
  // jsdom has no layout: the overlay reads as the default 800×600 chart and
  // the box as 100×40, so the tooltip's edge checks have something to measure.
  const sizes = { clientWidth: 800, clientHeight: 600, offsetWidth: 100, offsetHeight: 40 };
  const saved = Object.keys(sizes).map((key) => ({
    key,
    descriptor: Object.getOwnPropertyDescriptor(HTMLElement.prototype, key),
  }));
  beforeEach(() => {
    for (const [key, value] of Object.entries(sizes)) {
      Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
    }
  });
  afterEach(() => {
    for (const { key, descriptor } of saved) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    }
  });

  function hover(plot: () => Plot, at: 'left' | 'right') {
    act(() => plot().render());
    const { area } = plot().mainPane;
    const position = { x: at === 'left' ? area.left + 1 : area.right - 1, y: area.top + 5 };
    act(() => plot().crosshair(position));
    return { position, area };
  }

  it('applies on install, follows a change, and falls back to 12 when removed', () => {
    const { deps, ref, plot, overlay } = setup();
    const ui = (offset?: number): ReactElement => (
      <ChartContainer deps={deps} data={upper} plotRef={ref}>
        <ChartLine name="PRICE" data={upper} />
        <Tooltip offset={offset} />
      </ChartContainer>
    );
    const box = () => overlay().querySelector('[data-chart-tooltip]');

    const view = render(ui(30));
    expect(vi.mocked(tooltip)).toHaveBeenCalledWith(expect.objectContaining({ offset: 30 }));
    const { position } = hover(plot, 'left');
    expect(box()).toHaveProperty('style.top', `${position.y + 30}px`);

    view.rerender(ui(4));
    hover(plot, 'left');
    expect(box()).toHaveProperty('style.top', `${position.y + 4}px`);

    view.rerender(ui());
    hover(plot, 'left');
    expect(box()).toHaveProperty('style.top', `${position.y + 12}px`);
  });

  it('keeps the gap on the flipped side at the right edge', () => {
    const { deps, ref, plot, overlay } = setup();
    render(
      <ChartContainer deps={deps} data={upper} plotRef={ref}>
        <ChartLine name="PRICE" data={upper} />
        <Tooltip offset={20} />
      </ChartContainer>,
    );
    const { position } = hover(plot, 'right');
    const box = overlay().querySelector('[data-chart-tooltip]');
    // Flipped left of the cursor: the box's own width, then the gap.
    expect(box).toHaveProperty('style.left', `${position.x - 20 - 100}px`);
  });
});
