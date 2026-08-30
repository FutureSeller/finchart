import type { Canvas2DContext, ChartLayers, LayersFactory } from '@finchart/core';

/**
 * jsdom doesn't provide a canvas 2D context.
 * All the hook tests need is "was the Plot recreated?", so the surface is
 * filled in with a fake.
 */
function noopContext(): Canvas2DContext {
  const noop = () => undefined;
  return {
    lineWidth: 1,
    strokeStyle: '',
    fillStyle: '',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    clearRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    stroke: noop,
    fill: noop,
    fillRect: noop,
    setLineDash: noop,
    fillText: noop,
    // Clipping — the fake doesn't actually clip. What's under test here is
    // how React drives core, not pixels.
    save: noop,
    restore: noop,
    rect: noop,
    clip: noop,
    // The default measurer (browserDeps) measures through this context —
    // having just a width is enough for it to be valid.
    measureText: (text: string) => ({ width: text.length * 7 }) as TextMetrics,
  } as unknown as Canvas2DContext;
}

export interface LayersSpy {
  createLayers: LayersFactory;
  /** Number of layers created = number of times a Plot was constructed */
  created: ChartLayers[];
  destroyed: ChartLayers[];
  resizes: Array<{ width: number; height: number }>;
}

export function layersSpy(): LayersSpy {
  const created: ChartLayers[] = [];
  const destroyed: ChartLayers[] = [];
  const resizes: Array<{ width: number; height: number }> = [];

  const createLayers: LayersFactory = (width, height) => {
    const size = { width, height };
    const context = noopContext();

    const layers: ChartLayers = {
      data: {
        get width() {
          return size.width;
        },
        get height() {
          return size.height;
        },
        context,
      },
      overlay:
        typeof document === "undefined"
          ? null
          : document.createElement("div"),
      resize(nextWidth, nextHeight) {
        size.width = nextWidth;
        size.height = nextHeight;
        resizes.push({ width: nextWidth, height: nextHeight });
      },
      destroy() {
        destroyed.push(layers);
      },
    };

    created.push(layers);
    return layers;
  };

  return { createLayers, created, destroyed, resizes };
}
