/**
 * `<Plugin>` — a plugin install as a child, its api handed up.
 *
 * Without it, lifting a plugin's api to the parent took a component of its
 * own: call `usePlugin` inside the container, then pass the result up from
 * an effect. Contracts: the parent hears the live api after commit and
 * `null` once it's gone (unmount, reinstall, StrictMode's round trip
 * never leaves a disposed api in hand), `deps` alone decides
 * reinstallation, and inside a `<ChartPane>` that pane is handed in.
 */
import type { LineDataPoint, Pane, Plot } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartPane, Plugin } from '../components';
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

interface FakeApi {
  readonly id: number;
  readonly pane: Pane;
  disposed: boolean;
  dispose(): void;
}

function installer() {
  let next = 0;
  const installed: FakeApi[] = [];
  const install = (_plot: Plot, pane: Pane): FakeApi => {
    const api: FakeApi = {
      id: next++,
      pane,
      disposed: false,
      dispose() {
        api.disposed = true;
      },
    };
    installed.push(api);
    return api;
  };
  return { install, installed };
}

describe('<Plugin>', () => {
  it('hands the live api up after commit and null on unmount — StrictMode included', () => {
    const { install } = installer();
    const heard: (FakeApi | null)[] = [];
    const deps = makeDeps();

    const view = (shown: boolean) => (
      <StrictMode>
        <ChartContainer deps={deps} data={data}>
          {shown && <Plugin install={install} onApi={(api) => heard.push(api)} />}
        </ChartContainer>
      </StrictMode>
    );
    const screen = render(view(true));

    const live = heard.at(-1);
    expect(live).not.toBeNull();
    expect(live?.disposed).toBe(false);

    screen.rerender(view(false));

    expect(heard.at(-1)).toBeNull();
    expect(live?.disposed).toBe(true);
  });

  it('reinstalls on deps, not on a new install or onApi closure', () => {
    const { install, installed } = installer();
    let api: FakeApi | null = null;
    const deps = makeDeps();

    const view = (period: number) => (
      <ChartContainer deps={deps} data={data}>
        <Plugin
          install={(plot, pane) => install(plot, pane)}
          deps={[period]}
          onApi={(next) => {
            api = next;
          }}
        />
      </ChartContainer>
    );
    const screen = render(view(14));
    const first = api;
    screen.rerender(view(14));

    expect(installed).toHaveLength(1);
    expect(api).toBe(first);

    act(() => screen.rerender(view(21)));

    expect(installed).toHaveLength(2);
    expect(installed[0].disposed).toBe(true);
    expect(api).toBe(installed[1]);
  });

  it('installs on the pane it sits in', () => {
    const { install } = installer();
    const heard: { api: FakeApi | null } = { api: null };
    const plotRef = createRef<Plot>();

    render(
      <ChartContainer deps={makeDeps()} data={data} plotRef={plotRef}>
        <ChartPane />
        <ChartPane>
          <Plugin
            install={install}
            onApi={(next) => {
              heard.api = next;
            }}
          />
        </ChartPane>
      </ChartContainer>,
    );

    const pane = heard.api?.pane;
    expect(pane).toBeDefined();
    // The first <ChartPane> is the main pane; this one sits in the second.
    expect(pane).toBe(plotRef.current?.panes[1]);
  });
});
