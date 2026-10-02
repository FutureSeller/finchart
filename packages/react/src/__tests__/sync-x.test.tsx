/**
 * `<SyncX>` + `onPlot` — does the wiring between containers hold up over
 * state?
 *
 * The core regression is a key remount: wiring based on `plotRef` has the
 * parent's effect holding onto a discarded instance. `onPlot`
 * swaps the state every time a stage comes up or goes down, so `<SyncX>`
 * gets rewired to the new stage.
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartLine, SyncX } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [
  { x: 0, y: 100 },
  { x: 50, y: 120 },
  { x: 100, y: 110 },
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

function domainOf(plot: Plot | null) {
  const domain = plot?.getVisibleRange();
  if (!domain) throw new Error('xDomain does not exist yet');
  return domain;
}

/** Records the live stages alongside state so the test can manipulate them from outside. */
function Harness({ live }: { live: { a: Plot | null; b: Plot | null } }) {
  const [a, setA] = useState<Plot | null>(null);
  const [b, setB] = useState<Plot | null>(null);
  const [wiring, setWiring] = useState('a');
  live.a = a;
  live.b = b;

  return (
    <>
      <button type="button" onClick={() => setWiring('b')}>
        rewire
      </button>
      <ChartContainer key={wiring} deps={makeDeps()} data={data} onPlot={setA}>
        <ChartLine />
      </ChartContainer>
      <ChartContainer deps={makeDeps()} data={data} onPlot={setB}>
        <ChartLine />
      </ChartContainer>
      <SyncX plots={[a, b]} />
    </>
  );
}

describe('SyncX + onPlot', () => {
  it('should mirror windows across containers', async () => {
    const live: { a: Plot | null; b: Plot | null } = { a: null, b: null };
    render(
      <StrictMode>
        <Harness live={live} />
      </StrictMode>,
    );

    await act(async () => {
      live.a?.setVisibleRange(10, 40);
    });
    expect(domainOf(live.b)).toEqual({ min: 10, max: 40 });

    await act(async () => {
      live.b?.pan(5);
    });
    expect(domainOf(live.a)).toEqual(domainOf(live.b));
  });

  it('should rewire to the new plot across a key remount', async () => {
    const live: { a: Plot | null; b: Plot | null } = { a: null, b: null };
    const screen = render(
      <StrictMode>
        <Harness live={live} />
      </StrictMode>,
    );

    const before = live.a;
    await act(async () => {
      screen.getByText('rewire').click();
    });
    expect(live.a).not.toBe(before); // the new stage made it into state

    // Sync with the new stage — with plotRef-based wiring, this would go nowhere.
    await act(async () => {
      live.b?.setVisibleRange(20, 60);
    });
    expect(domainOf(live.a)).toEqual({ min: 20, max: 60 });
  });

  it('should be a no-op below two live plots', async () => {
    function Lonely() {
      const [a, setA] = useState<Plot | null>(null);
      return (
        <>
          <ChartContainer deps={makeDeps()} data={data} onPlot={setA}>
            <ChartLine />
          </ChartContainer>
          <SyncX plots={[a, null, null, null]} />
        </>
      );
    }

    // Doesn't throw even with only one live stage.
    expect(() => render(<Lonely />)).not.toThrow();
  });
});


/**
 * **A growing list has to trigger a rewire.**
 *
 * If the array is spread directly as deps (`useEffect(fn, plots)`), React's
 * `areHookInputsEqual` only walks up to the shorter length, so **it cannot
 * see a length change** (that's just a dev-mode warning, not a mismatch).
 * Even after adding another symbol to compare, as long as the shared prefix
 * matches, the effect never reruns and the new stage never makes it into
 * `syncX`.
 *
 * The tests above never caught this because `plots` was always length 2.
 */
describe('SyncX — when the list length changes', () => {
  function Growing({ live }: { live: { a: Plot | null; b: Plot | null } }) {
    const [a, setA] = useState<Plot | null>(null);
    const [b, setB] = useState<Plot | null>(null);
    const [compared, setCompared] = useState(false);
    live.a = a;
    live.b = b;

    return (
      <>
        <button type="button" onClick={() => setCompared(true)}>
          add comparison
        </button>
        <ChartContainer deps={makeDeps()} data={data} onPlot={setA}>
          <ChartLine />
        </ChartContainer>
        <ChartContainer deps={makeDeps()} data={data} onPlot={setB}>
          <ChartLine />
        </ChartContainer>
        {/* One at first, two once comparison is turned on — the shape real consumers use. */}
        <SyncX plots={compared ? [a, b] : [a]} />
      </>
    );
  }

  it('should rewire when a plot is appended to the list', async () => {
    const live: { a: Plot | null; b: Plot | null } = { a: null, b: null };
    const screen = render(<Growing live={live} />);

    // Still just one — nothing to sync to, so b doesn't follow.
    await act(async () => {
      live.a?.setVisibleRange(10, 40);
    });
    expect(domainOf(live.b)).not.toEqual({ min: 10, max: 40 });

    await act(async () => {
      screen.getByText('add comparison').click();
    });

    // The list grew, so they should be synced now.
    await act(async () => {
      live.a?.setVisibleRange(20, 60);
    });
    expect(domainOf(live.b)).toEqual({ min: 20, max: 60 });
  });
});
