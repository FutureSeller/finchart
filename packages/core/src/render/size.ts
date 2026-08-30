/**
 * Announces a size change in the drawing area. Why this contract lives in
 * core: not following the parent's size is the first wall consumers hit,
 * and letting every wrapper write its own observation code means the same
 * code grows with each new framework. The implementation (`ResizeObserver`)
 * belongs to the browser, so it lives in `@finchart/dom`'s
 * `observeElementSize`.
 */

/**
 * Subscribes to size changes and returns an unsubscribe function. Which
 * element is being watched isn't in the contract — the implementation knows
 * that ahead of time. Size is passed as two numbers rather than an object
 * because `render` must not know about `plot`'s `ViewportDimensions`.
 */
export type SizeObserver = (
  onResize: (width: number, height: number) => void,
) => () => void;

/**
 * Announces that the surface's resolution ratio changed. It pairs with
 * size, but it can't be the same contract — when only the ratio changes,
 * the CSS-pixel size doesn't, so `SizeObserver` has no way to speak of that
 * event.
 *
 * It doesn't pass the new value — the surface owns the ratio
 * (`ChartLayers.resize` reads its own `devicePixelRatio` and re-grabs the
 * backing store), and all this contract does is wake it up to redraw.
 *
 * A chart that never redraws on its own (a sparkline) stays blurry from the
 * moment you move it to another monitor if there's no signal at all —
 * that's why this contract exists. The implementation (`matchMedia`) lives
 * in `@finchart/dom`'s `observeDevicePixelRatio`.
 */
export type ResolutionObserver = (onChange: () => void) => () => void;
