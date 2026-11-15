import { useState } from "react";
import type { Score } from "@cn/core/summary";
import { labelText } from "@cn/core/summary";
import { wilson } from "@cn/core/agreement";

export interface BarSeries {
  id: string;
  name: string;
  color: string;
  scores: Score[];
}

const pct = (s: Score) => (s.share === null ? "no notes" : `${Math.round(s.share * 100)}%`);
/** The 95% Wilson interval of a score, as "20–90%". */
const interval = (s: Score) => {
  const [low, high] = wilson(s.hits, s.of);
  return `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
};

/** One row per label, one thin bar per series, as a share from 0 to 100%.
 *  Each bar ends in its value and count, so no number needs the colour to be
 *  read; hovering a row shows its numbers together. */
export function GroupedBars({ rows, series, label }: { rows: { label: string; notes: number }[]; series: BarSeries[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div role="figure" aria-label={label} className="space-y-1">
      {/* The scale, laid out like a row so its ticks sit on the gridlines. */}
      <div className="flex gap-3 text-[10px] tabular-nums text-fg-muted" aria-hidden>
        <div className="w-[min(40%,14rem)] shrink-0" />
        <div className="relative h-3 flex-1 mr-20">
          <span className="absolute left-0 -translate-x-1/2">0%</span>
          <span className="absolute left-1/2 -translate-x-1/2">50%</span>
          <span className="absolute left-full -translate-x-1/2">100%</span>
        </div>
      </div>
      {rows.map((row, r) => (
        <div
          key={row.label}
          className="relative flex items-center gap-3 rounded-control py-2 hover:bg-surface-hover"
          onPointerEnter={() => setHover(r)}
          onPointerLeave={() => setHover((h) => (h === r ? null : h))}
        >
          <div className="w-[min(40%,14rem)] shrink-0 pl-2 text-right">
            <p className="text-sm font-semibold text-fg">{labelText(row.label)}</p>
            <p className="text-xs text-fg-muted">
              {row.notes} hand-labelled {row.notes === 1 ? "note" : "notes"}
            </p>
          </div>
          <div className="relative flex-1 space-y-0.5 pr-20">
            {/* Gridlines at 0, 50 and 100%. */}
            <div className="pointer-events-none absolute inset-y-0 left-0 right-20 border-x border-line" aria-hidden>
              <div className="absolute inset-y-0 left-1/2 border-l border-line" />
            </div>
            {series.map((s) => {
              const score = s.scores[r]!;
              return (
                <div key={s.id} className="relative flex h-3 items-center">
                  {score.share !== null && score.share > 0 && (
                    <div className="h-2.5 rounded-r-[4px]" style={{ width: `${score.share * 100}%`, background: s.color }} />
                  )}
                  {score.share === 0 && <div className="h-2.5 w-0.5" style={{ background: s.color }} />}
                  <span className="absolute whitespace-nowrap pl-1.5 text-[11px] tabular-nums text-fg-secondary" style={{ left: `${(score.share ?? 0) * 100}%` }}>
                    {pct(score)}
                    {score.of > 0 && <span className="text-fg-muted"> {score.hits}/{score.of}</span>}
                  </span>
                </div>
              );
            })}
          </div>
          {hover === r && (
            <div className="pointer-events-none absolute right-2 top-full z-10 -mt-1 rounded-card border border-line bg-surface px-3 py-2 text-xs shadow-floating">
              <p className="mb-1 font-semibold text-fg">{labelText(row.label)}</p>
              {series.map((s) => (
                <p key={s.id} className="flex items-center gap-2 text-fg-secondary">
                  <span className="inline-block size-2 rounded-full" style={{ background: s.color }} />
                  <span className="flex-1">{s.name}</span>
                  <span className="tabular-nums text-fg">
                    {pct(s.scores[r]!)}
                    {s.scores[r]!.of > 0 && (
                      <span className="text-fg-muted">
                        {" "}
                        ({s.scores[r]!.hits} of {s.scores[r]!.of}, 95% CI {interval(s.scores[r]!)})
                      </span>
                    )}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
