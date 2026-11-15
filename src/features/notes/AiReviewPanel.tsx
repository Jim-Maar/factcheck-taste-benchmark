import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { AiReview } from "@cn/core/taste";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";

const RECOMMENDATION = {
  taste_failure: { label: "Taste failure", tone: "border-transparent bg-negative-selected text-negative-selected-fg", dot: "bg-negative-solid" },
  fine: { label: "No taste failure", tone: "border-transparent bg-positive-selected text-positive-selected-fg", dot: "bg-positive-solid" },
} as const;

/** One AI reviewer's explanation of what is going on, when it gave one, and
 *  the verdict it recommends with its labels and reasons. */
function AiReviewBody({ review }: { review: AiReview }) {
  const { label, tone } = RECOMMENDATION[review.recommendation];
  return (
    <>
      {review.explanation && <p className="mb-3 text-sm text-fg whitespace-pre-wrap">{review.explanation}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-fg-secondary">AI recommends</span>
        <span className={cn(chipVariants(), tone)}>{label}</span>
        {review.labels.map((name) => (
          <span key={name} className={cn(chipVariants(), "border-line font-medium text-fg-secondary")}>
            {name}
          </span>
        ))}
      </div>
      <p className="mt-1 text-sm text-fg-secondary whitespace-pre-wrap">{review.reasoning}</p>
    </>
  );
}

/** Every model's AI review of a note, one tab per model. Each tab shows the
 *  model's name and a green or red dot for the verdict it recommends, so the
 *  models' verdicts can be compared without opening each tab. It sits beside
 *  the note's card, so the card itself shows only the note and the reader's
 *  own verdict. */
export function AiReviewPanel({ reviews }: { reviews: AiReview[] }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();
  // A review can arrive or go while the card is open, so the chosen model
  // falls back to the first one when it has no review any more.
  const index = Math.max(0, reviews.findIndex((review) => review.model === chosen));
  const review = reviews[index];
  if (!review) return null;
  const select = (next: number) => {
    const wrapped = (next + reviews.length) % reviews.length;
    setChosen(reviews[wrapped]?.model ?? null);
    tabRefs.current[wrapped]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    select(index + step);
  };
  return (
    <section aria-label="AI review" className="rounded-card border border-line bg-surface-muted">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 pt-2">
        <h3 className="text-xs font-semibold text-fg-secondary">AI review</h3>
        <div role="tablist" aria-label="AI reviewers" className="flex flex-wrap gap-1">
          {reviews.map((r, i) => {
            const active = i === index;
            const { label, dot } = RECOMMENDATION[r.recommendation];
            return (
              <button
                key={r.model}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${baseId}-tab-${i}`}
                aria-selected={active}
                aria-controls={`${baseId}-panel`}
                tabIndex={active ? 0 : -1}
                title={`${r.model} recommends: ${label}`}
                onClick={() => setChosen(r.model)}
                onKeyDown={onKeyDown}
                className={cn(
                  "-mb-px flex items-center gap-1.5 rounded-t-control border border-b-0 px-2.5 py-1.5 text-xs",
                  active ? "border-line bg-surface font-semibold text-fg" : "border-transparent text-fg-muted hover:text-fg",
                  focusRing,
                )}
              >
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", dot)} />
                {r.model}
              </button>
            );
          })}
        </div>
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${index}`} className="rounded-b-card bg-surface p-4">
        <AiReviewBody review={review} />
      </div>
    </section>
  );
}
