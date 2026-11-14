import type { AiReview } from "@cn/core/taste";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";

const RECOMMENDATION = {
  taste_failure: { label: "Taste failure", tone: "border-transparent bg-negative-selected text-negative-selected-fg" },
  fine: { label: "No taste failure", tone: "border-transparent bg-positive-selected text-positive-selected-fg" },
} as const;

/** The AI reviewer's explanation of what is going on, when it gave one, and
 *  the verdict it recommends with its labels and reasons. It sits beside the
 *  note's card, so the card itself shows only the note and the reader's own
 *  verdict. */
export function AiReviewPanel({ review }: { review: AiReview }) {
  const { label, tone } = RECOMMENDATION[review.recommendation];
  return (
    <section aria-label="AI review" className="rounded-card border border-line bg-surface-muted p-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-secondary">AI review</h3>
        <span className="text-xs text-fg-muted">{review.model}</span>
      </div>
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
    </section>
  );
}
