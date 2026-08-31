import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, type RefObject } from 'react';
import type {
  BaseDataPoint,
  LineDataPoint,
  Plot,
  XDomainChangePayload,
} from '@finchart/core';
import { immediateScheduler, lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { afterEach, describe, expect, it } from 'vitest';
import { usePlot, type UsePlotOptions } from '../hooks/use-chart';
import { layersSpy } from './fake-layers';

/** Only the hook is under test, so this renders just one container. `expose` hands out the live plot for a test that reads its state. */
function Harness<T extends BaseDataPoint>({
  expose,
  ...props
}: UsePlotOptions<T> & { expose?: (plotRef: RefObject<Plot | null>) => void }) {
  const { containerRef, plotRef } = usePlot(props);
  expose?.(plotRef);
  return <div ref={containerRef} />;
}

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
    /**
     * Doesn't wait for a frame.
     *
     * jsdom has rAF, so with the default `frameScheduler`, rendering would
     * get pushed to the next frame. Layer resizing now happens **right
     * before drawing** (to avoid a resize flicker), so without running a
     * frame there'd be nothing to observe.
     */
    createScheduler: immediateScheduler,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
    // Feed the recipe an inspectable div to get the finished wiring.
  })(document.createElement("div"));

  return { spy, deps, series: lineSeries() };
}

describe('usePlot lifecycle', () => {
  it('should create the plot once on mount', () => {
    const { spy, deps, series } = setup();

    render(<Harness deps={deps} series={series} data={data} />);

    expect(spy.created).toHaveLength(1);
  });

  it('should NOT recreate the plot when the grid is toggled', () => {
    const { spy, deps, series } = setup();
    const { rerender } = render(
      <Harness deps={deps} series={series} data={data} showGrid />,
    );

    rerender(
      <Harness deps={deps} series={series} data={data} showGrid={false} />,
    );

    // Recreation would swap out the canvas, wiping out pan position and annotations.
    expect(spy.created).toHaveLength(1);
    expect(spy.destroyed).toHaveLength(0);
  });

  it('should resize instead of recreating on a size change', () => {
    const { spy, deps, series } = setup();
    const { rerender } = render(
      <Harness deps={deps} series={series} data={data} width={800} height={600} />,
    );

    rerender(
      <Harness deps={deps} series={series} data={data} width={400} height={300} />,
    );

    expect(spy.created).toHaveLength(1);
    expect(spy.resizes).toContainEqual({ width: 400, height: 300 });
  });

  it('should swap the series without recreating the plot', () => {
    const { spy, deps, series } = setup();
    const { rerender } = render(
      <Harness deps={deps} series={series} data={data} />,
    );

    rerender(<Harness deps={deps} series={lineSeries()} data={data} />);

    expect(spy.created).toHaveLength(1);
  });

  it('should push new data without recreating the plot', () => {
    const { spy, deps, series } = setup();
    const { rerender } = render(
      <Harness deps={deps} series={series} data={data} />,
    );

    rerender(
      <Harness deps={deps} series={series} data={[...data, { x: 150, y: 5 }]} />,
    );

    expect(spy.created).toHaveLength(1);
  });

  it('should destroy the plot on unmount', () => {
    const { spy, deps, series } = setup();
    const { unmount } = render(
      <Harness deps={deps} series={series} data={data} />,
    );

    act(() => unmount());

    expect(spy.destroyed).toHaveLength(1);
  });

  it('should keep the same overlay element across prop changes', () => {
    const { spy, deps, series } = setup();
    const { rerender } = render(
      <Harness deps={deps} series={series} data={data} showGrid />,
    );
    const overlay = spy.created[0].overlay;

    rerender(
      <Harness
        deps={deps}
        series={series}
        data={data}
        showGrid={false}
        width={640}
      />,
    );

    expect(spy.created[0].overlay).toBe(overlay);
    expect(spy.created).toHaveLength(1);
  });
});

describe('onXDomainChange', () => {
  it('should deliver refits through the prop', () => {
    const { deps, series } = setup();
    const seen: XDomainChangePayload[] = [];
    const listen = (change: XDomainChangePayload) => seen.push(change);

    const { rerender } = render(
      <Harness deps={deps} series={series} data={data} onXDomainChange={listen} />,
    );

    // A new dataset (as opposed to a live update) triggers a refit — the domain moves to the new range.
    rerender(
      <Harness
        deps={deps}
        series={series}
        data={[
          { x: 0, y: 1 },
          { x: 200, y: 2 },
        ]}
        onXDomainChange={listen}
      />,
    );

    expect(seen.at(-1)).toMatchObject({ startX: 0, endX: 200 });
  });

  /**
   * StrictMode runs mount twice: it builds a plot, tears it down, and
   * builds another. There used to be an incident where hooking `plot.on`
   * from an outer effect left the listener attached to the first
   * (destroyed) plot — the prop path rebinds inside the same effect as the
   * plot, so it should hear events from the second plot instead.
   */
  it('should follow the live plot under StrictMode double mounting', () => {
    const { deps, series } = setup();
    const seen: XDomainChangePayload[] = [];
    const listen = (change: XDomainChangePayload) => seen.push(change);

    const { rerender } = render(
      <StrictMode>
        <Harness deps={deps} series={series} data={data} onXDomainChange={listen} />
      </StrictMode>,
    );

    rerender(
      <StrictMode>
        <Harness
          deps={deps}
          series={series}
          data={[
            { x: -50, y: 1 },
            { x: 150, y: 2 },
          ]}
          onXDomainChange={listen}
        />
      </StrictMode>,
    );

    expect(seen.at(-1)).toMatchObject({ startX: -50, endX: 150 });
  });
});

describe('chart state props', () => {
  it('should let the state prop win over the initial fit', () => {
    const { deps, series } = setup();
    let plotRef: RefObject<Plot | null> | undefined;

    render(
      <StrictMode>
        <Harness
          deps={deps}
          series={series}
          data={data}
          state={{ xDomain: { min: 10, max: 20 } }}
          expose={(ref) => { plotRef = ref; }}
        />
      </StrictMode>,
    );

    // This is the restored window, not the data's fit ([0, 100]) — even under double mounting.
    expect(plotRef?.current?.getState().xDomain).toEqual({ min: 10, max: 20 });
  });

  it('should mirror internal changes through onStateChange', () => {
    const { deps, series } = setup();
    const seen: import('@finchart/core').ChartState[] = [];
    const listen = (state: import('@finchart/core').ChartState) =>
      seen.push(state);

    const { rerender } = render(
      <Harness deps={deps} series={series} data={data} onStateChange={listen} />,
    );

    rerender(
      <Harness
        deps={deps}
        series={series}
        data={[
          { x: 0, y: 1 },
          { x: 200, y: 2 },
        ]}
        onStateChange={listen}
      />,
    );

    expect(seen.at(-1)?.xDomain).toEqual({ min: 0, max: 200 });
  });
});
