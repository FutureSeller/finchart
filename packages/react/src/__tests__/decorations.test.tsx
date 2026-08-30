/**
 * **An inline decoration must not reinstall on every render.**
 *
 * If a props object that JSX freshly allocates on every render is used as a
 * dep, then no matter what the consumer does, every render runs
 * `remove()` + `addDecoration()` + `requestRender()` twice — for a single
 * `<PriceLine price={last} />` that means once per tick, 60 times a second.
 *
 * The consumer side has no handle to hold stable (what needs stabilizing is
 * the props object JSX creates, not a consumer-owned object), so this test
 * suite **writes everything inline** — since comparing by value is the
 * component's contract, undisciplined usage is exactly what's under test.
 */
import type { Plot } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartContainer, Markers, PriceLine } from '../components';
import type { LineDataPoint } from '@finchart/core';
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

/** Counts how many times `addDecoration` was called on the mounted stage. */
function counting() {
  const box = { installs: 0 };
  const onPlot = (plot: Plot | null) => {
    if (!plot) return;
    const pane = plot.mainPane;
    const original = pane.addDecoration.bind(pane);
    vi.spyOn(pane, 'addDecoration').mockImplementation((decoration) => {
      box.installs += 1;
      return original(decoration);
    });
  };
  return { box, onPlot };
}

describe('decorations — do not reinstall when the value is unchanged', () => {
  it('should not reinstall a price line across re-renders', async () => {
    const { box, onPlot } = counting();

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick(tick + 1)}>
            tick
          </button>
          <ChartContainer deps={makeDeps()} data={data} onPlot={onPlot}>
            {/* Inline — not requiring discipline from the consumer is the contract. */}
            <PriceLine value={110} label="target" />
          </ChartContainer>
        </>
      );
    }

    const screen = render(<Harness />);
    const afterMount = box.installs;
    expect(afterMount).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        screen.getByText('tick').click();
      });
    }

    // The value didn't change, so it must not install even once more.
    expect(box.installs).toBe(afterMount);
  });

  it('should reinstall when a value actually changes', async () => {
    const { box, onPlot } = counting();

    function Harness() {
      const [value, setValue] = useState(110);
      return (
        <>
          <button type="button" onClick={() => setValue(value + 1)}>
            raise
          </button>
          <ChartContainer deps={makeDeps()} data={data} onPlot={onPlot}>
            <PriceLine value={value} label="target" />
          </ChartContainer>
        </>
      );
    }

    const screen = render(<Harness />);
    const afterMount = box.installs;

    await act(async () => {
      screen.getByText('raise').click();
    });

    // If the value changes it reinstalls — what's drawn has to change too.
    expect(box.installs).toBeGreaterThan(afterMount);
  });

  it('should not reinstall markers whose items are element-stable', async () => {
    const { box, onPlot } = counting();
    const item = { x: 10, price: 110, text: 'buy' } as const;

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick(tick + 1)}>
            tick
          </button>
          <ChartContainer deps={makeDeps()} data={data} onPlot={onPlot}>
            {/* The array literal is new on every render, but element identity stays. */}
            <Markers items={[item]} />
          </ChartContainer>
        </>
      );
    }

    const screen = render(<Harness />);
    const afterMount = box.installs;

    await act(async () => {
      screen.getByText('tick').click();
    });

    expect(box.installs).toBe(afterMount);
  });

  /**
   * **Nested options are values too.**
   *
   * The tests above only ever passed `value` and `label`, so every value was
   * a primitive — and that let `useStable`'s header comment's premise
   * (*"decoration options are all primitive fields"*) stay **false without
   * anyone noticing** — `PriceLineOptions.style` is `Partial<LineStyle>`.
   * With that premise still false, the symptom this component claimed to
   * have fixed was still there in the single most common usage: measured
   * installs went 1 → 6 (5 re-renders).
   */
  it('should not reinstall a price line whose style is inline', async () => {
    const { box, onPlot } = counting();

    function Harness() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick(tick + 1)}>
            tick
          </button>
          <ChartContainer deps={makeDeps()} data={data} onPlot={onPlot}>
            {/* A nested object is inline too — equal values must not move it. */}
            <PriceLine value={110} style={{ color: 'red', width: 2 }} />
          </ChartContainer>
        </>
      );
    }

    const screen = render(<Harness />);
    const afterMount = box.installs;
    expect(afterMount).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        screen.getByText('tick').click();
      });
    }

    expect(box.installs).toBe(afterMount);
  });

  /** Reinstalls when a value inside actually changes — shows the assertion above isn't a freebie. */
  it('should reinstall when a nested style value changes', async () => {
    const { box, onPlot } = counting();

    function Harness() {
      const [width, setWidth] = useState(1);
      return (
        <>
          <button type="button" onClick={() => setWidth(width + 1)}>
            thicken
          </button>
          <ChartContainer deps={makeDeps()} data={data} onPlot={onPlot}>
            <PriceLine value={110} style={{ color: 'red', width }} />
          </ChartContainer>
        </>
      );
    }

    const screen = render(<Harness />);
    const afterMount = box.installs;

    await act(async () => {
      screen.getByText('thicken').click();
    });

    expect(box.installs).toBeGreaterThan(afterMount);
  });
});
