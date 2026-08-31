/**
 * `DataView` is intentionally borrowed rather than copied: its stable array
 * identity drives incremental computations. The compiler must still close
 * both mutation doors for every public reader.
 */
import type { DataManager, LineDataPoint, Source } from "../types";

declare const source: Source<LineDataPoint>;
declare const manager: DataManager<LineDataPoint>;

const fromSource = source.read();
const fromManager = manager.read();

// @ts-expect-error: a borrowed source view cannot be reordered in place
fromSource.sort(() => 0);
// @ts-expect-error: points from a borrowed source view are immutable too
fromSource[0].y = 1;
// @ts-expect-error: the manager's visible history has the same read-only contract
fromManager.splice(0, 1);

void [fromSource, fromManager];
