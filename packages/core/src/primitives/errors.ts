/**
 * Three things get thrown — split by what the consumer can do about it.
 *
 * | What | When | What the consumer can do |
 * |---|---|---|
 * | `DataError` | An outside value broke the contract | Catch it — it happens for real at runtime |
 * | `ContractError` | The caller used the API against its contract | Nothing. It's a bug that needs a code fix |
 * | `RenderError` | The wiring doesn't line up, so nothing can draw | Nothing. The collaborator combination needs a fix |
 *
 * The line is "can you catch this," not "where did it come from" — mix them
 * and a `catch` meant to swallow data errors quietly swallows programmer bugs
 * too.
 */

/**
 * The wiring doesn't line up, so nothing can draw — a DOM label on a headless
 * host, a canvas renderer on a surface with no canvas, and the like. Instead
 * of wandering off into a blank screen, it stops right at the bad wiring.
 */
export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderError";
  }
}

/** When data breaks the contract — x ordering, x parsing, where the gaps go. */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

/**
 * The caller used the API against its contract — deleting the last pane,
 * a non-positive zoom factor, registering a duplicate id, and so on. The
 * point isn't to be caught, it's to have a name — a plain `Error` gets lost
 * among everyone else's errors in an error reporter.
 */
export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}

/**
 * Calls every item and collects what each one throws. `null` if nothing threw.
 *
 * One extension's failure must not block another extension's cleanup or
 * notification, but it also must not be swallowed — run everything, then
 * throw the collection. The array is only allocated once something actually
 * throws.
 */
export function runAll<T>(
  items: readonly T[],
  run: (item: T) => void,
): unknown[] | null {
  let failures: unknown[] | null = null;

  for (const item of items) {
    try {
      run(item);
    } catch (error) {
      (failures ??= []).push(error);
    }
  }

  return failures;
}

/**
 * Turns the collected failures into a single throwable. If there's only one,
 * returns it unwrapped — wrapping would blur its stack and type, hiding it
 * from a consumer branching on `instanceof`.
 */
export function throwable(failures: unknown[], message: string): unknown {
  return failures.length === 1
    ? failures[0]
    : new AggregateError(failures, message);
}
