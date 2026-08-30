/**
 * Turns a style key (`--chart-*`) into a raw value string. This is a
 * medium-neutral contract — core doesn't know where the value comes from.
 * CSS is just one implementation (`@finchart/dom`'s `cssReader`, computed
 * style); any `(name) => string` — a JS theme object, server config —
 * becomes a loader. Resolution always happens on the drawing side
 * (plot/series); the renderer only receives the result.
 */
export type StyleReader = (name: string) => string;

/**
 * Builds a reader. Assembly binds the reference element ahead of time —
 * the core contract has no element. The browser implementation is
 * `@finchart/dom`'s `cssReader` (computed style); the headless wiring is
 * the code fallback (`noStyle`).
 */
export type StyleReaderFactory = () => StyleReader;
