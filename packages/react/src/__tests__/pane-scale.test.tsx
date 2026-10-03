/**
 * `<ChartPane autoScale invert yScale>`.
 *
 * The two booleans follow the prop-removal rule (back to the default from
 * `PANE_OPTION_DEFAULTS`) and are applied **per changed field** — a grouped
 * `applyOptions` of every prop would, on a `flex` change, write
 * `autoScale: true` back over a pane the user had just dragged to a fixed
 * range. The same defect already existed for `flex` itself (a divider drag
 * undone by a `minHeight` change), so that is measured too.
 *
 * `yScale` is a factory read once per acquisition, like `deps.mainPaneYScale`.
 * On the main pane the wrapper keeps the instance it replaced and puts it
 * back on release, so a keyed swap to a pane without `yScale` returns to
 * what was there — not to a fresh default.
 */
import type { LineDataPoint, Plot, Scale } from '@finchart/core';
import { immediateScheduler, lineSeries, LinearScale, LogScale, PANE_OPTION_DEFAULTS } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries, Plugin } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function setup() {
  const spy = layersSpy();
  const deps = browserDeps({
    createLayers: spy.createLayers,
    createScheduler: immediateScheduler,
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
  return { deps, ref, plot };
}

/** Counts the scales a `yScale` factory hands out. */
function logFactory() {
  const made: Scale[] = [];
  const factory = () => {
    const scale = new LogScale();
    made.push(scale);
    return scale;
  };
  return { made, factory };
}

describe('<ChartPane autoScale invert>', () => {
  it('applies both and reverts a removed prop to the shared default', () => {
    const { deps, ref, plot } = setup();
    const view = render(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane autoScale={false} invert>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>,
    );
    expect(plot().panes[0].autoScale).toBe(false);
    expect(plot().panes[0].invert).toBe(true);

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>,
    );
    expect(plot().panes[0].autoScale).toBe(PANE_OPTION_DEFAULTS.autoScale);
    expect(plot().panes[0].invert).toBe(PANE_OPTION_DEFAULTS.invert);
  });

  it('writes only the field that changed — a minHeight change leaves a dragged flex alone', () => {
    const { deps, ref, plot } = setup();
    const ui = (minHeight: number) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane minHeight={minHeight}>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>
    );
    const view = render(ui(40));
    // Stand-in for the divider: an imperative flex the props never named.
    act(() => plot().panes[0].applyOptions({ flex: 2 }));
    expect(plot().panes[0].flex).toBe(2);

    view.rerender(ui(50));
    expect(plot().panes[0].minHeight).toBe(50);
    expect(plot().panes[0].flex).toBe(2);
  });

  it('writes only the field that changed — a flex change leaves a fixed range fixed', () => {
    const { deps, ref, plot } = setup();
    const ui = (flex: number) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane autoScale flex={flex}>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>
    );
    const view = render(ui(1));
    act(() => plot().panes[0].setValueDomain(0, 100));
    expect(plot().panes[0].autoScale).toBe(false);

    view.rerender(ui(2));
    expect(plot().panes[0].flex).toBe(2);
    expect(plot().panes[0].autoScale).toBe(false);
  });
});

describe('<ChartPane yScale>', () => {
  /**
   * **A log toggle is a prop change, not a remount.** The factory used to be
   * read once, so a toggle took a `key` — and the remount threw away every
   * series in the pane, the indicators built on them and a dragged height.
   */
  it('swaps the scale when the factory hands out another kind, keeping the pane and what is in it', () => {
    const { deps, ref, plot } = setup();
    const { made, factory } = logFactory();
    let installs = 0;
    const install = () => {
      installs += 1;
      return { dispose: () => undefined };
    };
    const ui = (yScale: (() => Scale) | undefined) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane />
        <ChartPane yScale={yScale}>
          <ChartSeries series={lineSeries()} />
          <Plugin install={install} />
        </ChartPane>
      </ChartContainer>
    );
    const view = render(ui(undefined));
    const pane = plot().panes[1];
    act(() => pane.applyOptions({ flex: 2 }));

    view.rerender(ui(factory));
    expect(plot().panes[1]).toBe(pane);
    expect(pane.yScale).toBe(made[0]);
    expect(pane.flex).toBe(2);
    expect(installs).toBe(1);

    view.rerender(ui(undefined));
    expect(pane.yScale).toBeInstanceOf(LinearScale);
    expect(pane.valueExtent()).not.toBeNull();
    expect(installs).toBe(1);
  });

  it('leaves the scale alone when a new factory hands out the same kind — an inline arrow is fine', () => {
    const { deps, ref, plot } = setup();
    const ui = () => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane yScale={() => new LogScale()} />
      </ChartContainer>
    );
    const view = render(ui());
    const installed = plot().mainPane.yScale;

    view.rerender(ui());
    expect(plot().mainPane.yScale).toBe(installed);
  });

  it('on the main pane, removing the prop puts back the instance it replaced', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    const built = plot().mainPane.yScale;
    const ui = (log: boolean) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane yScale={log ? () => new LogScale() : undefined} />
      </ChartContainer>
    );
    view.rerender(ui(false));
    view.rerender(ui(true));
    expect(plot().mainPane.yScale).toBeInstanceOf(LogScale);

    view.rerender(ui(false));
    expect(plot().mainPane.yScale).toBe(built);
  });

  it('gives a pane below the main one its own scale from the factory', () => {
    const { deps, ref, plot } = setup();
    const { made, factory } = logFactory();
    render(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane />
        <ChartPane yScale={factory} />
      </ChartContainer>,
    );
    expect(made).toHaveLength(1);
    expect(plot().panes[1].yScale).toBe(made[0]);
    expect(plot().mainPane.yScale).not.toBe(made[0]);
  });

  it('under StrictMode the factory runs once per acquisition — twice — and the live one wins', () => {
    const { deps, ref, plot } = setup();
    const { made, factory } = logFactory();
    render(
      <StrictMode>
        <ChartContainer deps={deps} data={data} plotRef={ref}>
          <ChartPane yScale={factory} />
        </ChartContainer>
      </StrictMode>,
    );
    expect(made).toHaveLength(2);
    expect(plot().mainPane.yScale).toBe(made[1]);
  });

  it('puts the instance it replaced back when the pane holding the main pane is swapped out', () => {
    const { deps, ref, plot } = setup();
    const { made, factory } = logFactory();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    const built = plot().mainPane.yScale;

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane key="log" yScale={factory} />
      </ChartContainer>,
    );
    expect(plot().mainPane.yScale).toBe(made[0]);

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane key="plain" />
      </ChartContainer>,
    );
    expect(plot().mainPane.yScale).toBe(built);
  });

  it('a scale the consumer installed before acquisition is what comes back', () => {
    const { deps, ref, plot } = setup();
    const mine = new LinearScale();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    act(() => plot().mainPane.setYScale(mine));

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane key="log" yScale={() => new LogScale()} />
      </ChartContainer>,
    );
    view.rerender(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    expect(plot().mainPane.yScale).toBe(mine);
  });

  it('a scale the consumer installed during acquisition is overwritten on release — the pane has one owner', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    const built = plot().mainPane.yScale;

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane key="log" yScale={() => new LogScale()} />
      </ChartContainer>,
    );
    const other = new LinearScale();
    act(() => plot().mainPane.setYScale(other));

    view.rerender(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    expect(plot().mainPane.yScale).toBe(built);
  });

  it('carries a compatible fixed domain into the new scale and keeps the range fixed', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    act(() => plot().mainPane.setValueDomain(10, 20));

    // `autoScale` is a mount-time directive too — a pane that means to keep
    // the fixed range says so, or its default (true) is applied on acquisition.
    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane autoScale={false} yScale={() => new LogScale()} />
      </ChartContainer>,
    );
    expect(plot().mainPane.yScale).toBeInstanceOf(LogScale);
    expect(plot().mainPane.yScale.getDomain()).toEqual([10, 20]);
    expect(plot().mainPane.autoScale).toBe(false);
  });

  it('an incompatible fixed domain on an empty pane leaves the new scale its own domain', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={[]} plotRef={ref} />);
    act(() => plot().mainPane.setValueDomain(-10, 20));

    view.rerender(
      <ChartContainer deps={deps} data={[]} plotRef={ref}>
        <ChartPane autoScale={false} yScale={() => new LogScale()} />
      </ChartContainer>,
    );
    expect(plot().mainPane.yScale.getDomain()).toEqual(new LogScale().getDomain());
    expect(plot().mainPane.autoScale).toBe(false);
  });

  it('on release, a restored instance that cannot hold the fixed domain keeps its old one', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={[]} plotRef={ref} />);
    const log = new LogScale();
    act(() => {
      plot().mainPane.setYScale(log);
      plot().mainPane.setValueDomain(100, 200);
    });

    view.rerender(
      <ChartContainer deps={deps} data={[]} plotRef={ref}>
        <ChartPane key="lin" yScale={() => new LinearScale()} />
      </ChartContainer>,
    );
    act(() => plot().mainPane.setValueDomain(-10, 20));

    view.rerender(<ChartContainer deps={deps} data={[]} plotRef={ref} />);
    expect(plot().mainPane.yScale).toBe(log);
    expect(log.getDomain()).toEqual([100, 200]);
  });

  it('unmounting the whole container with a yScale pane does not throw', () => {
    const { deps, ref } = setup();
    const view = render(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane yScale={() => new LogScale()}>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>,
    );
    expect(() => view.unmount()).not.toThrow();
  });
});

/**
 * `<ChartPane valueDomain>` — a fixed value axis declared, the way an
 * oscillator pane pins 0..100. Without it the only way was the indicator's
 * own pane, which a period change rebuilt — at the bottom of the stack,
 * without its drawings or height.
 */
describe('<ChartPane valueDomain>', () => {
  it('pins the range on mount and on a change of values, not of array identity', () => {
    const { deps, ref, plot } = setup();
    const ui = (min: number, max: number) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane />
        <ChartPane valueDomain={[min, max]}>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>
    );
    const view = render(ui(0, 100));
    const pane = plot().panes[1];
    expect(pane.yScale.getDomain()).toEqual([0, 100]);
    expect(pane.autoScale).toBe(false);

    // The user zooms the axis; a re-render with the same values leaves that alone.
    act(() => pane.setValueDomain(20, 80));
    view.rerender(ui(0, 100));
    expect(pane.yScale.getDomain()).toEqual([20, 80]);

    view.rerender(ui(-100, 0));
    expect(pane.yScale.getDomain()).toEqual([-100, 0]);
  });

  it('hands the axis back to autoScale when removed', () => {
    const { deps, ref, plot } = setup();
    const ui = (fixed: boolean) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane valueDomain={fixed ? [0, 100] : undefined}>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>
    );
    const view = render(ui(true));
    expect(plot().mainPane.autoScale).toBe(false);

    view.rerender(ui(false));
    expect(plot().mainPane.autoScale).toBe(true);
  });
});
