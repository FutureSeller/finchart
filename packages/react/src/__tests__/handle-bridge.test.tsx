/**
 * The imperative bridge: a `SeriesHandle` is already a `Source`, so an
 * `attach*` indicator reads straight from it and sees what the handle sees,
 * `prepend`ed history included. What was missing was a way to say "not yet"
 * from `usePlugin` while the handle is still `null` before commit; `install`
 * may now return `null`, which installs nothing and leaves the state `null`
 * until `deps` change.
 */
import type { OHLC, Plot, SeriesHandle } from '@finchart/core';
import { candleSeries, immediateScheduler } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { attachRsi } from '@finchart/indicators';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartPane } from '../components';
import { usePlugin } from '../hooks';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

function bars(from: number, count: number): OHLC[] {
  return Array.from({ length: count }, (_, i) => {
    const x = from + i;
    const close = 100 + Math.sin(x / 3) * 10;
    return { x, open: close - 1, high: close + 2, low: close - 2, close };
  });
}
const data = bars(100, 20);

function setup() {
  const deps = browserDeps({
    createLayers: layersSpy().createLayers,
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

type Rsi = ReturnType<typeof attachRsi> extends (plot: Plot) => infer Api ? Api : never;
type Seen = { price: SeriesHandle<OHLC> | null; rsi: Rsi | null };

/** The recipe from the README, verbatim: the handle is the indicator's source. */
function Bridge({ seen }: { seen: Seen }) {
  const price = usePlugin((_, pane) => pane.addSeries({ series: candleSeries(), data }), []);
  const rsi = usePlugin((plot) => price && plot.use(attachRsi({ source: price })), [price]);
  seen.price = price;
  seen.rsi = rsi;
  return null;
}

const rsiLength = (seen: Seen) => seen.rsi?.node.out.rsi.read().length;

describe('usePlugin — a null install is "not yet"', () => {
  it('installs nothing, disposes nothing, and returns null until deps change', () => {
    const { deps, ref } = setup();
    const log = { installs: 0, disposes: 0 };
    let latest: { dispose(): void } | null | undefined;
    function Probe({ ready }: { ready: boolean }) {
      latest = usePlugin(() => {
        if (!ready) return null;
        log.installs += 1;
        return {
          dispose: () => {
            log.disposes += 1;
          },
        };
      }, [ready]);
      return null;
    }
    const ui = (ready: boolean) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <Probe ready={ready} />
      </ChartContainer>
    );
    const view = render(ui(false));
    expect(latest).toBeNull();
    expect(log).toEqual({ installs: 0, disposes: 0 });

    view.rerender(ui(true));
    expect(latest).not.toBeNull();
    expect(log).toEqual({ installs: 1, disposes: 0 });

    view.rerender(ui(false));
    expect(latest).toBeNull();
    expect(log).toEqual({ installs: 1, disposes: 1 });
  });

  it('installs the indicator on the render after the handle arrives, and history prepended to the handle reaches it', () => {
    const { deps, ref, plot } = setup();
    const seen: Seen = { price: null, rsi: null };
    render(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <Bridge seen={seen} />
        </ChartPane>
      </ChartContainer>,
    );
    expect(plot().panes[0].getSeries()).toHaveLength(1);
    expect(seen.rsi?.pane).not.toBeNull();
    expect(rsiLength(seen)).toBe(20);

    act(() => seen.price?.prepend(bars(90, 10)));
    expect(rsiLength(seen)).toBe(30);
  });

  it('under StrictMode the handle that survives the replay is the live one — it still feeds', () => {
    const { deps, ref, plot } = setup();
    const seen: Seen = { price: null, rsi: null };
    render(
      <StrictMode>
        <ChartContainer deps={deps} data={data} plotRef={ref}>
          <ChartPane>
            <Bridge seen={seen} />
          </ChartPane>
        </ChartContainer>
      </StrictMode>,
    );
    // One live price registration — the replayed one was disposed — and one RSI reading it.
    expect(plot().panes[0].getSeries()).toHaveLength(1);
    expect(rsiLength(seen)).toBe(20);

    act(() => seen.price?.append(bars(120, 5)));
    expect(seen.price?.read()).toHaveLength(25);
    expect(rsiLength(seen)).toBe(25);
  });

  it('unmounts the pair without throwing', () => {
    const { deps, ref, plot } = setup();
    const seen: Seen = { price: null, rsi: null };
    function Host() {
      const [on, setOn] = useState(true);
      return (
        <ChartContainer deps={deps} data={data} plotRef={ref}>
          <ChartPane>{on ? <Bridge seen={seen} /> : null}</ChartPane>
          <button type="button" onClick={() => setOn(false)} />
        </ChartContainer>
      );
    }
    const view = render(<Host />);
    expect(plot().panes).toHaveLength(2);
    act(() => view.container.querySelector('button')?.click());
    expect(plot().panes[0].getSeries()).toHaveLength(0);
    expect(plot().panes).toHaveLength(1);
    expect(() => view.unmount()).not.toThrow();
  });
});
