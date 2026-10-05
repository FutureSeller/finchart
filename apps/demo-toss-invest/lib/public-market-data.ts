import "server-only";
import type { ApiCandle, TradeTick } from "./candles";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid market data.");
  return value as Record<string, unknown>;
}

function numeric(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Number(value))) {
    throw new Error("Invalid market value.");
  }
  return String(Number(value));
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Invalid market timestamp.");
  }
  return new Date(value).toISOString();
}

function currency(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) throw new Error("Invalid market currency.");
  return value;
}

/** Project individual fields; a TypeScript assertion does not remove private upstream fields. */
export function publicCandle(value: unknown): ApiCandle {
  const row = object(value);
  return {
    timestamp: timestamp(row.timestamp),
    openPrice: numeric(row.openPrice), highPrice: numeric(row.highPrice),
    lowPrice: numeric(row.lowPrice), closePrice: numeric(row.closePrice),
    volume: numeric(row.volume), currency: currency(row.currency),
  };
}

export function publicTrade(value: unknown): TradeTick {
  const row = object(value);
  return {
    price: numeric(row.price), volume: numeric(row.volume),
    timestamp: timestamp(row.timestamp), currency: currency(row.currency),
  };
}

export function publicCursor(value: unknown): string | null {
  return value == null ? null : timestamp(value);
}
