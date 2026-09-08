/**
 * The declared head door re-runs `calc` on a prefix. A `calc` that keeps a
 * resume checkpoint for `calcLast` (every fold-based increment does) now
 * holds the prefix's end, not the array's end — and the next tick would
 * resume from the wrong place and corrupt the tail for good. So the tick
 * after a declared landing is a full computation: the tail gate is closed
 * until `calc` has run over the whole input once more.
 */
import { describe, expect, it } from "vitest";
import { computation } from "../computation";
import type { Source } from "../types";

interface Pt {
  x: number;
}

function feed(initial: Pt[]) {
  let data = initial;
  const source: Source<Pt> = { read: () => data };
  return {
    source,
    prepend(older: Pt[]) {
      data = [...older, ...data];
    },
    append(next: Pt) {
      data = [...data, next];
    },
  };
}

const pts = (from: number, to: number): Pt[] => {
  const out: Pt[] = [];
  for (let x = from; x < to; x++) out.push({ x });
  return out;
};

/** A 3-bar running sum kept as a fold with a resume checkpoint — the shape of every increment. */
function runningSum(source: Source<Pt>, log: string[]) {
  let atEnd: { sum: number; window: number[] } | null = null;
  const step = (state: { sum: number; window: number[] }, x: number) => {
    state.window.push(x);
    state.sum += x;
    if (state.window.length > 3) state.sum -= state.window.shift() ?? 0;
    return state.window.length === 3 ? state.sum : null;
  };
  return computation({
    inputs: [source],
    headLookback: 2,
    calc: (data) => {
      log.push(`calc:${data.length}`);
      const state = { sum: 0, window: [] as number[] };
      const line = data.map((p) => ({ x: p.x, y: step(state, p.x) }));
      atEnd = state;
      return { line };
    },
    calcLast: (previous, [data], [change]) => {
      log.push(`calcLast:${change.kind}`);
      if (change.kind !== "append" || atEnd === null) return null;
      const state = { sum: atEnd.sum, window: [...atEnd.window] };
      const tail = data.slice(data.length - change.count).map((p) => ({ x: p.x, y: step(state, p.x) }));
      atEnd = state;
      return { line: previous.line.concat(tail) };
    },
  });
}

describe("the tick after a declared landing is a full computation", () => {
  it("closes the tail gate once — calcLast is skipped on that tick, then used again", () => {
    const log: string[] = [];
    const f = feed(pts(100, 130));
    const node = runningSum(f.source, log);
    node.out.line.read();
    expect(log).toEqual(["calc:30"]);

    f.prepend(pts(0, 100));
    node.out.line.read();
    expect(log.at(-1)).toBe("calc:102"); // the prefix: 100 landed + lookback 2

    f.append({ x: 130 });
    node.out.line.read();
    expect(log.at(-1)).toBe("calc:131"); // not calcLast — the checkpoint is the prefix's

    f.append({ x: 131 });
    node.out.line.read();
    expect(log.at(-1)).toBe("calcLast:append");
  });

  it("so the values after a landing and a tick equal a cold node's", () => {
    const f = feed(pts(100, 130));
    const node = runningSum(f.source, []);
    node.out.line.read();
    f.prepend(pts(0, 100));
    node.out.line.read();
    f.append({ x: 130 });
    f.append({ x: 131 });
    const landed = node.out.line.read();

    const cold = runningSum({ read: () => pts(0, 132) }, []).out.line.read();
    expect(landed.map((p) => p.y)).toEqual(cold.map((p) => p.y));
    expect(landed.at(-1)?.y).toBe(129 + 130 + 131);
  });

  it("two landings in a row still leave the gate closed for exactly one tick", () => {
    const log: string[] = [];
    const f = feed(pts(200, 230));
    const node = runningSum(f.source, log);
    node.out.line.read();
    f.prepend(pts(100, 200));
    node.out.line.read();
    f.prepend(pts(0, 100));
    node.out.line.read();
    expect(log.slice(1)).toEqual(["calc:102", "calc:102"]);

    f.append({ x: 230 });
    node.out.line.read();
    expect(log.at(-1)).toBe("calc:231");
    f.append({ x: 231 });
    node.out.line.read();
    expect(log.at(-1)).toBe("calcLast:append");

    const cold = runningSum({ read: () => pts(0, 232) }, []).out.line.read();
    expect(node.out.line.read().map((p) => p.y)).toEqual(cold.map((p) => p.y));
  });

  it("a recovery calc that throws keeps the gate closed — the retry is still a full computation", () => {
    const log: string[] = [];
    let failOnce = false;
    const f = feed(pts(100, 130));
    const inner = runningSum(f.source, log);
    // Wrap the same increment in a node whose calc can fail once on the recovery run.
    let atEnd: number | null = null;
    const node = computation({
      inputs: [f.source],
      headLookback: 2,
      calc: (data) => {
        if (failOnce) {
          failOnce = false;
          throw new Error("transient");
        }
        log.push(`outer:${data.length}`);
        atEnd = data.length;
        return { n: data.map((p) => ({ x: p.x, y: atEnd })) };
      },
      calcLast: (previous, [data], [change]) => {
        log.push(`outerLast:${change.kind}`);
        if (change.kind !== "append") return null;
        return { n: previous.n.concat(data.slice(-change.count).map((p) => ({ x: p.x, y: atEnd }))) };
      },
    });
    inner.out.line.read();
    node.out.n.read();
    f.prepend(pts(0, 100));
    node.out.n.read();

    failOnce = true;
    f.append({ x: 130 });
    expect(() => node.out.n.read()).toThrow("transient");
    // The retry must still be the full computation, not a resume.
    node.out.n.read();
    expect(log.filter((l) => l.startsWith("outer")).at(-1)).toBe("outer:131");
    f.append({ x: 131 });
    node.out.n.read();
    expect(log.at(-1)).toBe("outerLast:append");
  });
});
