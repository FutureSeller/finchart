export type {
  BaseDataPoint,
  CoordinateAccessor,
  DataManager,
  DataManagerFactory,
  DataView,
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

export { computation, reuseUnchanged } from "./computation";
export { headDelta } from "./head-delta";
export type { HeadChange } from "./head-delta";
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
export { mergeByX } from "./merge-by-x";
export { OhlcAggregation } from "./aggregation";
export { barAggregator } from "./aggregate";
export type { Trade } from "./aggregate";
export {
  LttbDecimation,
  M4Decimation,
  SimpleDecimation,
} from "./decimation";
export {
  SERIES_DATA_ISSUE_CODES,
  checkPoint,
  continuesAfter,
  endsBefore,
  scanSeriesData,
  validateSeriesData,
  validateSeriesPoint,
} from "./validate";
export type { SeamContext, SeriesDataIssue, SeriesDataIssueCode } from "./validate";
export { SimpleDataManager } from "./data-manager";
export type { SimpleDataManagerOptions } from "./data-manager";
