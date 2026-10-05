import type { OHLC } from "@finchart/core";

export type Interval = "1m" | "1d";

export interface ApiCandle {
  timestamp: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  closePrice: string;
  volume: string;
  currency: string;
}

export interface CandleResponse {
  symbol: string;
  interval: Interval;
  source: "toss" | "demo";
  candles: ApiCandle[];
  nextBefore: string | null;
}

export interface TradeTick {
  price: string;
  volume: string;
  timestamp: string;
  currency: string;
}

/**
 * Toss labels a 1m candle by the minute it **closes** (at 02:09:06 the bar
 * in progress is stamped 02:10:00) but a 1d candle by the session's
 * midnight. finchart and `applyTrade` both think in bar-open times, so
 * shift minutes back by one bar. Paging never needs the original stamp:
 * the API's `nextBefore` cursor is the one to send back (`before` is
 * inclusive, so an x we computed ourselves would refetch the seam bar).
 */
function tossLabelOffset(interval: Interval) {
  return interval === "1m" ? 60_000 : 0;
}

export function toBars(candles: ApiCandle[], interval: Interval): OHLC[] {
  const offset = tossLabelOffset(interval);
  return candles
    .map((candle) => {
      // The accessor now rejects a non-finite volume loudly (a bar without
      // volume is still a bar, so a gap is null — not NaN).
      const volume = Number(candle.volume);
      return {
        x: new Date(candle.timestamp).getTime() - offset,
        open: Number(candle.openPrice),
        high: Number(candle.highPrice),
        low: Number(candle.lowPrice),
        close: Number(candle.closePrice),
        volume: Number.isFinite(volume) ? volume : null,
      };
    })
    .sort((a, b) => a.x - b.x);
}

const DAY_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

export function marketTimeZone(currency: string) {
  return currency === "USD" ? "America/New_York" : "Asia/Seoul";
}

/** One bar's width on the time axis. finchart's `rightOffset` is in domain units, so it's ms here. */
export function intervalMs(interval: Interval) {
  return interval === "1m" ? 60_000 : 86_400_000;
}

const LABEL_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** Crosshair / tooltip label for one x — the market's own clock, not the viewer's. */
export function timeLabel(interval: Interval, timeZone: string) {
  const key = `${interval}:${timeZone}`;
  let formatter = LABEL_FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      "en-US",
      interval === "1m"
        ? { timeZone, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
        : { timeZone, year: "numeric", month: "2-digit", day: "2-digit" },
    );
    LABEL_FORMATTERS.set(key, formatter);
  }
  return (x: number) => formatter!.format(new Date(x));
}

function dayParts(time: number, timeZone: string) {
  let formatter = DAY_FORMATTERS.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    DAY_FORMATTERS.set(timeZone, formatter);
  }
  const values = Object.fromEntries(
    formatter.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function dayKey(time: number, timeZone: string) {
  const { year, month, day } = dayParts(time, timeZone);
  return year * 10_000 + month * 100 + day;
}

function marketDayX(time: number, timeZone: string) {
  const { year, month, day } = dayParts(time, timeZone);
  const utcGuess = Date.UTC(year, month - 1, day);
  const atGuess = dayParts(utcGuess, timeZone);
  const offset =
    Date.UTC(
      atGuess.year,
      atGuess.month - 1,
      atGuess.day,
      atGuess.hour,
      atGuess.minute,
      atGuess.second,
    ) - utcGuess;
  return utcGuess - offset;
}

export function applyTrade(bars: OHLC[], tick: TradeTick, interval: Interval): OHLC[] {
  const price = Number(tick.price);
  const size = Number(tick.volume);
  const time = Date.parse(tick.timestamp);
  if (!Number.isFinite(price) || !Number.isFinite(time)) return bars;
  const traded = Number.isFinite(size) ? size : 0;
  const last = bars.at(-1);
  if (!last) return bars;

  let x: number;
  if (interval === "1m") {
    x = Math.floor(time / 60_000) * 60_000;
  } else {
    const timeZone = marketTimeZone(tick.currency);
    const tickDay = dayKey(time, timeZone);
    const lastDay = dayKey(last.x, timeZone);
    if (tickDay < lastDay) return bars;
    x = tickDay === lastDay ? last.x : marketDayX(time, timeZone);
  }
  if (x < last.x) return bars;
  if (x > last.x) {
    return [...bars, { x, open: price, high: price, low: price, close: price, volume: traded }];
  }
  return [
    ...bars.slice(0, -1),
    {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
      volume: (last.volume ?? 0) + traded,
    },
  ];
}

/**
 * Folds a REST snapshot into the live series. Bars older than the live
 * tail are the exchange's final word, so the snapshot replaces them. The
 * tail itself is still in progress: the snapshot's open and volume are
 * authoritative (tick accumulation drifts), high/low widen to whichever
 * side saw more, and close stays with the WebSocket — the REST response
 * was already stale when it landed. Bars the snapshot has beyond the tail
 * are appended as they are.
 */
export function mergeSnapshot(current: OHLC[], snapshot: OHLC[]): OHLC[] {
  const tail = current.at(-1);
  if (!tail) return snapshot;
  const merged = new Map(current.map((bar) => [bar.x, bar]));
  for (const bar of snapshot) {
    if (bar.x !== tail.x) {
      merged.set(bar.x, bar);
      continue;
    }
    merged.set(bar.x, {
      ...tail,
      open: bar.open,
      high: Math.max(tail.high, bar.high),
      low: Math.min(tail.low, bar.low),
      volume: bar.volume,
    });
  }
  return [...merged.values()].sort((a, b) => a.x - b.x);
}
