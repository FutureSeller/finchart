/**
 * The docs checker holds each example page's title to its module, but only
 * for pages that exist — a case missing its page, index link or sidebar entry
 * passes it silently. The cases whose pages the guides link to are pinned here.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const docs = resolve(__dirname, "../../../../docs");
const read = (path: string) => readFileSync(resolve(docs, path), "utf8");

describe("the docs list the worker rendering case", () => {
  it("has its page, its index link and its sidebar entries", () => {
    expect(existsSync(resolve(docs, "examples/worker-render.md"))).toBe(true);
    expect(read("examples/index.md")).toContain("](/examples/worker-render)");
    const sidebar = read(".vitepress/config.ts");
    expect(sidebar).toContain('link: "/examples/worker-render" }');
    expect(sidebar).toContain('link: "/guide/workers" }');
    expect(existsSync(resolve(docs, "guide/workers.md"))).toBe(true);
  });
});
