import { useState } from "react";
import type { Split, SplitPart } from "@cn/core/summary";
import { labelText } from "./RadarChart";

/** The colour of each part: the commonest labels take the compare hues in
 *  order, so a label keeps its colour in every judge's bar. */
function partStyle(part: SplitPart, labelSlot: Map<string, number>): { background: string; ink: string } {
  if (part.kind === "label") {
    const slot = labelSlot.get(part.label)! + 1;
    return { background: `var(--cn-compare-${slot})`, ink: slot === 4 ? "#0b0b0b" : "#ffffff" };
  }
  if (part.kind === "other") return { background: "var(--cn-compare-7)", ink: "#ffffff" };
  if (part.kind === "unsure")
    return { background: "repeating-linear-gradient(45deg, var(--cn-compare-rest) 0 2px, transparent 2px 6px)", ink: "var(--cn-fg-secondary)" };
  return { background: "var(--cn-compare-rest)", ink: "var(--cn-fg)" };
}

export function partName(part: SplitPart): string {
  if (part.kind === "label") return labelText(part.label);
  if (part.kind === "other") return "Other or unlabelled failure";
  if (part.kind === "unsure") return "Somewhat or unsure";
  return "Fine";
}

const pct = (n: number, of: number) => `${Math.round((100 * n) / of)}%`;

/** One tall split bar per judge, so the labellers and the models can be read
 *  against each other: the failures from the left, by label, then the notes
 *  they were unsure of, then the fine ones. Hovering a part names it below
 *  the bar; a legend names every part. */
export function SplitBars({ splits, labels }: { splits: Split[]; labels: string[] }) {
  const [hover, setHover] = useState<{ judge: string; index: number } | null>(null);
  const labelSlot = new Map(labels.map((l, i) => [l, i]));
  const legend: SplitPart[] = [
    ...labels.map((label) => ({ kind: "label" as const, label })),
    { kind: "other" },
    { kind: "unsure" },
    { kind: "fine" },
  ];
  const failed = (s: Split) => s.parts.filter((p) => p.part.kind === "label" || p.part.kind === "other").reduce((n, p) => n + p.notes, 0);
  return (
    <div className="space-y-5">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
        {legend.map((part) => (
          <li key={partName(part)} className="flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[3px]" style={{ background: partStyle(part, labelSlot).background }} />
            {partName(part)}
          </li>
        ))}
      </ul>
      {splits.map((split) => {
        const shown = hover?.judge === split.judge ? split.parts[hover.index] : undefined;
        return (
          <div key={split.judge} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-semibold text-fg">{split.judge}</span>
              <span className="text-xs tabular-nums text-fg-muted">
                {split.notes ? `${pct(failed(split), split.notes)} taste failures · ${split.notes} notes` : "no notes"}
              </span>
            </div>
            <div className="flex h-7 gap-0.5" onPointerLeave={() => setHover(null)}>
              {split.parts.map((p, index) => {
                const style = partStyle(p.part, labelSlot);
                const share = p.notes / split.notes;
                return (
                  <div
                    key={index}
                    onPointerEnter={() => setHover({ judge: split.judge, index })}
                    className="flex min-w-0 items-center overflow-visible rounded-[4px] px-1.5 text-[11px] font-semibold tabular-nums transition-opacity"
                    style={{
                      flexGrow: p.notes,
                      flexBasis: 0,
                      background: style.background,
                      color: style.ink,
                      opacity: shown && shown !== p ? 0.45 : 1,
                    }}
                  >
                    {/* The share inside, only where it fits. */}
                    {share >= 0.07 && pct(p.notes, split.notes)}
                  </div>
                );
              })}
            </div>
            <p className="h-4 text-xs text-fg-secondary">
              {shown && (
                <>
                  <span className="font-semibold text-fg">{partName(shown.part)}</span>: {shown.notes} of {split.notes} notes ({pct(shown.notes, split.notes)})
                </>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
