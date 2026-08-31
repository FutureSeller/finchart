/**
 * Decides when a render actually runs. Plot only says "needs a redraw" — it
 * doesn't know when that happens. A `request` that arrives while one is
 * already scheduled does nothing — no matter how many `pointermove` events
 * land in a frame, there's still just one render.
 */
export interface RenderScheduler {
  /** Schedules a render. Does nothing if one is already scheduled. */
  request(): void;
  /** Cancels the pending render. Does nothing if none is scheduled. */
  cancel(): void;
}

export type SchedulerFactory = (render: () => void) => RenderScheduler;

/**
 * Draws the instant it's requested. Nothing to coalesce. This is the test
 * default — since it never waits for a frame, you can see the result on the
 * very next line after changing state.
 */
export const immediateScheduler: SchedulerFactory = (render) => ({
  request: render,
  cancel: () => undefined,
});

/**
 * Once per next frame. The browser default.
 *
 * Drawing more often than the screen refreshes is wasted work — a
 * high-polling-rate trackpad fires `pointermove` more often than frames
 * arrive.
 */
export function frameScheduler(
  /** A test or an iframe can pass its own window. A real `Window` fits this structural type as-is. */
  view: {
    requestAnimationFrame?: (callback: (time: number) => void) => number;
    cancelAnimationFrame?: (handle: number) => void;
  } = globalThis,
): SchedulerFactory {
  // Where there's no rAF (Node, SSR), fall back to the immediate scheduler.
  if (!view.requestAnimationFrame || !view.cancelAnimationFrame) {
    return immediateScheduler;
  }

  // Bind the receiver — plain destructuring would drop `this`, and some
  // implementations need a receiver, like a class-based fake window or
  // `iframe.contentWindow`.
  const rAF = view.requestAnimationFrame.bind(view);
  const cancelRAF = view.cancelAnimationFrame.bind(view);

  return (render) => {
    let handle: number | null = null;

    return {
      request() {
        if (handle !== null) return;

        handle = rAF(() => {
          handle = null;
          render();
        });
      },

      cancel() {
        if (handle === null) return;

        cancelRAF(handle);
        handle = null;
      },
    };
  };
}

/** A scheduler you can inspect for a pending render and flush by hand. */
export interface ManualScheduler extends RenderScheduler {
  readonly pending: boolean;
  /** Runs the render now, if one is scheduled. */
  flush(): void;
}

/** Lets a test drive the frame itself — use it to assert "changed three times, rendered once". */
export function manualScheduler(): SchedulerFactory & {
  created: ManualScheduler[];
} {
  const created: ManualScheduler[] = [];

  const factory: SchedulerFactory = (render) => {
    let pending = false;

    const scheduler: ManualScheduler = {
      get pending() {
        return pending;
      },
      request() {
        pending = true;
      },
      cancel() {
        pending = false;
      },
      flush() {
        if (!pending) return;

        pending = false;
        render();
      },
    };

    created.push(scheduler);
    return scheduler;
  };

  return Object.assign(factory, { created });
}
