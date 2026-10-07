/**
 * `usePlugin` — does the plugin's lifetime follow React's?
 *
 * Three contracts: (1) install/dispose stay symmetric with mount/unmount
 * (including a StrictMode round trip), (2) reinstallation is decided by
 * deps, not by the install function's reference, (3) inside a
 * `<ChartPane>`, that pane is what gets handed in.
 */
import type { LineDataPoint, Pane, Plot } from '@finchart/core';
import { crosshair } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartPane } from '../components';
import { PaneProvider } from '../components/chart-context';
import { usePlugin } from '../hooks';
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

/** A fake plugin factory that counts installs and disposes. */
function pluginSpy() {
  const log = { installs: 0, disposes: 0, targets: [] as Pane[], plots: [] as Plot[] };

  const install = (plot: Plot, pane: Pane) => {
    log.installs += 1;
    log.plots.push(plot);
    log.targets.push(pane);
    return {
      dispose() {
        log.disposes += 1;
      },
    };
  };

  return { log, install };
}

describe('usePlugin', () => {
  it('should throw outside <ChartContainer>', () => {
    function Naked() {
      usePlugin(() => ({ dispose() {} }), []);
      return null;
    }

    expect(() => render(<Naked />)).toThrow(/inside <ChartContainer>/);
  });

  it('should install once per mount and dispose symmetrically (StrictMode)', () => {
    const spy = pluginSpy();
    const plotRef = createRef<Plot>();

    function Consumer() {
      usePlugin(spy.install, []);
      return null;
    }

    const screen = render(
      <StrictMode>
        <ChartContainer deps={makeDeps()} data={data} plotRef={plotRef}>
          <Consumer />
        </ChartContainer>
      </StrictMode>,
    );

    // No matter how many round trips StrictMode makes, exactly one live install remains.
    expect(spy.log.installs - spy.log.disposes).toBe(1);
    expect(spy.log.targets.at(-1)).toBe(plotRef.current?.mainPane);

    screen.unmount();
    expect(spy.log.installs).toBe(spy.log.disposes);
  });

  it('should reinstall on deps change, not on unrelated re-render', async () => {
    const spy = pluginSpy();

    function Consumer({ period }: { period: number }) {
      usePlugin(spy.install, [period]);
      return null;
    }

    function Harness() {
      const [period, setPeriod] = useState(20);
      const [, setNoise] = useState(0);
      return (
        <ChartContainer deps={makeDeps()} data={data}>
          <button type="button" onClick={() => setNoise((n) => n + 1)}>
            noise
          </button>
          <button type="button" onClick={() => setPeriod(50)}>
            period
          </button>
          <Consumer period={period} />
        </ChartContainer>
      );
    }

    const screen = render(<Harness />);
    const settled = spy.log.installs;

    await act(async () => {
      screen.getByText('noise').click();
    });
    expect(spy.log.installs).toBe(settled); // an unrelated re-render is not a reinstall

    await act(async () => {
      screen.getByText('period').click();
    });
    expect(spy.log.installs).toBe(settled + 1);
    expect(spy.log.installs - spy.log.disposes).toBe(1);
  });

  it('should hand the surrounding <ChartPane> as the target pane', () => {
    const spy = pluginSpy();
    const plotRef = createRef<Plot>();

    function Consumer() {
      usePlugin(spy.install, []);
      return null;
    }

    render(
      <ChartContainer deps={makeDeps()} data={data} plotRef={plotRef}>
        <ChartPane />
        <ChartPane>
          <Consumer />
        </ChartPane>
      </ChartContainer>,
    );

    const target = spy.log.targets.at(-1);
    expect(target).toBeDefined();
    // The first <ChartPane> reuses mainPane, so the consumer inside the second one sees a different pane.
    expect(target).not.toBe(plotRef.current?.mainPane);
  });

  it('should move to the new target when the pane it is handed changes', async () => {
    const spy = pluginSpy();
    const plotRef = createRef<Plot>();

    function Consumer() {
      usePlugin(spy.install, []);
      return null;
    }

    // The pane context changes under a consumer that stays mounted.
    function Harness() {
      const [pane, setPane] = useState<Pane | null>(null);
      return (
        <ChartContainer deps={makeDeps()} data={data} plotRef={plotRef}>
          <button type="button" onClick={() => setPane(plotRef.current?.addPane() ?? null)}>
            move
          </button>
          <PaneProvider value={pane}>
            <Consumer />
          </PaneProvider>
        </ChartContainer>
      );
    }

    const screen = render(<Harness />);
    expect(spy.log.targets).toEqual([plotRef.current?.mainPane]);

    await act(async () => {
      screen.getByText('move').click();
    });

    expect(spy.log.targets).toHaveLength(2);
    expect(spy.log.targets[1]).toBe(plotRef.current?.panes[1]);
    expect(spy.log.installs - spy.log.disposes).toBe(1);
  });

  // Nulling the api on cleanup is only observable when the component
  // outlives its effect — React's <Activity> — so activity.test.tsx pins it.
  it('should return null before commit, the api after it, and unmount without throwing', async () => {
    const seen: Array<string> = [];

    function Consumer() {
      const api = usePlugin((plot) => plot.use(crosshair({ vertical: false })), []);
      seen.push(api ? 'api' : 'null');
      return null;
    }

    function Harness() {
      const [on, setOn] = useState(true);
      return (
        <ChartContainer deps={makeDeps()} data={data}>
          <button type="button" onClick={() => setOn(false)}>
            off
          </button>
          {on ? <Consumer /> : null}
        </ChartContainer>
      );
    }

    const screen = render(<Harness />);
    expect(seen.at(0)).toBe('null'); // it's null before commit
    expect(seen.at(-1)).toBe('api');

    await act(async () => {
      screen.getByText('off').click(); // unmount — dispose must not throw
    });
  });
});
