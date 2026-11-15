import type { ReactNode } from "react";
import type { Accuracy, NeedsNote, Verdict } from "@cn/core/taste";
import { eyebrowVariants } from "@cn/ui/typography";
import { missingAnswers, missingText } from "./completeness";
import { LabelGuide } from "./LabelGuide";
import { AccuracyPills, NeedsNotePills, VerdictPills } from "./VerdictPills";

/** A small amber dot beside something the labeller still has to do. */
function MissingDot() {
  return (
    <>
      <span className="inline-block size-1.5 shrink-0 rounded-full bg-caution-solid" aria-hidden />
      <span className="sr-only">(not answered yet)</span>
    </>
  );
}

/** One question of the review: its name above its pills. An unanswered
 *  question has a dot beside its name. */
function Question({ name, missing, children }: { name: string; missing: boolean; children: ReactNode }) {
  return (
    <div className="py-2.5 first:pt-0 last:pb-0">
      <dt className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-fg-secondary">
        {name}
        {missing && <MissingDot />}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The labeller's own answers about a note, in a box of its own beside the
 *  note's card: whether the post needs a note at all, the accuracy, the taste
 *  verdict and, in `children`, the labels. A rule separates each question.
 *
 *  Until every question has an answer, and a taste failure has a label, a
 *  line at the top says the review is unfinished and names what is missing,
 *  and each unanswered question has a dot. A finished review says Done. */
export function ReviewSection({ needsNote, accuracy, verdict, labelCount, onNeedsNote, onAccuracy, onVerdict, children }: {
  needsNote: NeedsNote | null;
  accuracy: Accuracy | null;
  verdict: Verdict | null;
  labelCount: number;
  onNeedsNote: (needsNote: NeedsNote | null) => Promise<void>;
  onAccuracy: (accuracy: Accuracy | null) => Promise<void>;
  onVerdict: (verdict: Verdict | null) => Promise<void>;
  children?: ReactNode;
}) {
  const missing = missingAnswers({ needsNote, accuracy, verdict, labelCount });
  return (
    <section aria-label="Your review" className="rounded-card border border-line bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className={eyebrowVariants()}>Your review</h3>
        {missing.length === 0 && <span className="text-xs text-fg-muted">Done</span>}
      </div>
      {missing.length > 0 && (
        <p className="mt-1.5 rounded-control bg-caution-soft px-2 py-1 text-xs text-caution-selected-fg">
          <span className="font-semibold">Unfinished:</span> {missingText(missing)}
        </p>
      )}
      <dl className="mt-2 divide-y divide-line">
        <Question name="Needs a community note?" missing={missing.includes("needsNote")}>
          <NeedsNotePills needsNote={needsNote} onChange={onNeedsNote} />
        </Question>
        <Question name="Accurate?" missing={missing.includes("accuracy")}>
          <AccuracyPills accuracy={accuracy} onChange={onAccuracy} />
        </Question>
        <Question name="Taste failure?" missing={missing.includes("verdict")}>
          <VerdictPills verdict={verdict} onChange={onVerdict} />
        </Question>
      </dl>
      {children && (
        <div className="mt-2.5 border-t border-line pt-0.5">
          {children}
          {missing.includes("label") && (
            <p className="mt-1.5 flex items-center justify-end gap-1.5 text-xs text-caution">
              <MissingDot />
              Add a label to say what kind of taste failure
            </p>
          )}
          <LabelGuide />
        </div>
      )}
    </section>
  );
}
