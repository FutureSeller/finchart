export type { Point, Padding, PlotArea } from "./geometry";
export { contains, plotAreaOf } from "./geometry";
export { ContractError, DataError, RenderError, runAll, throwable } from "./errors";
export type { Disposer, Scope } from "./scope";
export { createScope } from "./scope";
export { emitter } from "./emitter";
export { forEachStill, mapStill } from "./still";
export type { Emitter, Observable } from "./emitter";
export { eventChannel } from "./event-channel";
export type { EventChannel } from "./event-channel";
export { install, pluginApi, teardown } from "./plugin";
export type { ConfigurablePluginApi, Plugin, PluginApi } from "./plugin";
export {
  requireFinite,
  requireInterval,
  requireDataArray,
  requireDataPoint,
  requireFiniteX,
  requireNonNegative,
  requireObject,
  requireOptionalBoolean,
  requirePoint,
  requirePositive,
  requireRange,
  definedOnly,
  describe,
} from "./guards";
