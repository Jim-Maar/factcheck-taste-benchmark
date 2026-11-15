import type { ReactNode } from "react";
import type { Accuracy, NeedsNote, Verdict } from "@cn/core/taste";
import { eyebrowVariants } from "@cn/ui/typography";
import { AccuracyPills, NeedsNotePills, VerdictPills } from "./VerdictPills";

/** One question of the review: its name above its pills. */
function Question({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <dt className="mb-1.5 text-xs font-semibold text-fg-secondary">{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The labeller's own answers about a note, in a box of its own beside the
 *  note's card: whether the post needs a note at all, the accuracy, the taste
 *  verdict and, in `children`, the labels. A rule separates each question. */
export function ReviewSection({ needsNote, accuracy, verdict, onNeedsNote, onAccuracy, onVerdict, children }: {
  needsNote: NeedsNote | null;
  accuracy: Accuracy | null;
  verdict: Verdict | null;
  onNeedsNote: (needsNote: NeedsNote | null) => Promise<void>;
  onAccuracy: (accuracy: Accuracy | null) => Promise<void>;
  onVerdict: (verdict: Verdict | null) => Promise<void>;
  children?: ReactNode;
}) {
  return (
    <section aria-label="Your review" className="rounded-card border border-line bg-surface p-3">
      <h3 className={eyebrowVariants()}>Your review</h3>
      <dl className="mt-2 divide-y divide-line">
        <Question name="Needs a community note?">
          <NeedsNotePills needsNote={needsNote} onChange={onNeedsNote} />
        </Question>
        <Question name="Accurate?">
          <AccuracyPills accuracy={accuracy} onChange={onAccuracy} />
        </Question>
        <Question name="Taste failure?">
          <VerdictPills verdict={verdict} onChange={onVerdict} />
        </Question>
      </dl>
      {children && <div className="mt-2.5 border-t border-line pt-0.5">{children}</div>}
    </section>
  );
}
