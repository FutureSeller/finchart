/**
 * `usePluginState` — does a snapshot+subscription cross over into React
 * state?
 *
 * Contract: falls back when there's no api, re-reads on a notification, and
 * swaps the subscription when the api changes (a focus switch).
 */
import { act, cleanup, render } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { usePluginState } from '../hooks';

afterEach(cleanup);

/** A fake plugin with a snapshot+subscription pair — the same shape as drawingTools' mode(). */
function fakeApi(initial: string) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    read: () => value,
    set(next: string) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(onChange: () => void) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    listenerCount: () => listeners.size,
  };
}
type FakeApi = ReturnType<typeof fakeApi>;

const subscribeFake = (api: FakeApi, onChange: () => void) =>
  api.subscribe(onChange);
const readFake = (api: FakeApi) => api.read();

function Probe({
  api,
  seen,
}: {
  api: FakeApi | null;
  seen: string[];
}) {
  const value = usePluginState(api, subscribeFake, readFake, '(none)');
  seen.push(value);
  return null;
}

describe('usePluginState', () => {
  it('should fall back without an api and follow notifications with one', async () => {
    const seen: string[] = [];
    const api = fakeApi('cursor');

    function Harness() {
      const [current, setCurrent] = useState<FakeApi | null>(null);
      return (
        <>
          <button type="button" onClick={() => setCurrent(api)}>
            attach
          </button>
          <Probe api={current} seen={seen} />
        </>
      );
    }

    const screen = render(<Harness />);
    expect(seen.at(-1)).toBe('(none)');

    await act(async () => {
      screen.getByText('attach').click();
    });
    expect(seen.at(-1)).toBe('cursor');

    await act(async () => {
      api.set('trend');
    });
    expect(seen.at(-1)).toBe('trend');
  });

  it('should swap subscriptions when the api changes (focus switch)', async () => {
    const seen: string[] = [];
    const first = fakeApi('first');
    const second = fakeApi('second');

    function Harness() {
      const [current, setCurrent] = useState<FakeApi>(first);
      return (
        <>
          <button type="button" onClick={() => setCurrent(second)}>
            focus
          </button>
          <Probe api={current} seen={seen} />
        </>
      );
    }

    const screen = render(<Harness />);
    expect(seen.at(-1)).toBe('first');

    await act(async () => {
      screen.getByText('focus').click();
    });
    expect(seen.at(-1)).toBe('second');
    expect(first.listenerCount()).toBe(0); // the old subscription was released

    await act(async () => {
      first.set('stale'); // a notification from the departed api is no longer this hook's business
    });
    expect(seen.at(-1)).toBe('second');
  });

  it("should keep the first render's fallback once the api comes and goes", () => {
    const seen: string[] = [];
    const api = fakeApi('live');

    function Fallback({ current, fallback }: { current: FakeApi | null; fallback: string }) {
      seen.push(usePluginState(current, subscribeFake, readFake, fallback));
      return null;
    }

    const screen = render(<Fallback current={null} fallback="first" />);
    screen.rerender(<Fallback current={api} fallback="second" />);
    expect(seen.at(-1)).toBe('live');

    screen.rerender(<Fallback current={null} fallback="third" />);
    expect(seen.at(-1)).toBe('first');
  });

  /**
   * **Server rendering must also work outside `<ChartContainer>`.**
   *
   * Called on the server without a `getServerSnapshot`,
   * `useSyncExternalStore` **throws** *"Missing getServerSnapshot, which is
   * required for server-rendered content."* The reason this went uncaught
   * even though the README advertises an SSR path is that every test in
   * this file renders on the client.
   *
   * And using it only from **inside** the container accidentally masks the
   * bug — with a `null` api, the child just doesn't render on the server.
   * The moment something calls it from outside — like a toolbar that lifts
   * tool mode up to a parent — server rendering dies entirely. So this
   * pins down the outside-the-container shape.
   */
  it('should render on the server when used outside the container', () => {
    function Toolbar() {
      const mode = usePluginState<FakeApi, string>(
        null,
        subscribeFake,
        readFake,
        '(none)',
      );
      return <span>{mode}</span>;
    }

    expect(() => renderToString(<Toolbar />)).not.toThrow();
    expect(renderToString(<Toolbar />)).toContain('(none)');
  });
});
