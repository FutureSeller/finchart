/**
 * The value axis had **two doors to write through**.
 *
 * `<ChartPane axis>` and the `<YAxis>` inside a pane both call the same
 * `pane.applyOptions({axis})`, and both write every field they know about
 * (leaving the ones they weren't given as `undefined`). Since core's merge
 * is a spread, `undefined` overwrites too, so **whichever ran last erased
 * the other's settings.** Observed in practice: right after mount,
 * `<YAxis>`'s format was the one called, but changing a single `flex` prop
 * that had nothing to do with the axis made `<ChartPane axis>`'s format the
 * one called from then on — same JSX, a different owner.
 *
 * The fix was to cut it down to one door (see `chart-pane.tsx`). The type
 * lock lives in `react-lane.types.tsx` — if the door reopens to two,
 * compilation fails there. This is the **behavior lock** that checks the
 * one remaining door actually holds up under that scenario.
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries, YAxis } from '../components';
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

/** Which format is alive — whichever one the value axis actually calls owns it. */
function marker() {
  let calls = 0;
  const format = (value: number) => {
    calls += 1;
    return String(value);
  };
  return {
    format,
    get calls() {
      return calls;
    },
  };
}

describe('the value axis has exactly one door to write through', () => {
  it('<YAxis> inside a pane keeps ownership even when an unrelated prop changes', () => {
    const { deps, ref, plot } = setup();
    const axis = marker();

    const tree = (flex: number) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane flex={flex}>
          <YAxis format={axis.format} />
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>
    );

    const view = render(tree(1));
    plot().render();
    expect(axis.calls).toBeGreaterThan(0);

    // Change a prop (flex) that has nothing to do with the axis — ownership doesn't move.
    view.rerender(tree(2));
    plot().render();
    const before = axis.calls;
    plot().render();

    expect(axis.calls).toBeGreaterThan(before);
  });
});
