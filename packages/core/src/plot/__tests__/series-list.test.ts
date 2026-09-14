/**
 * The series list on its own — no pane, no scale, no data manager. The two
 * owners, the reconcile plan, and the draw order used to be reachable only
 * through a mounted pane.
 */
import { describe, expect, it, vi } from "vitest";
import type { DataManagerFactory } from "../../data";
import { ContractError } from "../../primitives";
import type { Entry, SeriesSpec } from "../../registration";
import { SeriesList } from "../series-list";

const managers: DataManagerFactory = () => {
  throw new Error("a fake entry never builds a manager");
};

function fakeEntry(over: Partial<Entry> = {}): Entry {
  return {
    series: {},
    name: null,
    color: null,
    zIndex: 0,
    readout: true,
    nearest: () => null,
    swapSeries: vi.fn(),
    feed: vi.fn(),
    xRange: () => null,
    xValues: () => [],
    valueExtent: () => null,
    positiveFloor: () => null,
    draw: vi.fn(),
    ...over,
  };
}

function spec(
  id: string,
  entry: Entry,
  over: Partial<Omit<SeriesSpec, "id" | "toEntry">> = {},
): SeriesSpec & { built: ReturnType<typeof vi.fn> } {
  const built = vi.fn(() => entry);
  return { id, series: entry.series, toEntry: built, built, ...over };
}

describe("SeriesList ownership", () => {
  it("should refuse addSeries while syncSeries owns the list", () => {
    const list = new SeriesList();
    list.sync([spec("a", fakeEntry())], managers);
    expect(() => list.add(fakeEntry())).toThrow(/owned by syncSeries/);
  });

  it("should refuse syncSeries while handles own the list", () => {
    const list = new SeriesList();
    list.add(fakeEntry());
    expect(() => list.sync([spec("a", fakeEntry())], managers)).toThrow(
      /owned by addSeries\/setSeries/,
    );
  });

  it("should release declarative ownership on an empty sync", () => {
    const list = new SeriesList();
    list.sync([spec("a", fakeEntry())], managers);
    list.sync([], managers);
    expect(() => list.add(fakeEntry())).not.toThrow();
  });

  it("should release imperative ownership on clear", () => {
    const list = new SeriesList();
    list.add(fakeEntry());
    list.clear();
    expect(() => list.sync([spec("a", fakeEntry())], managers)).not.toThrow();
  });
});

describe("SeriesList.sync", () => {
  it("should throw on a duplicate id before touching anything", () => {
    const list = new SeriesList();
    const a = fakeEntry();
    list.sync([spec("a", a)], managers);

    const again = spec("a", a, { data: [{ x: 1 }] });
    expect(() =>
      list.sync([again, spec("b", fakeEntry()), spec("b", fakeEntry())], managers),
    ).toThrow(ContractError);

    expect(a.feed).not.toHaveBeenCalled();
    expect(list.entries).toHaveLength(1);
  });

  it("should report no change when the same specs come again", () => {
    const list = new SeriesList();
    const specs = [spec("a", fakeEntry())];
    expect(list.sync(specs, managers)).toBe(true);
    expect(list.sync(specs, managers)).toBe(false);
  });

  it("should keep the entry and swap the series when the derive key matches", () => {
    const list = new SeriesList();
    const a = fakeEntry();
    list.sync([spec("a", a, { deriveKey: [14] })], managers);

    const next = spec("a", fakeEntry(), { deriveKey: [14] });
    const changed = list.sync([next], managers);

    expect(changed).toBe(true);
    expect(next.built).not.toHaveBeenCalled();
    expect(a.swapSeries).toHaveBeenCalledWith(next.series);
    expect(list.entries[0]).toBe(a);
  });

  it("should feed only when the data reference changed", () => {
    const list = new SeriesList();
    const a = fakeEntry();
    const data = [{ x: 1 }];
    list.sync([spec("a", a, { data })], managers);

    list.sync([{ ...spec("a", a, { data }), series: a.series }], managers);
    expect(a.feed).not.toHaveBeenCalled();

    list.sync([{ ...spec("a", a, { data: [{ x: 2 }] }), series: a.series }], managers);
    expect(a.feed).toHaveBeenCalledTimes(1);
  });

  it("should rebuild when the derive key or the input changes", () => {
    const list = new SeriesList();
    list.sync([spec("a", fakeEntry(), { deriveKey: [14] })], managers);

    const rekeyed = spec("a", fakeEntry(), { deriveKey: [20] });
    list.sync([rekeyed], managers);
    expect(rekeyed.built).toHaveBeenCalledTimes(1);

    const input = { read: () => [], subscribe: () => () => {} };
    const fed = spec("a", fakeEntry(), { input });
    list.sync([fed], managers);
    expect(fed.built).toHaveBeenCalledTimes(1);
  });

  it("should follow array order, not registration order", () => {
    const list = new SeriesList();
    const a = fakeEntry();
    const b = fakeEntry();
    list.sync([spec("a", a), spec("b", b)], managers);
    list.sync([spec("b", b), spec("a", a)], managers);
    expect(list.entries).toEqual([b, a]);
  });
});

describe("SeriesList queries and drawing", () => {
  it("should remove once and report false the second time", () => {
    const list = new SeriesList();
    const a = fakeEntry();
    list.add(a);
    expect(list.remove(a)).toBe(true);
    expect(list.remove(a)).toBe(false);
  });

  it("should answer an empty probe for a non-finite x", () => {
    const list = new SeriesList();
    list.add(
      fakeEntry({
        nearest: () => ({ x: 0, value: 1, min: null, max: null, index: 0 }),
      }),
    );
    expect(list.probe(NaN)).toEqual([]);
    expect(list.probe(0)).toHaveLength(1);
  });

  it("should draw by zIndex with registration order on ties", () => {
    const list = new SeriesList();
    const order: string[] = [];
    const named = (name: string, zIndex: number) =>
      fakeEntry({ zIndex, draw: () => void order.push(name) });
    list.add(named("band", 0));
    list.add(named("candles", 1));
    list.add(named("ma", 0));

    list.draw({} as never, {
      viewport: { startX: 0, endX: 1, width: 1, height: 1 },
      x: { toPixel: (x) => x, fromPixel: (p) => p, toDomain: (x) => x, fromDomain: (d) => d },
      yScale: {} as never,
      area: { left: 0, right: 1, top: 0, bottom: 1 },
      readStyle: () => "",
    });

    expect(order).toEqual(["band", "ma", "candles"]);
  });

  it("should take the smallest positive floor across entries", () => {
    const list = new SeriesList();
    list.add(fakeEntry({ positiveFloor: () => 5 }));
    list.add(fakeEntry({ positiveFloor: () => null }));
    list.add(fakeEntry({ positiveFloor: () => 2 }));
    expect(list.minPositive(null)).toBe(2);
  });
});
