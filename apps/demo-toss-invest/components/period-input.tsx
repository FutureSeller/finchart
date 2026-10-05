import { useEffect, useState } from "react";

const MAX_PERIOD = 1000;

/**
 * A period field that lets you type: the text is yours while you edit, and
 * only a whole number from 2 to MAX_PERIOD reaches the chart. Leaving the
 * field shows the period in effect again.
 */
export function PeriodInput({ label, value, onCommit }: { label: string; value: number; onCommit: (period: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="period">
      {label}{" "}
      <input
        type="number"
        min={2}
        max={MAX_PERIOD}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          const period = Number(event.target.value);
          if (Number.isInteger(period) && period >= 2 && period <= MAX_PERIOD) onCommit(period);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}
