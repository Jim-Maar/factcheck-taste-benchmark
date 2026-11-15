import { useState } from "react";
import type { Score } from "@cn/core/summary";

export interface RadarSeries {
  id: string;
  name: string;
  /** A CSS colour, or null for the gray reference outline. */
  color: string | null;
  scores: Score[];
}

const SIZE = 360;
const CENTER = SIZE / 2;
const RADIUS = 118;
const RINGS = [0.25, 0.5, 0.75, 1];
/** Room either side for the axis labels, which run sideways. */
const GUTTER = 110;

/** The outer ring: the smallest of these that holds every value, so small
 *  shares don't bunch up at the centre. */
const SCALES = [0.2, 0.5, 1];

/** A label as stored ("missed-joke") as a reader sees it ("Missed joke"). */
export const labelText = (label: string) => {
  const text = label.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const pct = (share: number | null) => (share === null ? "no notes" : `${Math.round(share * 100)}%`);

/** A radar of shares from 0 to 100%, one spoke per axis, one outline per
 *  series. Hovering near a spoke shows every series' value there. Needs at
 *  least three axes to make a shape. The outer ring is the smallest of
 *  SCALES that holds every value. */
export function RadarChart({ axes, series, label }: { axes: { label: string; notes: number }[]; series: RadarSeries[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const n = axes.length;
  const top = Math.max(0, ...series.flatMap((s) => s.scores.map((x) => x.share ?? 0)));
  const scale = SCALES.find((s) => s >= top) ?? 1;
  const angle = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n;
  const point = (i: number, r: number) => [CENTER + Math.cos(angle(i)) * r, CENTER + Math.sin(angle(i)) * r] as const;
  const ring = (r: number) => axes.map((_, i) => point(i, r).join(",")).join(" ");
  const shape = (scores: Score[]) => scores.map((s, i) => point(i, (RADIUS * (s.share ?? 0)) / scale).join(",")).join(" ");

  return (
    <div className="relative">
      <svg viewBox={`${-GUTTER} 0 ${SIZE + 2 * GUTTER} ${SIZE}`} role="img" aria-label={label} className="mx-auto block w-full max-w-[36rem] overflow-visible">
        {RINGS.map((r) => (
          <polygon key={r} points={ring(RADIUS * r)} fill="none" stroke="var(--cn-line)" strokeWidth={1} />
        ))}
        {axes.map((_, i) => {
          const [x, y] = point(i, RADIUS);
          return <line key={i} x1={CENTER} y1={CENTER} x2={x} y2={y} stroke={hover === i ? "var(--cn-line-strong)" : "var(--cn-line)"} strokeWidth={hover === i ? 2 : 1} />;
        })}
        {[0.5, 1].map((r) => (
          <text key={r} x={CENTER + 4} y={CENTER - RADIUS * r + 11} fontSize={10} fill="var(--cn-fg-muted)">
            {Math.round(r * scale * 100)}%
          </text>
        ))}
        {series.map((s) => (
          <polygon
            key={s.id}
            points={shape(s.scores)}
            fill={s.color ?? "none"}
            fillOpacity={0.1}
            stroke={s.color ?? "var(--cn-fg-subtle)"}
            strokeWidth={2}
            strokeDasharray={s.color ? undefined : "4 4"}
            strokeLinejoin="round"
          />
        ))}
        {series
          .filter((s) => s.color)
          .map((s) =>
            s.scores.map((score, i) => {
              if (score.share === null) return null;
              const [x, y] = point(i, (RADIUS * score.share) / scale);
              return <circle key={`${s.id}-${i}`} cx={x} cy={y} r={hover === i ? 5 : 4} fill={s.color!} stroke="var(--cn-surface)" strokeWidth={2} />;
            }),
          )}
        {axes.map((axis, i) => {
          const [x, y] = point(i, RADIUS + 16);
          const cos = Math.cos(angle(i));
          const anchor = Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end";
          const dy = Math.sin(angle(i)) < -0.5 ? -14 : Math.sin(angle(i)) > 0.5 ? 6 : -4;
          return (
            <text key={axis.label} x={x} y={y + dy} textAnchor={anchor} fontSize={12} fill={hover === i ? "var(--cn-fg)" : "var(--cn-fg-secondary)"}>
              <tspan x={x} dy="0.71em" fontWeight={600}>
                {labelText(axis.label)}
              </tspan>
              <tspan x={x} dy="1.2em" fontSize={10} fill="var(--cn-fg-muted)">
                {axis.notes} {axis.notes === 1 ? "note" : "notes"}
              </tspan>
            </text>
          );
        })}
        {/* A wedge around each spoke catches the pointer. */}
        {axes.map((_, i) => {
          const half = Math.PI / n;
          const a = angle(i);
          const r = RADIUS + 30;
          const p1 = [CENTER + Math.cos(a - half) * r, CENTER + Math.sin(a - half) * r];
          const p2 = [CENTER + Math.cos(a + half) * r, CENTER + Math.sin(a + half) * r];
          return (
            <path
              key={i}
              d={`M${CENTER},${CENTER} L${p1.join(",")} A${r},${r} 0 0 1 ${p2.join(",")} Z`}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((h) => (h === i ? null : h))}
            />
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-card border border-line bg-surface px-3 py-2 text-xs shadow-floating">
          <p className="mb-1 font-semibold text-fg">{labelText(axes[hover]!.label)}</p>
          {series.map((s) => (
            <p key={s.id} className="flex items-center gap-2 text-fg-secondary">
              <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: s.color ?? "var(--cn-fg-subtle)" }} />
              <span className="flex-1">{s.name}</span>
              <span className="tabular-nums text-fg">
                {pct(s.scores[hover]!.share)}
                {s.scores[hover]!.of ? <span className="text-fg-muted"> ({s.scores[hover]!.hits}/{s.scores[hover]!.of})</span> : null}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
