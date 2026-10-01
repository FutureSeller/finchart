/**
 * Mistakes a caller can make that used to be accepted and then failed on
 * some later frame, pan or input — each is refused where it is made.
 */
import { describe, expect, it } from "vitest";
import { testBrowserDeps } from "../../__tests__/dom-fakes";
import { timeTicks } from "../../axis";
import { ContractError } from "../../primitives";
import { lineSeries } from "../../series";
import { mountPlot } from "./helpers";

/** Hand-built values typed as anything, the way they arrive from JS or storage. */
const junk = <T,>(json: string): T => JSON.parse(json);
const data = [{ x: 0, y: 1 }, { x: 1, y: 2 }];

function mount() {
  return mountPlot({ deps: testBrowserDeps(), series: lineSeries(), data });
}

describe("refused where the mistake is made", () => {
  it("a listener that is not a function", () => {
    const { plot } = mount();
    expect(() => plot.on("stateChange", junk("null"))).toThrow(ContractError);
    expect(() => plot.mainPane.subscribe(junk("1"))).toThrow(ContractError);
    // …and nothing was registered: later changes still work.
    plot.mainPane.applyOptions({ flex: 2 });
  });

  it("an event name the chart does not emit", () => {
    const { plot } = mount();
    expect(() => plot.on(junk<"render">('"stateChnage"'), () => {})).toThrow(/stateChnage/);
  });

  it("a pane autoScale or invert that is not a boolean", () => {
    const { plot } = mount();
    expect(() => plot.mainPane.applyOptions({ autoScale: junk('"false"') })).toThrow(/boolean/);
    expect(() => plot.addPane({ invert: junk("1") })).toThrow(/boolean/);
    expect(plot.panes).toHaveLength(1);
  });

  it("an axis format that is not a function, or ticks without ticks()", () => {
    const { plot } = mount();
    expect(() => plot.applyOptions({ axis: { x: { format: junk('"%d"') } } })).toThrow(ContractError);
    expect(() => plot.mainPane.applyOptions({ axis: { ticks: junk("{}") } })).toThrow(ContractError);
  });

  it("timeTicks callbacks that are not functions", () => {
    expect(() => timeTicks({ epochOf: junk("1") })).toThrow(/epochOf/);
    expect(() => timeTicks({ xOfEpoch: junk('"ms"') })).toThrow(/xOfEpoch/);
  });

  it("a setData refit that is not a boolean", () => {
    const { handle } = mount();
    expect(() => handle.setData(data, { refit: junk('"false"') })).toThrow(/refit/);
  });

  it("an input consumer without handle, or with a priority that is not finite", () => {
    const { plot } = mount();
    expect(() => plot.addInputConsumer(junk("{}"))).toThrow(/handle/);
    expect(() => plot.addInputConsumer({ handle: () => false }, { priority: NaN })).toThrow(/priority/);
  });

  it("a screenshot of a destroyed chart", () => {
    const { plot } = mount();
    plot.destroy();
    expect(() => plot.takeScreenshot()).toThrow(/destroyed/);
  });
});
