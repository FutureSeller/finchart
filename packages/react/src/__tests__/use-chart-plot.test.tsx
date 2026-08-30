/**
 * `useChartPlot` — from **inside** the container, does imperative
 * configuration follow the stage?
 *
 * What it's compared against is the "parent effect + plotRef" pattern: when
 * StrictMode double-mounts a new child on a `key` remount, the parent's
 * effect is an update so it only runs once, and it ends up holding **the
 * first, discarded instance** — tool installs and applyOptions calls go
 * nowhere. A child inside the container only ever renders after the api is
 * up, so it always sees the current stage.
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, type RefObject, StrictMode, useEffect, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, useChartPlot } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
];

function makeDeps() {
  return browserDeps({
    createLayers: layersSpy().createLayers,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
  });
}

/** A config component inside the container — applies options to the current stage. */
function Setup({ seen }: { seen: Plot[] }) {
  const plot = useChartPlot();
  useEffect(() => {
    seen.push(plot);
    plot.applyOptions({ minBarSpacing: 7 });
  }, [plot, seen]);
  return null;
}

/** Parent effect + plotRef — the control group for the pattern that breaks on remount. */
function Stale({
  plotRef,
  wiring,
  seen,
}: {
  plotRef: RefObject<Plot | null>;
  wiring: string;
  seen: Plot[];
}) {
  useEffect(() => {
    if (!plotRef.current) return;
    seen.push(plotRef.current);
    plotRef.current.applyOptions({ maxBarSpacing: 9 });
  }, [plotRef, wiring]);
  return null;
}

function Harness({
  insideSeen,
  outsideSeen,
  plotRef,
}: {
  insideSeen: Plot[];
  outsideSeen: Plot[];
  plotRef: RefObject<Plot | null>;
}) {
  const [wiring, setWiring] = useState('a');

  return (
    <>
      <button type="button" onClick={() => setWiring('b')}>
        rewire
      </button>
      <Stale plotRef={plotRef} wiring={wiring} seen={outsideSeen} />
      <ChartContainer key={wiring} deps={makeDeps()} data={data} plotRef={plotRef}>
        <Setup seen={insideSeen} />
      </ChartContainer>
    </>
  );
}

describe('useChartPlot', () => {
  it('should throw outside <ChartContainer>', () => {
    function Naked() {
      useChartPlot();
      return null;
    }

    expect(() => render(<Naked />)).toThrow(/inside <ChartContainer>/);
  });

  it('should follow the plot across a key remount where a parent effect goes stale', async () => {
    const insideSeen: Plot[] = [];
    const outsideSeen: Plot[] = [];
    const plotRef = createRef<Plot>();

    const screen = render(
      <StrictMode>
        <Harness insideSeen={insideSeen} outsideSeen={outsideSeen} plotRef={plotRef} />
      </StrictMode>,
    );

    await act(async () => {
      screen.getByText('rewire').click();
    });

    const live = plotRef.current;
    expect(live).not.toBeNull();

    // Inside: the last plot it saw is the live one, and the option stuck to the stage.
    expect(insideSeen.at(-1)).toBe(live);
    expect(live?.getOptions().minBarSpacing).toBe(7);

    // Outside (control group): what it grabbed on remount isn't the live
    // plot — the option went nowhere. If this assertion ever breaks (the
    // day React changes its ordering), this hook's reason for existing is
    // gone, so re-examine it alongside that change.
    expect(live?.getOptions().maxBarSpacing).toBeUndefined();
  });
});
