/**
 * @finchart/core/authoring — contracts for custom series, plugins, and
 * declarative series specs. App code normally imports from the root entry.
 */
export { seriesSpec } from "./registration";
export { pluginApi } from "./primitives";
export { styleSpec } from "./render";
export type {
  BaseDataPoint,
  CoordinateAccessor,
  DataView,
  DecimationPolicy,
  Source,
} from "./data";
export type {
  DrawTarget,
  StyleOverridesOf,
  StyleSpec,
  StyleVarNamesOf,
} from "./render";
export type { Series, SeriesContext } from "./series";
export type {
  PaneApi as Pane,
  PaneDecoration,
  SeriesHandle,
} from "./plot";
export type { Plugin, PluginApi } from "./primitives";
export type { SeriesRegistration, SeriesSpec } from "./registration";
