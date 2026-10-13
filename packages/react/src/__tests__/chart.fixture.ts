import { createRef } from 'react';
import type { AxisLabelsFactory, Plot } from '@finchart/core';

/** Tick labels that draw nothing, for tests that never look at them. */
export const noAxisLabels: AxisLabelsFactory = () => ({
  render: () => undefined,
  clear: () => undefined,
  destroy: () => undefined,
});

/**
 * A ref to hand a chart's `plotRef`, and `plot()` to read it: the mounted
 * plot, or an error when nothing is mounted.
 */
export function plotRef() {
  const ref = createRef<Plot>();
  const plot = () => {
    if (!ref.current) throw new Error('plot is not mounted');
    return ref.current;
  };
  return { ref, plot };
}
