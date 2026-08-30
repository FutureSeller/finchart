export type { Point, Padding, PlotArea } from "./geometry";
export { contains, plotAreaOf } from "./geometry";
export { ContractError, DataError, RenderError, runAll, throwable } from "./errors";
export type { Disposer, Scope } from "./scope";
export { createScope } from "./scope";
export {
  asFinite,
  asIndex,
  requireFinite,
  requireInterval,
  requireDataArray,
  requireDataPoint,
  requireNonNegative,
  requireObject,
  requireOptionalBoolean,
  requirePoint,
  requirePositive,
  requireRange,
  definedOnly,
  describe,
} from "./guards";
