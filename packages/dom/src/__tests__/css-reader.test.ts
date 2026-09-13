// @vitest-environment jsdom
/**
 * `cssReader` reads through the container's own window — a chart mounted
 * into an iframe or a popup is styled by that window's sheets, not the
 * window the script runs in.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssReader } from "../css-reader";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("cssReader", () => {
  it("asks the container's own window, not the global one", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const view = frame.contentWindow;
    const inner = frame.contentDocument;
    if (!view || !inner) throw new Error("no iframe window");
    const container = inner.createElement("div");
    inner.body.appendChild(container);

    const global = vi.spyOn(window, "getComputedStyle");
    const own = vi.spyOn(view, "getComputedStyle");
    cssReader(container)("--chart-line");

    expect(own).toHaveBeenCalledWith(container);
    expect(global).not.toHaveBeenCalled();
  });

  it("reads a variable set on the container", () => {
    const container = document.createElement("div");
    container.style.setProperty("--chart-line", " #123456 ");
    document.body.appendChild(container);
    expect(cssReader(container)("--chart-line")).toBe("#123456");
  });

  it("gives an empty reader without a container", () => {
    const global = vi.spyOn(window, "getComputedStyle");
    expect(cssReader(null)("--chart-line")).toBe("");
    expect(global).not.toHaveBeenCalled();
  });

  it("gives an empty reader for a document with no window", () => {
    const detached = document.implementation.createHTMLDocument("no window");
    expect(detached.defaultView).toBeNull();
    const container = detached.createElement("div");
    detached.body.appendChild(container);

    const global = vi.spyOn(window, "getComputedStyle");
    expect(cssReader(container)("--chart-line")).toBe("");
    expect(global).not.toHaveBeenCalled();
  });
});
