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
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  /**
   * **The one told about the api is the one told it's gone.** `onApi` is
   * read when the api is installed; a new callback on a later render takes
   * effect at the next install, so the original recipient is never left
   * holding a disposed api.
   */
  it('tells the recipient that got the api — not a newer callback — that it is gone', () => {
    const { install, installed } = installer();
    const first: (FakeApi | null)[] = [];
    const second: (FakeApi | null)[] = [];
    const deps = makeDeps();
    const view = (onApi: (api: FakeApi | null) => void, shown = true) => (
      <ChartContainer deps={deps} data={data}>
        {shown && <Plugin install={install} onApi={onApi} />}
      </ChartContainer>
    );
    const screen = render(view((api) => first.push(api)));
    screen.rerender(view((api) => second.push(api)));
    screen.rerender(view((api) => second.push(api), false));

    expect(first).toEqual([installed[0], null]);
    expect(second).toEqual([]);
  });

  /**
   * **A throwing `onApi` never orphans the plugin.** Thrown on the way in,
   * the api is disposed before the error leaves; thrown on the way out, it
   * is disposed all the same.
   */
  it('disposes the api when onApi throws — announcing it or letting go', () => {
    const { install, installed } = installer();
    const deps = makeDeps();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const kept: (FakeApi | null)[] = [];
      expect(() =>
        render(
          <ChartContainer deps={deps} data={data}>
            <Plugin
              install={install}
              onApi={(api) => {
                kept.push(api);
                if (api) throw new Error('refused');
              }}
            />
          </ChartContainer>,
        ),
      ).toThrow('refused');
      expect(installed.every((api) => api.disposed)).toBe(true);
      // It kept the api before throwing — it is told the api is gone.
      expect(kept.at(-1)).toBeNull();
      cleanup();

      const before = installed.length;
      const view = (shown: boolean) => (
        <ChartContainer deps={deps} data={data}>
          {shown && (
            <Plugin
              install={install}
              onApi={(api) => {
                if (api === null) throw new Error('on the way out');
              }}
            />
          )}
        </ChartContainer>
      );
      const screen = render(view(true));
      expect(() => screen.rerender(view(false))).toThrow('on the way out');
      expect(installed.slice(before).every((api) => api.disposed)).toBe(true);
    } finally {
      quiet.mockRestore();
    }
  });

  it('keeps the first error when disposing throws too — on the way in and on the way out', () => {
    const deps = makeDeps();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const brittle = () => ({
      dispose() {
        throw new Error('dispose failed');
      },
    });
    try {
      expect(() =>
        render(
          <ChartContainer deps={deps} data={data}>
            <Plugin
              install={brittle}
              onApi={(api) => {
                if (api) throw new Error('refused');
              }}
            />
          </ChartContainer>,
        ),
      ).toThrow('refused');
      cleanup();

      const view = (shown: boolean) => (
        <ChartContainer deps={deps} data={data}>
          {shown && (
            <Plugin
              install={brittle}
              onApi={(api) => {
                if (api === null) throw new Error('on the way out');
              }}
            />
          )}
        </ChartContainer>
      );
      const screen = render(view(true));
      expect(() => screen.rerender(view(false))).toThrow('on the way out');
    } finally {
      quiet.mockRestore();
    }
  });
});

