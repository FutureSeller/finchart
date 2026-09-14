/**
 * A price line's badge text takes whichever of black and white reads better
 * on the badge — for a background the core can read: opaque `#rgb`,
 * `#rrggbb`, `rgb()`. Anything else keeps white, because the core cannot
 * know what a translucent or unresolved colour ends up on.
 */
import { describe, expect, it } from "vitest";
import type { DrawCommand, LineDataPoint } from "../../index";
import { lineSeries } from "../../series";
import { createPlotModel } from "../../plot/model";
import { priceLine } from "../standard";
import { readableTextOn } from "../../render/readable-text";

describe("readableTextOn", () => {
  it("picks black on light and white on dark", () => {
    expect(readableTextOn("#94a3b8")).toBe("#000000");
    expect(readableTextOn("#0f172a")).toBe("#ffffff");
    expect(readableTextOn("#ffffff")).toBe("#000000");
    expect(readableTextOn("#000000")).toBe("#ffffff");
  });

  it("reads the same colour the same way in every supported spelling", () => {
    const spellings = ["#abc", "#AABBCC", " #aabbcc ", "rgb(170, 187, 204)", "rgb(170 187 204)", "RGBA(170, 187, 204, 1)", "rgb(170 187 204 / 1)", "rgb(000170, 0187, 204)", "rgb(0170 187 00204)"];
    for (const spelling of spellings) expect({ spelling, text: readableTextOn(spelling) }).toEqual({ spelling, text: "#000000" });
  });

  it("gives up on what it cannot read as opaque — the caller keeps white", () => {
    const unreadable = [
      "rgba(0, 0, 0, 0.5)",
      "rgb(0 0 0 / 50%)",
      "rgb(10%, 20%, 30%)",
      "rgb(256, 0, 0)",
      "rgb(0256, 0, 0)",
      "rgb(1.5, 2, 3)",
      "#0008",
      "#00000080",
      "red",
      "var(--chart-price-line)",
      "color-mix(in srgb, red, blue)",
      "hsl(0 0% 50%)",
      "",
      "#12",
    ];
    for (const colour of unreadable) expect({ colour, text: readableTextOn(colour) }).toEqual({ colour, text: null });
  });

  it("uses the larger WCAG contrast — a mid grey goes to whichever side wins", () => {
    // The crossover sits between these two: #757575 is 4.61:1 on white and
    // 4.56:1 on black, #767676 is 4.54:1 on white and 4.62:1 on black.
    expect(readableTextOn("#757575")).toBe("#ffffff");
    expect(readableTextOn("#767676")).toBe("#000000");
  });
});

describe("price line badge text", () => {
  const data: LineDataPoint[] = [
    { x: 0, y: 100 },
    { x: 10, y: 120 },
  ];

  function badgeText(style: Record<string, string>, lineStyle?: { color: string }) {
    const model = createPlotModel({
      size: { width: 800, height: 600 },
      deps: { createStyleReader: () => (name) => style[name] ?? "" },
    });
    model.plot.mainPane.addSeries({ series: lineSeries(), data });
    const line = priceLine({ value: 110, ...(lineStyle && { style: lineStyle }) });
    model.plot.mainPane.addDecoration(line);
    model.plot.render();
    const text = (commands: readonly DrawCommand[]) =>
      commands.flatMap((command) => (command.type === "drawText" && command.params.box ? [command.params] : []));
    return { model, line, badges: () => text(model.commands()) };
  }

  it("follows the default line colour, a theme change and an option change — frame by frame", () => {
    const theme: Record<string, string> = {};
    const { model, line, badges } = badgeText(theme);
    expect(badges().find((badge) => badge.box?.fill === "#94a3b8")?.style.color).toBe("#000000");

    theme["--chart-price-line"] = "#0f172a";
    model.plot.render();
    expect(badges().find((badge) => badge.box?.fill === "#0f172a")?.style.color).toBe("#ffffff");

    line.setOptions({ value: 110, style: { color: "rgb(255 255 255)" } });
    model.plot.render();
    expect(badges().find((badge) => badge.box?.fill === "rgb(255 255 255)")?.style.color).toBe("#000000");
  });

  it("keeps white on a colour it cannot read", () => {
    const { badges } = badgeText({}, { color: "rgba(0, 0, 0, 0.4)" });
    expect(badges().find((badge) => badge.box?.fill === "rgba(0, 0, 0, 0.4)")?.style.color).toBe("#ffffff");
  });
});
