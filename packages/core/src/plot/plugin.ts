import { ContractError, describe } from "../primitives";

/**
 * Wraps an extension into one unit. Instead of the user hand-assembling and
 * hand-tearing-down a series, a decoration, computation, event
 * subscriptions, and options, all of that folds into a single shape — take
 * a host, return an unsubscribe function (the shape `attachCrosshair` has).
 */

/**
 * What a plugin returns.
 *
 * **`dispose` must be safe to call more than once** — the chart's
 * `destroy()` cleans up everything it installed, but the user may have
 * already cleaned it up by hand.
 *
 * **`disposed` is part of the contract for three reasons:** (1) the chart
 * releases dead APIs (otherwise a closure piles up on every toggle), (2) a
 * plugin can block calls after its own cleanup, and (3) lifecycle state
 * becomes observable from outside.
 *
 * Don't implement this directly — use `teardown`/`pluginApi` instead.
 * **In particular, don't merge it with a spread**
 * (`{ ...teardown(fn), add }`). Spreading copies the accessor's value at
 * that instant, so `disposed` freezes at `false` forever.
 */
export interface PluginApi {
  dispose(): void;
  readonly disposed: boolean;
}

/**
 * A function that takes a host and returns an API.
 *
 * **Making `Host` a type parameter is the whole point.** Thanks to
 * structural typing, a plugin's signature is its own requirement
 * declaration — because capabilities are split into small interfaces
 * (`capabilities.ts`), a `Plugin<RenderRequester>` drops right into
 * `plot.use`. Function parameters are contravariant, so a plugin that
 * demands less accepts a host that offers more.
 */
export type Plugin<Host, Api extends PluginApi = PluginApi> = (
  host: Host,
) => Api;

/**
 * A plugin's API when its options **can be given again.** Without this,
 * changing one option means tearing the plugin down and remounting it —
 * for the drawing toolbox, that means erasing every line the user drew.
 * The shape of the patch differs per plugin, so it's a type parameter.
 *
 * **The merge is one level deep.** Only the given fields change, and a
 * given field is replaced wholesale — calling `applyOptions({ format: { x } })`
 * and then `{ format: { y } }` makes `x` disappear. `{ key: undefined }`
 * resets to the default (different from omitting the key).
 *
 * **Calling this after cleanup throws** — succeeding silently would make
 * the caller think the option took effect and wait forever for the screen
 * to update. This is an opt-in contract: a plugin that's allowed to freeze
 * at install time stays a plain `PluginApi`.
 */
export interface ConfigurablePluginApi<Options> extends PluginApi {
  applyOptions(patch: Partial<Options>): void;
}

/**
 * Builds an API that has nothing but a single dispose function.
 *
 * Also the place to fold several teardown functions into one — call each
 * of a plugin's own cleanups from inside here, in order.
 */
export function teardown(dispose: () => void): PluginApi {
  return pluginApi({}, dispose);
}

/**
 * Grafts lifecycle onto an API that already has its own methods. **Returns
 * the same object** — `use` preserves identity, so this doesn't create a
 * new one either.
 *
 * ```ts
 * return pluginApi({ node }, () => handle.dispose());
 * ```
 *
 * **This exists to replace a spread** (`{ ...teardown(fn), node }`) — a
 * spread copies the `disposed` accessor's value at that instant (`false`),
 * producing an API that claims to be alive forever, even after cleanup.
 */
export function pluginApi<T extends object>(
  api: T,
  dispose: () => void,
): T & PluginApi {
  /**
   * **Never graft twice.** Grafting again onto an object that already has
   * `dispose` (whether from a spread misuse or a class with its own
   * `dispose` method) silently drops the first teardown function — the
   * worst possible failure for a lifecycle primitive.
   *
   * **`in`, not `Object.hasOwn`.** A class instance's method lives on the
   * prototype, which `hasOwn` can't see.
   */
  if ("dispose" in api) {
    throw new ContractError(
      "this object already has a dispose — fold multiple teardown functions inside pluginApi",
    );
  }
  if (Object.isFrozen(api)) {
    throw new ContractError("cannot graft lifecycle onto a frozen object");
  }

  let done = false;

  /**
   * **Redefinition stays open; assignment is blocked.** `configurable`
   * must stay open for `vi.spyOn` and a consumer's decoration to work.
   * `writable` is closed — swapping in `api.dispose = fn` would erase the
   * code that sets `done`, freezing `disposed` at `false` forever. The
   * once-only guarantee comes from `done` below, not from the descriptor.
   */
  return Object.defineProperties(api as T & PluginApi, {
    dispose: {
      value: () => {
        if (done) return;
        done = true;
        dispose();
      },
      writable: false,
      enumerable: true,
      configurable: true,
    },
    disposed: {
      get: () => done,
      enumerable: true,
      configurable: true,
    },
  });
}

/**
 * Installs one extension into the list. **Shared between `Plot` and
 * `Pane`** — the same rule needs the same code, or the lifecycle guard
 * ends up applied to only one of them.
 *
 * **Releases dead entries** right at install time, so a toggle that turns
 * an indicator on and off, or a React effect that remounts on every option
 * change, doesn't keep piling up dead APIs.
 */
export function install<Host, Api extends PluginApi>(
  installed: PluginApi[],
  host: Host,
  plugin: Plugin<Host, Api>,
  door: string,
): Api {
  checkPlugin(plugin, door);

  let live = 0;
  for (const api of installed) {
    if (!api.disposed) installed[live++] = api;
  }
  installed.length = live;

  const api = plugin(host);
  checkPluginApi(api, door);
  installed.push(api);
  return api;
}

/**
 * Checks that `use` was given a function. Forgetting the factory call `()`,
 * as in `plot.use(crosshair)`, would otherwise pass silently and just not
 * produce the extension — leaving the consumer to spend hours chasing CSS,
 * theme, or `zIndex` instead. So this throws up front.
 */
function checkPlugin(plugin: unknown, door: string): void {
  if (typeof plugin !== "function") {
    throw new ContractError(
      `${door} must be a function — an extension is the result of calling a factory, got ${describe(plugin)}. ` +
        `(this is where lightweight-charts' attachPrimitive(object) goes)`,
    );
  }
}

/**
 * Whether what the extension returned has a lifecycle. **Without it,
 * `destroy()` blows up** — not even at the install site, but at unmount,
 * under someone else's name.
 */
function checkPluginApi(api: unknown, door: string): void {
  if (
    typeof api !== "object" ||
    api === null ||
    typeof Reflect.get(api, "dispose") !== "function"
  ) {
    throw new ContractError(
      `what ${door} returned has no dispose, got ${describe(api)} — ` +
        `did you forget to call the factory? it's use(crosshair()), not use(crosshair)`,
    );
  }
}
