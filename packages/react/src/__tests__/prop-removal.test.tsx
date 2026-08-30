/**
 * **There is exactly one rule for prop removal — revert to the default.**
 *
 * The rule used to be split four ways (inherit / retain / revert /
 * imperative), with zero tests measuring it, and the only discipline was a
 * comment on the single `gridStyle` prop. The ruling: **removing an option
 * prop means "back to the default now"** — since core's vocabulary treats
 * "undefined" as "nothing given," reverting means the wrapper has to supply
 * the explicit value itself (core exports the defaults as one package,
 * `PANE_OPTION_DEFAULTS` — copying the numbers would leave only the wrapper
 * to go stale). `data`, `series`, `width`, and `height` aren't options —
 * they're **imperative statements and measurements** — so they fall outside
 * this rule.
 */
import type { LineDataPoint, Plot } from '@finchart/core';
import { PANE_OPTION_DEFAULTS, lineSeries } from '@finchart/core';
import { browserDeps } from '@finchart/dom';
import { cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartContainer, ChartPane, ChartSeries } from '../components';
import { layersSpy } from './fake-layers';

afterEach(cleanup);

const data: LineDataPoint[] = [
  { x: 0, y: 10 },
  { x: 50, y: 20 },
  { x: 100, y: 15 },
];

function setup() {
  const spy = layersSpy();
  const deps = browserDeps({
    createLayers: spy.createLayers,
    createAxisLabels: () => ({
      render: () => undefined,
      clear: () => undefined,
      destroy: () => undefined,
    }),
  });
  const ref = createRef<Plot>();
  const plot = () => {
    if (!ref.current) throw new Error('plot is not mounted');
    return ref.current;
  };
  return { deps, ref, plot };
}

describe('prop removal = revert to default', () => {
  it('a rerender without paneGap reverts the gap to 0 (core neutral value)', () => {
    const { deps, ref, plot } = setup();
    const panes = (
      <>
        <ChartPane>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
        <ChartPane>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </>
    );
    const view = render(
      <ChartContainer deps={deps} data={data} plotRef={ref} paneGap={12}>
        {panes}
      </ChartContainer>,
    );
    const gapOf = () =>
      plot().panes[1].area.top - plot().panes[0].area.bottom;
    plot().render();
    expect(gapOf()).toBe(12);

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        {panes}
      </ChartContainer>,
    );
    plot().render();

    expect(gapOf()).toBe(0);
  });

  it('removing ChartPane flex reverts to the core default', () => {
    const { deps, ref, plot } = setup();
    const view = render(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane flex={3}>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>,
    );
    expect(plot().panes[0].flex).toBe(3);

    view.rerender(
      <ChartContainer deps={deps} data={data} plotRef={ref}>
        <ChartPane>
          <ChartSeries series={lineSeries()} />
        </ChartPane>
      </ChartContainer>,
    );

    expect(plot().panes[0].flex).toBe(PANE_OPTION_DEFAULTS.flex);
  });


});

/**
 * **Four narrow doors for accessibility/identification.** plot-contract's
 * prescription (`role="img"` + `aria-label`, `tabIndex={-1}`) is a
 * container-level attribute, but there was no door for it — four explicit
 * props instead of a blanket spread.
 */
describe('the four accessibility doors', () => {
  it('all four land on the container div', () => {
    const { deps } = setup();
    const view = render(
      <ChartContainer
        deps={deps}
        data={data}
        id="price-chart"
        role="img"
        ariaLabel="AAPL daily bars"
        tabIndex={-1}
      >
        <ChartSeries series={lineSeries()} />
      </ChartContainer>,
    );

    const host = view.container.querySelector('#price-chart');
    expect(host).not.toBeNull();
    expect(host?.getAttribute('role')).toBe('img');
    expect(host?.getAttribute('aria-label')).toBe('AAPL daily bars');
    expect(host?.getAttribute('tabindex')).toBe('-1');
  });

  it('when omitted, role/label stay silent and tabIndex is core keyboard\'s own', () => {
    const { deps } = setup();
    const view = render(
      <ChartContainer deps={deps} data={data}>
        <ChartSeries series={lineSeries()} />
      </ChartContainer>,
    );

    const host = view.container.firstElementChild;
    expect(host?.hasAttribute('role')).toBe(false);
    expect(host?.hasAttribute('aria-label')).toBe(false);
    // tabIndex is different — core's keyboard wiring sets 0 (focusable is
    // the default prescription). The prop's job is the explicit -1 escape
    // hatch, which dom respects via hasAttribute. The tabindex="-1" in the
    // test above measures that other half.
    expect(host?.getAttribute('tabindex')).toBe('0');
  });
});
