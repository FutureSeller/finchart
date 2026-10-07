/**
 * `<ChartContainer options>` is the one door for the plot options that have
 * no prop of their own. Three things are measured here, each of which a
 * plausible wrong implementation gets wrong:
 *
 * - **A missing key reverts to what the plot was built with.** Core's merge
 *   treats `undefined` as "not given", so the wrapper has to say the value
 *   itself — and for padding it has to say every side, or a side set once
 *   survives the removal of its key.
 * - **The bag is picked, not spread.** `Omit` is the type of the door; a
 *   variable typed as the wider `PlotOptionsPatch` still assigns to it, and
 *   only an explicit pick keeps `showGrid` from arriving through two doors.
 * - **The first application precedes the first fit.** `rightOffset` is read
 *   when the first data fits the x domain; the shim this replaces ran after
 *   the series' own effect depending on JSX order.
 */
import type { LineDataPoint, Plot, PlotOptionsPatch } from '@finchart/core';
import { ContractError, DEFAULT_PADDING, immediateScheduler, lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { cleanup, render } from '@testing-library/react';
import { Component, createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartContainer, ChartSeries } from '../components';
import type { PlotOptions } from '../components';
import { shallowEqual } from '../shallow-equal';
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

describe('shallowEqual — the comparison the option props stand on', () => {
  it('compares the key set, not the key count', () => {
    expect(shallowEqual({ rightOffset: undefined }, { axisDrag: false })).toBe(false);
    expect(shallowEqual({ padding: { left: undefined } }, { padding: { top: 11 } })).toBe(false);
    expect(shallowEqual({ padding: { left: 1 } }, { padding: { left: 1 } })).toBe(true);
    expect(shallowEqual({ a: 1, b: undefined }, { a: 1, b: undefined })).toBe(true);
  });

  it('tells a value with an extra key apart, in either order', () => {
    expect(shallowEqual({ rightOffset: 5 }, { rightOffset: 5, axisDrag: false })).toBe(false);
    expect(shallowEqual({ rightOffset: 5, axisDrag: false }, { rightOffset: 5 })).toBe(false);
  });

  it('tells arrays apart when one is the other plus more elements', () => {
    const first = { x: 10, price: 110 };
    const second = { x: 50, price: 112 };
    expect(shallowEqual([first], [first, second])).toBe(false);
    expect(shallowEqual([first, second], [first, second])).toBe(true);
  });

  it('compares one nested level by value, and settles on two distinct circular values', () => {
    expect(shallowEqual({ style: { color: 'red' } }, { style: { color: 'red' } })).toBe(true);
    // The depth cap is what stops this — descending without one recurses until the stack overflows.
    const a: Record<string, unknown> = {};
    a.self = a;
    const b: Record<string, unknown> = {};
    b.self = b;
    expect(shallowEqual(a, b)).toBe(false);
  });
});

class Boundary extends Component<{ children: ReactNode; caught: unknown[] }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.caught.push(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

describe('<ChartContainer options>', () => {
  it('destroys the plot it just built when the initial options are refused — the error still reaches the boundary', () => {
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
    const caught: unknown[] = [];
    const quiet = console.error;
    console.error = () => undefined;
    try {
      render(
        <Boundary caught={caught}>
          <ChartContainer deps={deps} data={data} plotRef={ref} options={{ minBarSpacing: 9, maxBarSpacing: 5 }} />
        </Boundary>,
      );
    } finally {
      console.error = quiet;
    }
    expect(caught).toHaveLength(1);
    expect(caught[0]).toBeInstanceOf(ContractError);
    // Every layer set the plot created was destroyed again, and no plot is left in the ref.
    expect(spy.destroyed).toHaveLength(spy.created.length);
    expect(spy.created.length).toBeGreaterThan(0);
    expect(ref.current).toBeNull();
  });

  it('applies every key it carries and reverts a removed key to the built value', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    const built = plot().getOptions();

    view.rerender(
      <ChartContainer
        deps={deps}
        data={data}
        plotRef={ref}
        options={{
          rightOffset: 5,
          resizablePanes: false,
          axisDrag: false,
          shiftVisibleRangeOnNewBar: true,
          preserveLiveRightEdgeOnZoomOut: true,
        }}
      />,
    );
    const set = plot().getOptions();
    expect(set.rightOffset).toBe(5);
    expect(set.resizablePanes).toBe(false);
    expect(set.axisDrag).toBe(false);
    expect(set.shiftVisibleRangeOnNewBar).toBe(true);
    expect(set.preserveLiveRightEdgeOnZoomOut).toBe(true);

    view.rerender(<ChartContainer deps={deps} data={data} plotRef={ref} options={{}} />);
    const reverted = plot().getOptions();
    expect(reverted.rightOffset).toBe(built.rightOffset);
    expect(reverted.resizablePanes).toBe(built.resizablePanes);
    expect(reverted.axisDrag).toBe(built.axisDrag);
    expect(reverted.shiftVisibleRangeOnNewBar).toBe(built.shiftVisibleRangeOnNewBar);
    expect(reverted.preserveLiveRightEdgeOnZoomOut).toBe(built.preserveLiveRightEdgeOnZoomOut);
  });

  it('reverts a padding side that is no longer named, not just the ones named now', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    const base = plot().getOptions().padding;

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ padding: { left: 99 } }} />,
    );
    expect(plot().getOptions().padding.left).toBe(99);

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ padding: { top: 11 } }} />,
    );
    const now = plot().getOptions().padding;
    expect(now.top).toBe(11);
    expect(now.left).toBe(base.left);
    expect(now.right).toBe(base.right);
    expect(now.bottom).toBe(base.bottom);

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ padding: { right: 7, bottom: 8 } }} />,
    );
    const other = plot().getOptions().padding;
    expect([other.top, other.right, other.bottom, other.left]).toEqual([base.top, 7, 8, base.left]);
  });

  it('keeps the built padding on every side the options do not name', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    expect(plot().getOptions().padding).toEqual(DEFAULT_PADDING);

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ padding: { left: 9 } }} />,
    );
    expect(plot().getOptions().padding).toEqual({ ...DEFAULT_PADDING, left: 9 });
  });

  it('treats a key that is present but undefined as absent — a different key with a value is a change', () => {
    const { deps, ref, plot } = setup();
    const view = render(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ rightOffset: undefined }} />,
    );
    expect(plot().getOptions().axisDrag).toBe(true);
    view.rerender(<ChartContainer deps={deps} data={data} plotRef={ref} options={{ axisDrag: false }} />);
    expect(plot().getOptions().axisDrag).toBe(false);

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ padding: { left: undefined } }} />,
    );
    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ padding: { top: 11 } }} />,
    );
    expect(plot().getOptions().padding.top).toBe(11);
  });

  it('clears a bar-spacing override when its key goes — the key itself is gone, not null', () => {
    const { deps, ref, plot } = setup();
    const view = render(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ minBarSpacing: 3, maxBarSpacing: 40 }} />,
    );
    expect(plot().getOptions().minBarSpacing).toBe(3);
    expect(plot().getOptions().maxBarSpacing).toBe(40);

    view.rerender(<ChartContainer deps={deps} data={data} plotRef={ref} options={{}} />);
    const cleared = plot().getOptions();
    expect(cleared.minBarSpacing).toBeUndefined();
    expect(Object.hasOwn(cleared, 'minBarSpacing')).toBe(false);
    expect(Object.hasOwn(cleared, 'maxBarSpacing')).toBe(false);
  });

  it('picks its seven keys — a wider variable does not smuggle showGrid through', () => {
    const { deps, ref, plot } = setup();
    const view = render(<ChartContainer deps={deps} data={data} plotRef={ref} />);
    expect(plot().getOptions().showGrid).toBe(true);

    // Assignable: `Omit` is not a runtime filter, so the pick has to be.
    const wider: PlotOptionsPatch = { showGrid: false, rightOffset: 7 };
    const options: PlotOptions = wider;
    view.rerender(<ChartContainer deps={deps} data={data} plotRef={ref} options={options} />);
    expect(plot().getOptions().rightOffset).toBe(7);
    expect(plot().getOptions().showGrid).toBe(true);
  });

  it('lands rightOffset before the first fit, whatever the JSX order', () => {
    const { deps, ref, plot } = setup();
    render(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ rightOffset: 5 }}>
        <ChartSeries series={lineSeries()} />
      </ChartContainer>,
    );
    // continuousX: the domain is the data's x plus the offset.
    expect(plot().getVisibleRange()).toEqual({ min: 0, max: 105 });
  });

  it('does not re-apply an inline literal whose values did not change', () => {
    const { deps, ref, plot } = setup();
    const view = render(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ rightOffset: 5, padding: { left: 9 } }} />,
    );
    const apply = vi.spyOn(plot(), 'applyOptions');
    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ rightOffset: 5, padding: { left: 9 } }} />,
    );
    expect(apply).not.toHaveBeenCalled();
    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref} options={{ rightOffset: 6, padding: { left: 9 } }} />,
    );
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
