import { useState } from "react";
import { labelText } from "./RadarChart";

export interface LineSeries {
  id: string;
  name: string;
  /** A CSS colour, or null for the gray dashed reference line. */
  color: string | null;
  /** A value per column; null breaks the line there. */
  values: (number | null)[];
  /** What the tooltip says after each value, such as "(2 of 5)". */
  details?: string[];
}

const PLOT_HEIGHT = 200;

/** The axis top for counts: the next of 2, 4, 6, 10, 20, 40, 60, 100…
 *  at or above the largest value, so the top and middle ticks are whole. */
export function countAxisMax(largest: number): number {
  for (let step = 1; ; step *= 10) {
    for (const m of [2, 4, 6, 10]) if (m * step >= largest) return m * step;
  }
}

/** One line per series across the columns, from 0 at the bottom to `max` at
 *  the top. The lines are drawn in a stretched SVG and the dots in HTML on
 *  top, so the plot fills any width and the dots stay round. */
export function LineProfile({
  columns,
  series,
  label,
  max,
  format,
}: {
  columns: { label: string; detail: string }[];
  series: LineSeries[];
  label: string;
  max: number;
  format: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const n = columns.length;
  const x = (i: number) => ((i + 0.5) / n) * 100;
  const y = (value: number) => (1 - value / max) * 100;
  const runs = (values: (number | null)[]) => {
    const out: string[][] = [];
    let run: string[] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (run.length) out.push(run);
        run = [];
      } else run.push(`${x(i)},${y(v)}`);
    });
    if (run.length) out.push(run);
    return out;
  };
  return (
    <div role="figure" aria-label={label} className="space-y-2 pt-2">
      <div className="flex gap-2">
        <div className="relative w-8 shrink-0 text-right text-[10px] tabular-nums text-fg-muted" style={{ height: PLOT_HEIGHT }} aria-hidden>
          {[max, max / 2, 0].map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
              {format(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height: PLOT_HEIGHT }} onPointerLeave={() => setHover(null)}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            {[0, max / 2, max].map((t) => (
              <line key={t} x1={0} x2={100} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--cn-line-strong)" : "var(--cn-line)"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={100} stroke="var(--cn-line-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
            {series.map((s) =>
              runs(s.values).map((run, r) => (
                <polyline
                  key={`${s.id}-${r}`}
                  points={run.join(" ")}
                  fill="none"
                  stroke={s.color ?? "var(--cn-fg-subtle)"}
                  strokeWidth={2}
                  strokeDasharray={s.color ? undefined : "4 4"}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}
          </svg>
          {series
            .filter((s) => s.color)
            .map((s) =>
              s.values.map((v, i) =>
                v === null ? null : (
                  <span
                    key={`${s.id}-${i}`}
                    className="absolute size-3 rounded-full border-2 border-surface"
                    style={{ left: `${x(i)}%`, top: `${y(v)}%`, background: s.color!, transform: `translate(-50%, -50%) scale(${hover === i ? 1.25 : 1})` }}
                  />
                ),
              ),
            )}
          {/* A column per label catches the pointer. */}
          <div className="absolute inset-0 flex">
            {columns.map((c, i) => (
              <div key={c.label} className="h-full flex-1" onPointerEnter={() => setHover(i)} />
            ))}
          </div>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-card border border-line bg-surface px-3 py-2 text-xs shadow-floating"
              style={x(hover) > 60 ? { right: `${100 - x(hover) + 2}%` } : { left: `${x(hover) + 2}%` }}
            >
              <p className="mb-1 font-semibold text-fg">{labelText(columns[hover]!.label)}</p>
              {series.map((s) => (
                <p key={s.id} className="flex items-center gap-2 whitespace-nowrap text-fg-secondary">
                  <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color ?? "var(--cn-fg-subtle)" }} />
                  <span className="flex-1">{s.name}</span>
                  <span className="tabular-nums text-fg">
                    {s.values[hover] === null ? "no notes" : format(s.values[hover]!)}
                    {s.details?.[hover] && <span className="text-fg-muted"> {s.details[hover]}</span>}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="ml-10 flex">
        {columns.map((c) => (
          <div key={c.label} className="flex-1 px-1 text-center">
            <p className="text-xs font-semibold leading-tight text-fg-secondary">{labelText(c.label)}</p>
            <p className="text-[10px] text-fg-muted">{c.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
