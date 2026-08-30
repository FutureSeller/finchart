import type { ChartLayers, LayersFactory } from "./types";

/**
 * A layer that holds only size — no DOM, no canvas. This is the layer for a
 * headless chart. `overlay` is null (there's no DOM to mount), and the
 * surface has no `context` (there's no canvas to replay onto) — that's why
 * it pairs with the recording renderer, and why plugging in DOM labels,
 * dividers, or a canvas renderer throws when those try to build.
 */
export const createMemoryLayers: LayersFactory = (
  width,
  height,
): ChartLayers => {
  const size = { width, height };

  return {
    data: {
      get width() {
        return size.width;
      },
      get height() {
        return size.height;
      },
    },
    overlay: null,
    resize(nextWidth, nextHeight) {
      size.width = nextWidth;
      size.height = nextHeight;
    },
    destroy() {
      // No resources held to release.
    },
  };
};
