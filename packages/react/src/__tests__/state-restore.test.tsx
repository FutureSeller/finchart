/**
 * `<ChartContainer state>` restores a pane when it attaches. A pane that was
 * already there keeps what the user did to it since — toggling another pane
 * must not replay the saved layout over a divider drag.
 */
import type { ChartState, LineDataPoint, Plot } from '@finchart/core';
import { lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [{ x: 0, y: 10 }, { x: 50, y: 20 }, { x: 100, y: 15 }];
const price = lineSeries();
const rsi = lineSeries();
const saved: Partial<ChartState> = {
  panes: [{ stateKey: 'price', flex: 3, autoScale: true }, { stateKey: 'rsi', flex: 2, autoScale: true }],
};

it('restores a pane when it attaches, and leaves panes already there as the user left them', () => {
  const deps = browserDeps({ createLayers: layersSpy().createLayers });
  const ref = createRef<Plot>();
  const ui = (withRsi: boolean) => (
    <ChartContainer deps={deps} data={data} plotRef={ref} state={saved}>
      <ChartPane stateKey="price">
        <ChartSeries series={price} />
      </ChartPane>
      {withRsi ? (
        <ChartPane stateKey="rsi">
          <ChartSeries series={rsi} />
        </ChartPane>
      ) : null}
    </ChartContainer>
  );
  const view = render(ui(false));
  const flexes = () => ref.current?.panes.map((pane) => pane.flex);
  expect(flexes()).toEqual([3]);

  // A divider drag, then an indicator toggled on.
  act(() => ref.current?.mainPane.applyOptions({ flex: 5 }));
  act(() => view.rerender(ui(true)));

  expect(flexes()).toEqual([5, 2]);
});
