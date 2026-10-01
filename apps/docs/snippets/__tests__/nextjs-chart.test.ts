/**
 * The Next.js guide's chart is copied with ordinary timestamp bars, so its
 * x axis has to read them as time — the default axis labels numbers, and a
 * copied `<XAxis />` showed `1768000000000`.
 */
import { isValidElement, type ReactNode } from "react";
import { XAxis } from "@finchart/react";
import { describe, expect, it } from "vitest";
import { PriceChart } from "../nextjs-chart.client";

function find(node: ReactNode, type: unknown): Record<string, unknown> | undefined {
  if (!isValidElement<Record<string, unknown> & { children?: ReactNode }>(node)) return undefined;
  if (node.type === type) return node.props;
  const children = node.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, type);
    if (found) return found;
  }
  return undefined;
}

describe("the Next.js guide's chart", () => {
  it("labels an epoch-ms x axis as time", () => {
    const ticks = find(PriceChart({ bars: [] }), XAxis)?.ticks;
    const format = typeof ticks === "object" && ticks !== null && "format" in ticks ? ticks.format : undefined;

    expect(typeof format).toBe("function");
    const label = typeof format === "function" ? String(format(Date.UTC(2026, 0, 5))) : "";
    expect(label).not.toMatch(/^\d{10,}/);
  });
});
