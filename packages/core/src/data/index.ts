export type {
  BaseDataPoint,
  CoordinateAccessor,
  DataManager,
  DataManagerFactory,
  DataPoint,
  DecimationFactory,
  DecimationStrategy,
  LineDataPoint,
  OHLC,
  Range,
  DecimationPolicy,
  IndexRange,
  Source,
  Viewport,
} from "./types";

export { mergePolicy } from "./types";

export { computation } from "./computation";
export { tailDelta } from "./tail-delta";
export type { TailChange } from "./tail-delta";
export type { Computation, ComputationSpec } from "./computation";

export {
  defaultCoordinates,
  isGap,
  LineDataAccessor,
  OHLCAccessor,
} from "./accessors";

export { lowerBoundBy, upperBoundBy } from "./search";
export { OhlcAggregation } from "./aggregation";
export {
  LttbDecimation,
  M4Decimation,
  SimpleDecimation,
} from "./decimation";
export { SimpleDataManager } from "./data-manager";
export type { SimpleDataManagerOptions } from "./data-manager";
