import type { DataView, LineDataPoint, Plot, Series } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { createRef, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChartContainer,
  ChartPane,
  ChartSeries,
  XAxis,
  YAxis,
} from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

const price = lineSeries();
const indicator = lineSeries();

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

  return { spy, deps, ref, plot };
}

const mount = (ui: ReactElement) => render(ui);

describe('ChartContainer', () => {
  it('should create the plot once', () => {
    const { spy, deps, ref } = setup();

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={price} />
      </ChartContainer>,
    );

    expect(spy.created).toHaveLength(1);
  });

  it('should refuse children placed outside it', () => {
    expect(() => render(<ChartSeries series={price} />)).toThrow(
      /ChartContainer/,
    );
  });
});

describe('ChartSeries', () => {
  it('should land in mainPane without a ChartPane', () => {
    const { deps, ref, plot } = setup();

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={price} />
      </ChartContainer>,
    );

    expect(plot().mainPane.getSeries()).toContain(price);
  });

  // Preserving JSX order and removal on unmount are covered more thoroughly
  // (down to draw order) by series-sync.test.tsx's '<ChartSeries> order' —
  // no overlap here.
});

describe('ChartPane', () => {
  it('should reuse mainPane for the first one', () => {
    const { deps, ref, plot } = setup();

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={price} />
        </ChartPane>
      </ChartContainer>,
    );

    const instance = plot();
    expect(instance.panes).toHaveLength(1);
    expect(instance.mainPane.getSeries()).toContain(price);
  });

  it('should stack a second pane below', () => {
    const { deps, ref, plot } = setup();

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane flex={3}>
          <ChartSeries series={price} />
        </ChartPane>
        <ChartPane flex={1}>
          <ChartSeries series={indicator} />
        </ChartPane>
      </ChartContainer>,
    );

    const instance = plot();
    expect(instance.panes).toHaveLength(2);
    expect(instance.panes[1].getSeries()).toContain(indicator);
    expect(instance.panes[0].flex).toBe(3);
    expect(instance.panes[1].flex).toBe(1);
  });

  it('should send its children to its own pane', () => {
    const { deps, ref, plot } = setup();

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={price} />
        </ChartPane>
        <ChartPane>
          <ChartSeries series={indicator} />
        </ChartPane>
      </ChartContainer>,
    );

    const instance = plot();
    expect(instance.panes[0].getSeries()).not.toContain(indicator);
    expect(instance.panes[1].getSeries()).not.toContain(price);
  });

  it('should give the space back when it unmounts', () => {
    const { deps, ref, plot } = setup();

    const view = mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={price} />
        </ChartPane>
        <ChartPane>
          <ChartSeries series={indicator} />
        </ChartPane>
      </ChartContainer>,
    );

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={price} />
        </ChartPane>
      </ChartContainer>,
    );

    expect(plot().panes).toHaveLength(1);
  });

  it('should apply changed options without re-registering the series', () => {
    const { deps, ref, plot } = setup();

    const view = mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane flex={1}>
          <ChartSeries series={price} />
        </ChartPane>
      </ChartContainer>,
    );

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane flex={5}>
          <ChartSeries series={price} />
        </ChartPane>
      </ChartContainer>,
    );

    const instance = plot();
    expect(instance.mainPane.flex).toBe(5);
    expect(instance.mainPane.getSeries()).toEqual([price]);
  });
});

describe('axes', () => {
  it('should apply x options to the plot', () => {
    const { deps, ref, plot } = setup();
    const format = (value: number) => `${value}!`;

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <XAxis format={format} />
        <ChartSeries series={price} />
      </ChartContainer>,
    );

    expect(plot().getOptions().axis?.x?.format).toBe(format);
  });

  it('should apply a YAxis inside a pane to that pane only', () => {
    const { deps, ref, plot } = setup();
    const format = (value: number) => `${value}%`;

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={price} />
        </ChartPane>
        <ChartPane>
          <YAxis format={format} />
          <ChartSeries series={indicator} />
        </ChartPane>
      </ChartContainer>,
    );

    const instance = plot();
    expect(instance.panes[1].axis.format).toBe(format);
    expect(instance.panes[0].axis.format).toBeUndefined();
  });

  it('should treat a YAxis outside every pane as the default', () => {
    const { deps, ref, plot } = setup();
    const format = (value: number) => `${value}?`;

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <YAxis format={format} />
        <ChartSeries series={price} />
      </ChartContainer>,
    );

    expect(plot().getOptions().axis?.y?.format).toBe(format);
  });
});

describe('derive through the composition API', () => {
  it('should draw what derive returned', () => {
    const { deps, ref, plot } = setup();
    const seen: DataView<LineDataPoint>[] = [];
    const spySeries: Series<LineDataPoint> = {
      valueExtent: () => ({ min: 0, max: 100 }),
      draw: (_renderer, context) => seen.push(context.data),
    };

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries
         
          series={spySeries}
          derive={(source) =>
            source.map((p) => ({ x: p.x, y: p.y === null ? null : p.y * 3 }))
          }
          deriveKey={[3]}
        />
      </ChartContainer>,
    );

    act(() => plot().render());

    const drawn = seen.at(-1)!;
    expect(drawn.length).toBeGreaterThan(0);
    for (const point of drawn) {
      const source = data.find((d) => d.x === point.x)!;
      expect(point.y).toBe(source.y === null ? null : source.y * 3);
    }
  });
});

describe('render scheduling', () => {
  /** A series that counts how many times draw was called. Called once per render. */
  function counter() {
    let draws = 0;
    const series: Series<LineDataPoint> = {
      valueExtent: () => ({ min: 0, max: 100 }),
      draw: () => {
        draws += 1;
      },
    };
    return {
      series,
      get draws() {
        return draws;
      },
    };
  }

  it('should draw once the frame arrives, not during mount', async () => {
    const { deps, ref } = setup();
    const spy = counter();

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={spy.series} />
      </ChartContainer>,
    );

    // Mount requests multiple renders (setData, pane options, series
    // registration), but the frame hasn't arrived yet.
    expect(spy.draws).toBe(0);

    await waitFor(() => expect(spy.draws).toBeGreaterThan(0));
  });

  it('should collapse a whole mount into one frame', async () => {
    const { deps, ref } = setup();
    const spy = counter();

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={spy.series} />
        </ChartPane>
      </ChartContainer>,
    );

    await waitFor(() => expect(spy.draws).toBeGreaterThan(0));

    // Multiple requests, but a single draw.
    expect(spy.draws).toBe(1);
  });

  it('should draw immediately when render is called directly', () => {
    const { deps, ref, plot } = setup();
    const spy = counter();

    mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={spy.series} />
      </ChartContainer>,
    );

    act(() => plot().render());

    expect(spy.draws).toBe(1);
  });

  it('should not draw after unmount', async () => {
    const { deps, ref } = setup();
    const spy = counter();

    const view = mount(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={spy.series} />
      </ChartContainer>,
    );

    // Unmounts while leaving a scheduled frame behind.
    act(() => view.unmount());

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(spy.draws).toBe(0);
  });
});

describe('state restoration', () => {
  it('should hand pane slices to panes that mount later', () => {
    const { deps, ref, plot } = setup();

    // The pane attaches on the second commit — state arrives before structure.
    mount(
      <ChartContainer
        deps={deps}
        data={data}
        plotRef={ref}
        state={{
          panes: [
            { flex: 2, autoScale: true },
            { flex: 5, autoScale: true },
          ],
        }}
      >
        <ChartPane flex={3}>
          <ChartSeries series={price} />
        </ChartPane>
        <ChartPane flex={1}>
          <ChartSeries series={indicator} />
        </ChartPane>
      </ChartContainer>,
    );

    // Restoration wins over <ChartPane flex>'s mount-time default.
    expect(plot().panes.map((pane) => pane.flex)).toEqual([2, 5]);
  });

  it('should let a changed flex prop win after restoration', () => {
    const { deps, ref, plot } = setup();
    const state = {
      panes: [{ flex: 2, autoScale: true }],
    };

    const ui = (flex: number) => (
      <ChartContainer deps={deps} data={data} plotRef={ref} state={state}>
        <ChartPane flex={flex}>
          <ChartSeries series={price} />
        </ChartPane>
      </ChartContainer>
    );

    const { rerender } = mount(ui(3));
    expect(plot().panes[0].flex).toBe(2);

    // Changing a prop is a new instruction — restoration doesn't reapply once the pane count is unchanged.
    rerender(ui(7));
    expect(plot().panes[0].flex).toBe(7);
  });

  it('should pass stateKey through so inserted panes do not receive another pane\'s state', () => {
    const { deps, ref, plot } = setup();

    mount(
      <ChartContainer
        deps={deps}
        data={data}
        plotRef={ref}
        state={{
          panes: [
            { stateKey: 'price', flex: 2, autoScale: true },
            { stateKey: 'rsi', flex: 4, autoScale: true },
          ],
        }}
      >
        <ChartPane stateKey="price" flex={1}>
          <ChartSeries series={price} />
        </ChartPane>
        <ChartPane stateKey="volume" flex={7}>
          <ChartSeries series={indicator} />
        </ChartPane>
        <ChartPane stateKey="rsi" flex={1}>
          <ChartSeries series={indicator} />
        </ChartPane>
      </ChartContainer>,
    );

    expect(plot().panes.map((pane) => [pane.stateKey, pane.flex])).toEqual([
      ['price', 2],
      ['volume', 7],
      ['rsi', 4],
    ]);
  });
});
