/**
 * The dispose function a case returns — optionally doubles as a re-render
 * request.
 *
 * The gallery handles a theme switch with a remount, but the docs site must
 * not — a remount throws away the drawings the user made. So the site reflects
 * the dark switch through `requestRender` instead. It's an optional field, so
 * existing cases don't break — without it the site waits until the next
 * interaction (a drag, a zoom).
 */
export interface CaseDispose {
  (): void;
  requestRender?(): void;
}

/**
 * The contract for one case — consumed by the gallery shell (`cases-shell.ts`).
 *
 * The point is that this shape knows nothing about a framework or the gallery —
 * one file is a copy-pasteable example, and on the day someone bolts Storybook
 * on, the story is three lines wrapping `mount`.
 */
export interface CaseModule {
  /** The name shown in the list. */
  title: string;
  /** One line on what this case proves — an interactive case says how to work it. */
  description: string;
  /**
   * Stand the case up and return its dispose function.
   *
   * **Dispose clears everything it made** — not just the DOM inside
   * `container`, but the listeners and timers hung on document/window too. The
   * shell calls it on every case switch and every theme remount, so anything
   * left behind haunts the next case.
   */
  mount(container: HTMLElement): CaseDispose;
}
