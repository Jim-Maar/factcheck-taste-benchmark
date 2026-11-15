import type { ReactNode } from "react";
import type { Accuracy, NeedsNote, Verdict } from "@cn/core/taste";
import { eyebrowVariants } from "@cn/ui/typography";
import { AccuracyPills, NeedsNotePills, VerdictPills } from "./VerdictPills";

/** The labeller's own answers about a note, set apart from what the card
 *  shows about the note by a rule across the card: whether the post needs a
 *  note at all, the accuracy, the taste verdict and, in `children`, the labels. It sits at the bottom of a card
 *  with p-4 and runs out to its edges. */
/** sm:pt-2 centres the question's first line on a 36px pill. */
const QUESTION_CLASS = "text-sm font-semibold text-fg sm:max-w-[9rem] sm:pt-2";

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
    <section aria-label="Your review" className="-mx-4 mt-4 border-t border-line px-4 pt-3">
      <h3 className={eyebrowVariants()}>Your review</h3>
      {/* A question may wrap onto two lines, which leaves the pills room to
          stay on one line. Each question lines up with its first row of pills. */}
      <dl className="mt-2 grid items-start gap-x-4 gap-y-2 sm:grid-cols-[max-content_minmax(0,1fr)]">
        <dt className={QUESTION_CLASS}>Needs a community note?</dt>
        <dd>
          <NeedsNotePills needsNote={needsNote} onChange={onNeedsNote} />
        </dd>
        <dt className={QUESTION_CLASS}>Accurate?</dt>
        <dd>
          <AccuracyPills accuracy={accuracy} onChange={onAccuracy} />
        </dd>
        <dt className={QUESTION_CLASS}>Taste failure?</dt>
        <dd>
          <VerdictPills verdict={verdict} onChange={onVerdict} />
        </dd>
      </dl>
      {children}
    </section>
  );
}
