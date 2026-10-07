/**
 * Refused declarative data. The core checks a whole sync before applying any
 * of it, so a refusal leaves the previous data on the chart. With `onError`
 * the container reports it and keeps drawing that data — a live screen
 * survives one bad tick. Without it, the error goes to the nearest error
 * boundary, as before: a bug is never silent by default.
 */
import { ContractError, DataError, type LineDataPoint, type Plot } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { cleanup, render } from '@testing-library/react';
import { Component, createRef, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const sorted: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 15 }];
const unsorted: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 100, y: 15 }, { x: 50, y: 20 }];
const series = lineSeries();

class Boundary extends Component<{ children: ReactNode; caught: unknown[] }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    this.props.caught.push(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function quietly(run: () => void): void {
  const quiet = console.error;
  console.error = () => undefined;
  try {
    run();
  } finally {
    console.error = quiet;
  }
}

describe('<ChartContainer onError>', () => {
  it('reports refused data and keeps drawing what it had', () => {
    const deps = browserDeps({ createLayers: layersSpy().createLayers });
    const ref = createRef<Plot>();
    const errors: unknown[] = [];
    const ui = (data: LineDataPoint[]) => (
      <ChartContainer deps={deps} data={data} plotRef={ref} onError={(error) => void errors.push(error)}>
        <ChartSeries series={series} />
      </ChartContainer>
    );
    const view = render(ui(sorted));

    view.rerender(ui(unsorted));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(DataError);
    expect(ref.current?.mainPane.probe(100)[0]?.value).toBe(15);
    // The next good data lands as usual.
    view.rerender(ui([{ x: 0, y: 1 }, { x: 100, y: 2 }]));
    expect(ref.current?.mainPane.probe(100)[0]?.value).toBe(2);
  });

  it('reports to the handler of the latest render, not the first', () => {
    const deps = browserDeps({ createLayers: layersSpy().createLayers });
    const first: unknown[] = [];
    const second: unknown[] = [];
    const ui = (data: LineDataPoint[], onError: (error: DataError) => void) => (
      <ChartContainer deps={deps} data={data} onError={onError}>
        <ChartSeries series={series} />
      </ChartContainer>
    );
    const view = render(ui(sorted, (error) => void first.push(error)));

    view.rerender(ui(unsorted, (error) => void second.push(error)));

    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
    expect(second[0]).toBeInstanceOf(DataError);
  });

  it('still throws a ContractError to the boundary — a mistake in the code is not bad data', () => {
    const deps = browserDeps({ createLayers: layersSpy().createLayers });
    const caught: unknown[] = [];
    const errors: unknown[] = [];
    // Not a series — the call itself is wrong, whatever the data.
    const notASeries: typeof series = JSON.parse('{"draw": 1}');
    const ui = (drawn: typeof series) => (
      <Boundary caught={caught}>
        <ChartContainer deps={deps} data={sorted} onError={(error) => void errors.push(error)}>
          <ChartSeries series={drawn} />
        </ChartContainer>
      </Boundary>
    );
    const view = render(ui(series));

    quietly(() => view.rerender(ui(notASeries)));

    expect(errors).toEqual([]);
    expect(caught[0]).toBeInstanceOf(ContractError);
  });

  it('without onError, throws to the nearest error boundary as before', () => {
    const deps = browserDeps({ createLayers: layersSpy().createLayers });
    const caught: unknown[] = [];
    const ui = (data: LineDataPoint[]) => (
      <Boundary caught={caught}>
        <ChartContainer deps={deps} data={data}>
          <ChartSeries series={series} />
        </ChartContainer>
      </Boundary>
    );
    const view = render(ui(sorted));

    quietly(() => view.rerender(ui(unsorted)));

    expect(caught[0]).toBeInstanceOf(DataError);
  });
});
