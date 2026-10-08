/**
 * Seeded sequences of the things that move panes — a pane inserted anywhere
 * in the JSX, one removed (shown or hidden), a Suspense boundary hiding or
 * showing one, the user's own `setPaneOrder`, a data tick — checked after
 * every step against the contract:
 *
 * - a pane arriving restacks to JSX order, with a hidden pane kept right
 *   after the pane it followed;
 * - a pane going, a hide or a tick moves no other pane;
 * - a reveal restacks only when the pane's JSX place among the shown panes
 *   moved while it was hidden;
 * - otherwise the user's order holds.
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef, Suspense, useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const KEYS = ['m', 'a', 'b', 'c', 'd', 'e', 'f'];
const series = KEYS.map(() => lineSeries());
const seriesOf = (key: string) => series[KEYS.indexOf(key)];
const keyOf = new Map<unknown, string>(KEYS.map((key, at) => [series[at], key]));
const points = (t: number): LineDataPoint[] => [{ x: 0, y: 1 + t }, { x: 1, y: 2 }];
const SEEDS = 40;
const STEPS = 25;

/** mulberry32 — small, seeded, the same on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shown panes in JSX order, each hidden one put back right after the one it followed. */
function keepHiddenInPlace(shown: string[], last: string[], hidden: ReadonlySet<string>): string[] {
  const out = [...shown];
  let at = 0;
  for (const key of last) {
    if (hidden.has(key)) {
      out.splice(at, 0, key);
      at += 1;
      continue;
    }
    const found = out.indexOf(key);
    if (found >= 0) at = found + 1;
  }
  return out;
}

interface Gate {
  promise: Promise<void> | null;
  resolve: () => void;
  poke: () => void;
}

for (let seed = 1; seed <= SEEDS; seed++) {
  it(`holds the pane order contract through seeded sequence ${seed}`, async () => {
    const next = random(seed);
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
    const gates = new Map<string, Gate>(KEYS.map((key) => [key, { promise: null, resolve: () => {}, poke: () => {} }]));
    const gateOf = (key: string): Gate => {
      const gate = gates.get(key);
      if (!gate) throw new Error(`no gate for ${key}`);
      return gate;
    };
    function Hold({ id }: { id: string }) {
      const [, setRound] = useState(0);
      const gate = gateOf(id);
      gate.poke = () => setRound((round) => round + 1);
      if (gate.promise) throw gate.promise;
      return null;
    }
    let setKeys = (_keys: string[]) => {};
    let tick = () => {};
    const ref = createRef<Plot>();
    function Host() {
      const [keys, setKeysState] = useState(['m', 'a', 'b']);
      const [t, setT] = useState(0);
      setKeys = setKeysState;
      tick = () => setT((value) => value + 1);
      return (
        <ChartContainer deps={browserDeps({ createLayers: layersSpy().createLayers })} data={points(t)} plotRef={ref}>
          {keys.map((key) => (
            <Suspense key={key} fallback={null}>
              <Hold id={key} />
              <ChartPane><ChartSeries series={seriesOf(key)} /></ChartPane>
            </Suspense>
          ))}
        </ChartContainer>
      );
    }
    render(<Host />);
    const plot = ref.current;
    if (!plot) throw new Error('plot is not mounted');
    const stack = () => plot.panes.map((pane) => keyOf.get(pane.getSeries()[0]) ?? 'empty');
    const show = async (key: string) => {
      const gate = gateOf(key);
      const pending = gate.promise;
      gate.promise = null;
      gate.resolve();
      await act(async () => {
        await pending;
      });
    };

    let jsx = ['m', 'a', 'b'];
    const hidden = new Set<string>();
    let reference = [...jsx];
    let expected = [...jsx];
    const steps: string[] = [];

    for (let step = 0; step < STEPS; step++) {
      const absent = KEYS.filter((key) => !jsx.includes(key));
      // The main pane's holder stays put, so the order alone is under test.
      const removable = jsx.filter((key) => key !== 'm');
      const hideable = removable.filter((key) => !hidden.has(key));
      const ops = ['tick', 'order'];
      if (absent.length > 0) ops.push('insert');
      if (removable.length > 0) ops.push('remove');
      if (hideable.length > 0) ops.push('hide');
      if (hidden.size > 0) ops.push('reveal');
      const op = pick(ops);

      if (op === 'insert') {
        const key = pick(absent);
        const at = 1 + Math.floor(next() * jsx.length);
        jsx = [...jsx.slice(0, at), key, ...jsx.slice(at)];
        steps.push(`insert ${key} at ${at}`);
        act(() => setKeys(jsx));
        reference = keepHiddenInPlace(jsx.filter((other) => !hidden.has(other)), reference, hidden);
        expected = [...reference];
      } else if (op === 'remove') {
        const key = pick(removable);
        const wasHidden = hidden.delete(key);
        steps.push(`remove ${key}${wasHidden ? ' while hidden' : ''}`);
        jsx = jsx.filter((other) => other !== key);
        act(() => setKeys(jsx));
        if (wasHidden) await show(key);
        reference = reference.filter((other) => other !== key);
        expected = expected.filter((other) => other !== key);
      } else if (op === 'hide') {
        const key = pick(hideable);
        steps.push(`hide ${key}`);
        hidden.add(key);
        const gate = gateOf(key);
        gate.promise = new Promise<void>((resolve) => {
          gate.resolve = resolve;
        });
        act(() => gate.poke());
      } else if (op === 'reveal') {
        const key = pick([...hidden]);
        steps.push(`reveal ${key}`);
        hidden.delete(key);
        await show(key);
        const placed = keepHiddenInPlace(jsx.filter((other) => !hidden.has(other)), reference, hidden);
        const shownOf = (order: string[]) => order.filter((other) => !hidden.has(other)).join(' ');
        if (shownOf(placed) !== shownOf(reference)) expected = [...placed];
        reference = placed;
      } else if (op === 'order') {
        const order = [...plot.panes];
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        steps.push('user order');
        act(() => plot.setPaneOrder(order));
        expected = stack();
      } else {
        steps.push('data tick');
        act(() => tick());
      }

      expect(stack(), steps.join(' → ')).toEqual(expected);
      expect(plot.panes.every((pane) => pane.getSeries().length === 1)).toBe(true);
    }
  });
}
