/**
 * **An inline decoration must not ask for a frame on every render.**
 *
 * If a props object that JSX freshly allocates on every render is used as a
 * dep, then no matter what the consumer does, every render hands the
 * decoration its options again and asks for a frame — for a single
 * `<PriceLine value={last} />` that means once per tick, 60 times a second.
 * The frame request is what these tests count: it is the cost a consumer
 * pays, and it follows every options handoff.
 *
 * The consumer side has no handle to hold stable (what needs stabilizing is
 * the props object JSX creates, not a consumer-owned object), so this test
 * suite **writes everything inline** — since comparing by value is the
 * component's contract, undisciplined usage is exactly what's under test.
 */
import type { Pane, Plot } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { ChartContainer, ChartSeries, Markers, PriceLine } from '../components';
import { PaneProvider } from '../components/chart-context';
import type { LineDataPoint } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { layersSpy } from './fake-layers';
import { rendererSpy } from './recording-renderer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

/**
 * Counts the stage's frame requests. A decoration handed new options asks
 * for a frame, so an equal-value re-render must add none.
 */
function frameRequests() {
  const box = { requests: 0 };
  const onPlot = (plot: Plot | null) => {
    if (!plot) return;
    const original = plot.requestRender.bind(plot);
    vi.spyOn(plot, 'requestRender').mockImplementation(() => {
      box.requests += 1;
      original();
    });
  };
  return { box, onPlot };
}

describe('decorations — equal values leave the decoration untouched', () => {
  it('should not ask for a frame when an inline price line re-renders with equal values', async () => {
    const { box, onPlot } = frameRequests();

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
    const afterMount = box.requests;
    expect(afterMount).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        screen.getByText('tick').click();
      });
    }

    // The value didn't change, so nothing is handed on and no frame is asked for.
    expect(box.requests).toBe(afterMount);
  });

  it('should apply a changed value in place — no reinstall, and the drawn line moves', async () => {
    const { box, onPlot } = counting();
    const renderer = rendererSpy();
    const deps = browserDeps({
      createLayers: layersSpy().createLayers,
      createRenderer: renderer.createRenderer,
      createAxisLabels: () => ({ render: () => undefined, clear: () => undefined, destroy: () => undefined }),
    });
    const ref = createRef<Plot>();
    function Harness() {
      const [value, setValue] = useState(110);
      return (
        <>
          <button type="button" onClick={() => setValue(value + 5)}>
            raise
          </button>
          <ChartContainer deps={deps} data={data} plotRef={ref} onPlot={onPlot} showGrid={false}>
            <ChartSeries series={lineSeries()} />
            <PriceLine value={value} label="target" />
          </ChartContainer>
        </>
      );
    }
    const plot = () => {
      if (!ref.current) throw new Error('plot is not mounted');
      return ref.current;
    };
    const screen = render(<Harness />);
    const afterMount = box.installs;
    const lineYs = () => {
      act(() => plot().render());
      return renderer.committed
        .filter((c) => c.type === 'drawLine')
        .map((c) => (c.type === 'drawLine' ? c.points[0]?.y : null));
    };
    const yOf = (value: number) => plot().mainPane.yScale.scale(value);
    expect(lineYs()).toContain(yOf(110));
    await act(async () => {
      screen.getByText('raise').click();
    });
    // The value changed — what is drawn changes, the decoration does not remount.
    expect(box.installs).toBe(afterMount);
    expect(lineYs()).toContain(yOf(115));
  });

  it('should not ask for a frame when markers re-render with element-stable items', async () => {
    const { box, onPlot } = frameRequests();
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
    const afterMount = box.requests;
    expect(afterMount).toBeGreaterThan(0);

    await act(async () => {
      screen.getByText('tick').click();
    });

    expect(box.requests).toBe(afterMount);
  });

  /**
   * **Nested options are values too.**
   *
   * The tests above only ever passed `value` and `label`, so every value was
   * a primitive — and that let `useStable`'s header comment's premise
   * (*"decoration options are all primitive fields"*) stay **false without
   * anyone noticing** — `PriceLineOptions.style` is `Partial<LineStyle>`.
   * With that premise still false, the symptom this component claimed to
   * have fixed was still there in the single most common usage: every
   * re-render handed the line its options again and asked for a frame.
   */
  it('should not ask for a frame when a price line with an inline style re-renders with equal values', async () => {
    const { box, onPlot } = frameRequests();

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
    const afterMount = box.requests;
    expect(afterMount).toBeGreaterThan(0);

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        screen.getByText('tick').click();
      });
    }

    expect(box.requests).toBe(afterMount);
  });

  /** A value inside actually changes and the drawn line shows it — the assertion above isn't a freebie. */
  it('should apply a nested style change in place, without reinstalling', async () => {
    const { box, onPlot } = counting();
    const renderer = rendererSpy();
    const deps = browserDeps({
      createLayers: layersSpy().createLayers,
      createRenderer: renderer.createRenderer,
      createAxisLabels: () => ({ render: () => undefined, clear: () => undefined, destroy: () => undefined }),
    });
    const ref = createRef<Plot>();

    function Harness() {
      const [width, setWidth] = useState(1);
      return (
        <>
          <button type="button" onClick={() => setWidth(width + 1)}>
            thicken
          </button>
          <ChartContainer deps={deps} data={data} plotRef={ref} onPlot={onPlot} showGrid={false}>
            <ChartSeries series={lineSeries()} />
            <PriceLine value={110} style={{ color: 'red', width }} />
          </ChartContainer>
        </>
      );
    }
    const plot = () => {
      if (!ref.current) throw new Error('plot is not mounted');
      return ref.current;
    };
    const redWidths = () => {
      act(() => plot().render());
      return renderer.committed
        .filter((c) => c.type === 'drawLine' && c.style.color === 'red')
        .map((c) => (c.type === 'drawLine' ? c.style.width : null));
    };

    const screen = render(<Harness />);
    const afterMount = box.installs;
    expect(redWidths()).toEqual([1]);
    // The frame is the decoration's to ask for — nobody else knows its options moved.
    const asked = vi.spyOn(plot(), 'requestRender');

    await act(async () => {
      screen.getByText('thicken').click();
    });

    expect(box.installs).toBe(afterMount);
    expect(asked).toHaveBeenCalled();
    expect(redWidths()).toEqual([2]);
  });
});

describe('decorations — one live registration per mounted component', () => {
  function accounting() {
    const box = { installs: 0, removes: 0 };
    const onPlot = (plot: Plot | null) => {
      if (!plot) return;
      const pane = plot.mainPane;
      const original = pane.addDecoration.bind(pane);
      vi.spyOn(pane, 'addDecoration').mockImplementation((decoration, options) => {
        box.installs += 1;
        const remove = original(decoration, options);
        return () => {
          box.removes += 1;
          remove();
        };
      });
    };
    return { box, onPlot };
  }

  /** The axis labels are a DOM concern in the browser; here a stub keeps the badges the frame handed it. */
  function badgeRecorder() {
    const seen: { badges: string[] } = { badges: [] };
    const deps = browserDeps({
      createLayers: layersSpy().createLayers,
      createAxisLabels: () => ({
        render: (input) => {
          seen.badges = input.badges.map((badge) => badge.label);
        },
        clear: () => undefined,
        destroy: () => undefined,
      }),
    });
    return { deps, seen };
  }

  it('a removed label leaves the badge — props are a snapshot, not a patch', async () => {
    const { deps, seen } = badgeRecorder();
    const ref = createRef<Plot>();
    // The second render has no `label` key at all — the difference between a snapshot and a patch.
    const ui = (label?: string) => (
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartSeries series={lineSeries()} />
        {label === undefined ? <PriceLine value={110} /> : <PriceLine value={110} label={label} />}
      </ChartContainer>
    );
    const view = render(ui('Target'));
    const texts = () => {
      act(() => ref.current?.render());
      return seen.badges;
    };
    expect(texts()).toContain('Target');
    view.rerender(ui(undefined));
    expect(texts()).not.toContain('Target');
  });

  it('an inline format reaches the badge without reinstalling', async () => {
    const { box, onPlot } = accounting();
    const { deps, seen } = badgeRecorder();
    const ref = createRef<Plot>();
    const ui = (suffix: string) => (
      <ChartContainer deps={deps} data={data} plotRef={ref} onPlot={onPlot}>
        <ChartSeries series={lineSeries()} />
        <PriceLine value={110} format={(v) => `${v}${suffix}`} />
      </ChartContainer>
    );
    const view = render(ui('a'));
    const installs = box.installs;
    const texts = () => {
      act(() => ref.current?.render());
      return seen.badges;
    };
    expect(texts()).toContain('110a');
    view.rerender(ui('b'));
    expect(texts()).toContain('110b');
    expect(box.installs).toBe(installs);
  });

  it('a key change is a new registration, the old one released', () => {
    const { box, onPlot } = accounting();
    const ui = (key: string) => (
      <ChartContainer deps={makeDeps()} data={data} onPlot={onPlot}>
        <PriceLine key={key} value={110} />
      </ChartContainer>
    );
    const view = render(ui('a'));
    expect(box.installs - box.removes).toBe(1);
    view.rerender(ui('b'));
    expect(box.installs).toBe(2);
    expect(box.installs - box.removes).toBe(1);
  });

  it('under StrictMode, installs minus removes is one per component — two for the pair', () => {
    const { box, onPlot } = accounting();
    render(
      <StrictMode>
        <ChartContainer deps={makeDeps()} data={data} onPlot={onPlot}>
          <PriceLine value={110} />
          <Markers items={[{ x: 10, price: 110 }]} />
        </ChartContainer>
      </StrictMode>,
    );
    expect(box.installs - box.removes).toBe(2);
  });

  it('markers whose items change are re-set in place, not reinstalled — and the new dot is drawn', async () => {
    const { box, onPlot } = accounting();
    const renderer = rendererSpy();
    const deps = browserDeps({
      createLayers: layersSpy().createLayers,
      createRenderer: renderer.createRenderer,
      createAxisLabels: () => ({ render: () => undefined, clear: () => undefined, destroy: () => undefined }),
    });
    const ref = createRef<Plot>();
    const INK = '#123456';
    const ui = (items: { x: number; price: number; color: string }[]) => (
      <ChartContainer deps={deps} data={data} plotRef={ref} onPlot={onPlot}>
        <ChartSeries series={lineSeries()} />
        <Markers items={items} />
      </ChartContainer>
    );
    const dots = () => {
      act(() => ref.current?.render());
      return renderer.committed.filter(
        (c) => c.type === 'drawShape' && c.shape.shape === 'circle' && c.shape.fill === INK,
      ).length;
    };
    const view = render(ui([{ x: 10, price: 110, color: INK }]));
    const installs = box.installs;
    expect(dots()).toBe(1);
    if (!ref.current) throw new Error('plot is not mounted');
    const asked = vi.spyOn(ref.current, 'requestRender');
    view.rerender(
      ui([
        { x: 10, price: 110, color: INK },
        { x: 50, price: 112, color: INK },
      ]),
    );
    expect(box.installs).toBe(installs);
    expect(asked).toHaveBeenCalled();
    expect(dots()).toBe(2);
  });

  it('a surviving component follows its pane context — off the old target, onto the new, with its latest props', async () => {
    const { box, onPlot } = accounting();
    const renderer = rendererSpy();
    const seen: { badges: string[] } = { badges: [] };
    const deps = browserDeps({
      createLayers: layersSpy().createLayers,
      createRenderer: renderer.createRenderer,
      createAxisLabels: () => ({
        render: (input) => {
          seen.badges = input.badges.map((badge) => badge.label);
        },
        clear: () => undefined,
        destroy: () => undefined,
      }),
    });
    const ref = createRef<Plot>();
    const INK = '#123456';
    const plot = () => {
      if (!ref.current) throw new Error('plot is not mounted');
      return ref.current;
    };
    /** A new pane with its own series (so its axis covers the values), its registrations counted. */
    function newTarget() {
      const added = plot().addPane();
      added.addSeries({ series: lineSeries(), data });
      const counts = { installs: 0, removes: 0 };
      const original = added.addDecoration.bind(added);
      vi.spyOn(added, 'addDecoration').mockImplementation((decoration, options) => {
        counts.installs += 1;
        const remove = original(decoration, options);
        return () => {
          counts.removes += 1;
          remove();
        };
      });
      return { pane: added, counts };
    }
    const targets: { pane: Pane; counts: { installs: number; removes: number } }[] = [];
    function Harness() {
      const [pane, setPane] = useState<Pane | null>(null);
      const [value, setValue] = useState(110);
      const move = () => {
        const target = newTarget();
        targets.push(target);
        setPane(target.pane);
      };
      return (
        <>
          <button type="button" onClick={move}>
            move
          </button>
          <button type="button" onClick={() => setValue((v) => v + 1)}>
            nudge
          </button>
          <button
            type="button"
            onClick={() => {
              move();
              setValue(120);
            }}
          >
            move and raise
          </button>
          <ChartContainer deps={deps} data={data} plotRef={ref} onPlot={onPlot} showGrid={false}>
            <ChartSeries series={lineSeries()} />
            <PaneProvider value={pane}>
              <PriceLine value={value} label={`v${value}`} />
              <Markers items={[{ x: 50, price: value, color: INK }]} />
            </PaneProvider>
          </ChartContainer>
        </>
      );
    }
    const drawn = (pane: Pane) => {
      act(() => plot().render());
      const inside = (y: number) => y >= pane.area.top && y <= pane.area.bottom;
      return {
        badges: seen.badges,
        dots: renderer.committed.filter(
          (c) => c.type === 'drawShape' && c.shape.shape === 'circle' && c.shape.fill === INK && inside(c.shape.cy),
        ).length,
      };
    };

    const screen = render(<Harness />);
    expect(box.installs).toBe(2);

    // A prop update in place, then a pane-only switch: the reinstall must carry the updated props,
    // and no update effect runs to repair a stale one.
    await act(async () => {
      screen.getByText('nudge').click();
    });
    await act(async () => {
      screen.getByText('move').click();
    });
    const [first] = targets;
    if (!first) throw new Error('no target pane');
    expect(box.removes).toBe(2);
    expect(first.counts).toEqual({ installs: 2, removes: 0 });
    expect(drawn(first.pane).badges).toContain('v111');
    expect(drawn(first.pane).dots).toBe(1);

    // A later change moves in place on the new target — no reinstall anywhere.
    await act(async () => {
      screen.getByText('nudge').click();
    });
    expect(first.counts.installs).toBe(2);
    expect(box.installs).toBe(2);
    expect(drawn(first.pane).badges).toContain('v112');

    // A pane switch and a prop change in one commit — one reinstall, carrying the new value.
    await act(async () => {
      screen.getByText('move and raise').click();
    });
    const second = targets[1];
    if (!second) throw new Error('no second target pane');
    expect(first.counts).toEqual({ installs: 2, removes: 2 });
    expect(second.counts).toEqual({ installs: 2, removes: 0 });
    expect(drawn(second.pane).badges).toContain('v120');
    expect(drawn(second.pane).badges).not.toContain('v112');
  });
});
