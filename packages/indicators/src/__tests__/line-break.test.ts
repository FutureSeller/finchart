/** Line Break — the numeric ledger: continuation, reversal at the band's extreme, the window, ordinal x. */
import type { OHLC } from "@finchart/core";
import { ContractError } from "@finchart/core";
import { describe, expect, it } from "vitest";
import { LINE_BREAK_DEFAULTS, lineBreak } from "../line-break";

function tick(x: number, close: number): OHLC {
  return { x, open: close, high: close, low: close, close };
}
const lines = (blocks: readonly { open: number; close: number }[]) => blocks.map((b) => [b.open, b.close]);

describe("lineBreak", () => {
  it("refuses a window that is not a positive integer — a JavaScript caller's null included", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => lineBreak([tick(0, 10)], { lines: bad })).toThrow(ContractError);
    }
    const nullish: unknown = null;
    expect(() => lineBreak([tick(0, 10)], { lines: nullish as never })).toThrow(ContractError);
    expect(LINE_BREAK_DEFAULTS).toEqual({ lines: 3 });
  });

  it("reads closes only — a candle's own wicks never reach a block", () => {
    const wicked: OHLC[] = [
      { x: 0, open: 1, high: 999, low: -999, close: 100 },
      { x: 7, open: -50, high: 150, low: 70, close: 105 },
    ];
    expect(lineBreak(wicked)).toEqual([{ x: 0, open: 100, close: 105, high: 105, low: 100, closedAt: 7, tone: "up" }]);
  });

  it("draws a line each time the close beats the last line's close in the running direction — one per candle", () => {
    // 100 → 105 → 112 → 118: three up lines, each opening at the previous close. 118 → 118 draws nothing.
    const blocks = lineBreak([tick(0, 100), tick(1, 105), tick(2, 112), tick(3, 118), tick(4, 118)]);
    expect(lines(blocks)).toEqual([
      [100, 105],
      [105, 112],
      [112, 118],
    ]);
    expect(blocks.map((b) => b.x)).toEqual([0, 1, 2]);
    expect(blocks.map((b) => b.closedAt)).toEqual([1, 2, 3]);
    expect(blocks.every((b) => b.tone === "up")).toBe(true);
    expect(blocks.every((b) => b.low === b.open && b.high === b.close)).toBe(true);
  });

  it("stays silent inside the band — a pullback that does not beat the last three lines' low", () => {
    // Up lines 100→105→112→118; the lowest low of the last three is 100, so 101 draws nothing.
    const blocks = lineBreak([tick(0, 100), tick(1, 105), tick(2, 112), tick(3, 118), tick(4, 101)]);
    expect(blocks).toHaveLength(3);
  });

  it("reverses when the close beats the extreme of the last `lines` lines; the turnaround line opens where the last line opened", () => {
    // Nison's three-line break: after 100→105→112→118 a close at 99 is below the three lines' lowest low (100),
    // and the black turnaround line starts at the bottom of the highest white line — 112→99, not 118→99 (the
    // last close) and not 100→99 (the band's extreme).
    const blocks = lineBreak([tick(0, 100), tick(1, 105), tick(2, 112), tick(3, 118), tick(4, 99)]);
    expect(lines(blocks)).toEqual([
      [100, 105],
      [105, 112],
      [112, 118],
      [112, 99],
    ]);
    expect(blocks[3].tone).toBe("down");
    expect(blocks[3]).toMatchObject({ high: 112, low: 99, closedAt: 4 });
  });

  it("a close exactly on the band's edge is inside it — no reversal, no zero-height line", () => {
    // Up 100→105→112→118: the band's lowest low is 100 — 100 draws nothing, 99 turns.
    const up = [tick(0, 100), tick(1, 105), tick(2, 112), tick(3, 118)];
    expect(lineBreak([...up, tick(4, 100)])).toHaveLength(3);
    expect(lineBreak([...up, tick(4, 100), tick(5, 99)])).toHaveLength(4);
    // Down 100→95→90→85: the band's highest high is 100 — 100 draws nothing, 101 turns.
    const down = [tick(0, 100), tick(1, 95), tick(2, 90), tick(3, 85)];
    expect(lineBreak([...down, tick(4, 100)])).toHaveLength(3);
    expect(lineBreak([...down, tick(4, 100), tick(5, 101)])).toHaveLength(4);
  });

  it("counts the window over the lines that exist, the current one included", () => {
    // Four up lines 100→105→112→118→125 with lines: 3 — the band is the last three (105, 112, 118 → low 105):
    // 104 reverses with a line opening at 105; 106 would not have.
    const tape = [tick(0, 100), tick(1, 105), tick(2, 112), tick(3, 118), tick(4, 125)];
    expect(lines(lineBreak([...tape, tick(5, 106)]))).toHaveLength(4);
    const reversed = lineBreak([...tape, tick(5, 104)]);
    expect(lines(reversed).at(-1)).toEqual([118, 104]); // opens where the last line (118→125) opened
    // With lines: 2 the band is 112..125 — 111 reverses; with lines: 4 it is 100..125 — 104 does not.
    expect(lines(lineBreak([...tape, tick(5, 111)], { lines: 2 })).at(-1)).toEqual([118, 111]);
    expect(lineBreak([...tape, tick(5, 104)], { lines: 4 })).toHaveLength(4);
    // Fewer lines than the window: one line 100→105, lines: 3 — a close under 100 reverses on that one line.
    expect(lines(lineBreak([tick(0, 100), tick(1, 105), tick(2, 99)]))).toEqual([
      [100, 105],
      [100, 99],
    ]);
    // lines: 1 — the band is the current line alone (100..105): 104 is inside it and draws nothing, 99 turns.
    expect(lineBreak([tick(0, 100), tick(1, 105), tick(2, 104)], { lines: 1 })).toHaveLength(1);
    expect(lines(lineBreak([tick(0, 100), tick(1, 105), tick(2, 99)], { lines: 1 }))).toEqual([
      [100, 105],
      [100, 99],
    ]);
  });

  it("the first close that differs from the first candle's sets the direction; equal closes draw nothing", () => {
    expect(lineBreak([tick(0, 10), tick(1, 10), tick(2, 10)])).toEqual([]);
    expect(lines(lineBreak([tick(0, 10), tick(1, 10), tick(2, 9)]))).toEqual([[10, 9]]);
    expect(lineBreak([tick(0, 10), tick(1, 10), tick(2, 9)])[0].tone).toBe("down");
  });

  it("slides the window in a down run too — an older, higher line no longer counts", () => {
    // Four down lines 100→95→90→85→80 with lines: 3 — the band is the last three (95, 90, 85 → high 95):
    // 96 reverses (opening at the last line's open, 85); 94 does not. Including the older 100→95 line would
    // raise the band to 100 and swallow the 96.
    const tape = [tick(0, 100), tick(1, 95), tick(2, 90), tick(3, 85), tick(4, 80)];
    expect(lineBreak([...tape, tick(5, 94)])).toHaveLength(4);
    expect(lines(lineBreak([...tape, tick(5, 96)])).at(-1)).toEqual([85, 96]);
    expect(lineBreak([...tape, tick(5, 96)], { lines: 4 })).toHaveLength(4);
  });

  it("an empty tape, a single candle and a flat tape draw nothing", () => {
    expect(lineBreak([])).toEqual([]);
    expect(lineBreak([tick(0, 10)])).toEqual([]);
    expect(lineBreak([tick(0, 10), tick(1, 10), tick(2, 10)])).toEqual([]);
  });

  it("a down run with fewer lines than the window turns on the lines it has — never on an empty band", () => {
    // One down line 100→95, lines: 3: the band is that line alone (95..100) — 96 is inside it, 101 turns (90→101
    // would be wrong; the last line opened at 100).
    expect(lineBreak([tick(0, 100), tick(1, 95), tick(2, 96)])).toHaveLength(1);
    expect(lines(lineBreak([tick(0, 100), tick(1, 95), tick(2, 101)]))).toEqual([
      [100, 95],
      [100, 101],
    ]);
  });

  it("decides on closes only in a down run as well — wicks that would continue or reverse are ignored", () => {
    // Down run 100→95→90: bar 3 closes inside the band (92) while its high (110) is above the band's high (100)
    // and its low (80) below the last close — neither draws. Bar 4 closes at 101 and turns, opening where the
    // last line (95→90) opened: 95.
    const wick = (x: number, high: number, low: number, close: number): OHLC => ({ x, open: close, high, low, close });
    const blocks = lineBreak([tick(0, 100), tick(1, 95), tick(2, 90), wick(3, 110, 80, 92), wick(4, 120, 70, 101)]);
    expect(lines(blocks)).toEqual([
      [100, 95],
      [95, 90],
      [95, 101],
    ]);
  });

  it("decides on closes only in an up run — wicks that would continue or reverse a run are ignored", () => {
    // Up run 100→105→112: bar 3 closes inside the band (110) while its low (90) is far below the band's low (100)
    // and its high (130) above the last close — neither draws. Bar 4 closes at 99 and turns.
    const wick = (x: number, high: number, low: number, close: number): OHLC => ({ x, open: close, high, low, close });
    const blocks = lineBreak([tick(0, 100), tick(1, 105), tick(2, 112), wick(3, 130, 90, 110), wick(4, 140, 80, 99)]);
    expect(lines(blocks)).toEqual([
      [100, 105],
      [105, 112],
      [105, 99],
    ]);
    expect(blocks.map((b) => b.closedAt)).toEqual([1, 2, 4]);
  });

  it("turns up again from a down run by beating the highest high of the last `lines` lines", () => {
    // Down: 100→95→90→85 (85 repeated draws nothing — a continuation needs a lower close). The band's highest
    // high is 100; 101 reverses with the white turnaround line opening at the top of the lowest black line
    // (90→85 opened at 90): 90→101.
    expect(lineBreak([tick(0, 100), tick(1, 95), tick(2, 90), tick(3, 85), tick(4, 85)])).toHaveLength(3);
    const blocks = lineBreak([tick(0, 100), tick(1, 95), tick(2, 90), tick(3, 85), tick(4, 101)]);
    expect(lines(blocks).at(-1)).toEqual([90, 101]);
    expect(blocks.at(-1)?.tone).toBe("up");
  });

  it("over a long tape: x is 0..n−1, closedAt never decreases, every block is a well-formed candle, one block per candle at most", () => {
    const tape = Array.from({ length: 2000 }, (_, i) => tick(i * 60, 100 + Math.sin(i / 7) * 5 + Math.sin(i / 23) * 9 + (i % 3) * 0.4));
    const blocks = lineBreak(tape, { lines: 3 });
    expect(blocks.length).toBeGreaterThan(50);
    expect(blocks.map((b) => b.x)).toEqual(blocks.map((_, i) => i));
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].closedAt).toBeGreaterThan(blocks[i - 1].closedAt);
    }
    for (const b of blocks) {
      expect(b.low).toBe(Math.min(b.open, b.close));
      expect(b.high).toBe(Math.max(b.open, b.close));
      expect(b.tone).toBe(b.close >= b.open ? "up" : "down");
    }
  });
});
