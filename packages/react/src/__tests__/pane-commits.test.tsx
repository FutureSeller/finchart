/**
 * A data tick is the hot path: a live chart re-renders its container many
 * times a second. Panes declared to it must not cost that tick a second
 * commit — the pane set and its order did not move, so there is nothing to
 * settle again.
 */
import type { LineDataPoint, Scale } from '@finchart/core';
import { LinearScale, lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { Profiler, type ReactNode, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const points = (k: number): LineDataPoint[] => [{ x: 0, y: 10 + k }, { x: 50, y: 20 + k }, { x: 100, y: 15 + k }];
const TICKS = 5;

/** Commits per tick of whatever `tick` updates. */
function commitsPerTick(ui: (k: number) => ReactNode, own?: { tick: () => void }) {
  let commits = 0;
  let tick = () => {};
  function Host() {
    const [k, setK] = useState(0);
    tick = () => setK((value) => value + 1);
    return <Profiler id="chart" onRender={() => void commits++}>{ui(k)}</Profiler>;
  }
  render(<Host />);
  commits = 0;
  for (let i = 0; i < TICKS; i++) act(() => (own ?? { tick }).tick());
  return commits / TICKS;
}

describe('one commit per container data tick', () => {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const series = [lineSeries(), lineSeries(), lineSeries()];

  it('with no pane at all', () => {
    expect(commitsPerTick((k) => (
      <ChartContainer deps={deps} data={points(k)}><ChartSeries series={series[0]} /></ChartContainer>
    ))).toBe(1);
  });

  for (const count of [1, 3]) {
    it(`with ${count} pane(s)`, () => {
      expect(commitsPerTick((k) => (
        <ChartContainer deps={deps} data={points(k)}>
          {series.slice(0, count).map((s, at) => (
            <ChartPane key={at} valueDomain={at === 2 ? [0, 100] : undefined}><ChartSeries series={s} /></ChartPane>
          ))}
        </ChartContainer>
      ))).toBe(1);
    });

    it(`with ${count} pane(s) given an inline yScale arrow`, () => {
      expect(commitsPerTick((k) => (
        <ChartContainer deps={deps} data={points(k)}>
          {series.slice(0, count).map((s, at) => (
            <ChartPane key={at} yScale={(): Scale => new LinearScale()}><ChartSeries series={s} /></ChartPane>
          ))}
        </ChartContainer>
      ))).toBe(1);
    });
  }

  it('when only a pane’s own parent ticks', () => {
    const own = { tick: () => {} };
    function Live() {
      const [k, setK] = useState(0);
      own.tick = () => setK((value) => value + 1);
      return <ChartPane flex={1}><ChartSeries series={series[1]} data={points(k)} /></ChartPane>;
    }
    expect(commitsPerTick(() => (
      <ChartContainer deps={deps} data={points(0)}>
        <ChartPane><ChartSeries series={series[0]} /></ChartPane>
        <Live />
      </ChartContainer>
    ), own)).toBe(1);
  });
});

/**
 * A pane the container inserts commits once with it built and placed, and
 * once more with its children — the series need the pane to register on.
 * Nothing waits a further round when no pane is on its way out.
 */
it('takes two commits for a pane the container inserts', () => {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const series = [lineSeries(), lineSeries(), lineSeries()];
  let commits = 0;
  let insert = () => {};
  function Host() {
    const [all, setAll] = useState(false);
    insert = () => setAll(true);
    return (
      <Profiler id="chart" onRender={() => void commits++}>
        <ChartContainer deps={deps} data={points(0)}>
          <ChartPane><ChartSeries series={series[0]} /></ChartPane>
          {all && <ChartPane><ChartSeries series={series[1]} /></ChartPane>}
          <ChartPane><ChartSeries series={series[2]} /></ChartPane>
        </ChartContainer>
      </Profiler>
    );
  }
  render(<Host />);
  commits = 0;

  act(() => insert());

  expect(commits).toBe(2);
});

/**
 * A pane going takes one commit: its passive cleanup takes it off, and
 * nothing else moves. (One going from the middle renumbers the JSX places
 * below it, which reads as a move and costs a settle of its own.)
 */
it('takes one commit for the last pane the container removes', () => {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const series = [lineSeries(), lineSeries(), lineSeries()];
  let commits = 0;
  let remove = () => {};
  function Host() {
    const [all, setAll] = useState(true);
    remove = () => setAll(false);
    return (
      <Profiler id="chart" onRender={() => void commits++}>
        <ChartContainer deps={deps} data={points(0)}>
          <ChartPane><ChartSeries series={series[0]} /></ChartPane>
          <ChartPane><ChartSeries series={series[1]} /></ChartPane>
          {all && <ChartPane><ChartSeries series={series[2]} /></ChartPane>}
        </ChartContainer>
      </Profiler>
    );
  }
  render(<Host />);
  commits = 0;

  act(() => remove());

  expect(commits).toBe(1);
});
