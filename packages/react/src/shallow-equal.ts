/** Is this a plain object — not an array, function, or null. The kind that gets one level deeper. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Value equality one level down (`depth` more for nested plain objects),
 * arrays by element identity. What the decorations and the option props use
 * to tell "a new literal with the same values" from "a change" — the first
 * must not reach the plot, or an inline object re-applies every render.
 */
export function shallowEqual(a: unknown, b: unknown, depth = 1): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null) return false;
  if (typeof b !== 'object' || b === null) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => Object.is(item, b[index]));
  }

  if (!isPlainObject(a) || !isPlainObject(b)) return false;

  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => {
    // The same count is not the same set — `{ rightOffset: undefined }` and
    // `{ axisDrag: false }` both have one key, and treating them as equal
    // would leave `axisDrag` unapplied.
    if (!Object.hasOwn(b, key)) return false;
    const left = a[key];
    const right = b[key];
    if (Object.is(left, right)) return true;
    // Just one level further — a nested option like `style` gets caught here by value.
    if (depth > 0 && isPlainObject(left) && isPlainObject(right)) {
      return shallowEqual(left, right, depth - 1);
    }
    return false;
  });
}
