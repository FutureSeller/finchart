/**
 * `useDataSource` — does a React state array cross over into core's `Source`
 * contract ("if the reference changed, it changed")?
 */
import type { LineDataPoint, Source } from '@finchart/core';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useDataSource } from '../hooks';

afterEach(cleanup);

describe('useDataSource', () => {
  it('should keep one identity while read() follows the latest array', () => {
    const sources: Source<LineDataPoint>[] = [];

    function Consumer({ data }: { data: LineDataPoint[] }) {
      sources.push(useDataSource(data));
      return null;
    }

    const first = [{ x: 0, y: 1 }];
    const second = [{ x: 0, y: 1 }, { x: 1, y: 2 }];

    const screen = render(<Consumer data={first} />);
    screen.rerender(<Consumer data={second} />);

    expect(sources.length).toBeGreaterThanOrEqual(2);
    // One identity — putting it in usePlugin deps won't trigger a reinstall.
    expect(new Set(sources).size).toBe(1);
    // read() stays current — the compute node recognizes "changed" by reference.
    expect(sources[0].read()).toBe(second);
  });
});
