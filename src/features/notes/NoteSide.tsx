import { useState } from "react";
import type { AiReview, NoteComment, Source } from "@cn/core/taste";
import { cn } from "@cn/ui/cn";
import { Textarea } from "@cn/ui/Field";
import { AiReviewPanel } from "./AiReviewPanel";
import { useLabelling } from "./useLabelling";

type SaveState = "idle" | "saving" | "failed";

const editedDate = (at: string) => new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The note's one comment, as a text field that every labeller can change.
 *  It saves when the field loses focus. Emptying the field removes the
 *  comment, and the box closes. */
function CommentBox({ source, noteId, comment, onClosed }: { source: Source; noteId: string; comment: NoteComment | null; onClosed: () => void }) {
  const { setComment } = useLabelling(source);
  const [draft, setDraft] = useState(comment?.text ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const save = async () => {
    const empty = !draft.trim();
    if (draft.trim() !== (comment?.text ?? "")) {
      setSaveState("saving");
      try {
        await setComment(noteId, draft);
      } catch {
        setSaveState("failed");
        return;
      }
      setSaveState("idle");
    }
    if (empty) onClosed();
  };
  const status = saveState === "saving" ? "Saving…" : saveState === "failed" ? "Not saved. Click outside the field to try again." : comment ? `Edited ${editedDate(comment.updatedAt)}` : "";
  return (
    <section aria-label="Comment" className="rounded-card border border-line bg-surface p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-fg-secondary">Comment</h3>
        <span className={cn("text-xs", saveState === "failed" ? "text-negative" : "text-fg-muted")}>{status}</span>
      </div>
      <Textarea
        autoGrow
        rows={2}
        value={draft}
        autoFocus={!comment}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        placeholder="A comment everyone can see and change"
        aria-label="Comment on this note"
      />
    </section>
  );
}

/** Whether a note's side column has anything to show. */
export const hasNoteSide = (card: { ai: AiReview[]; comment: NoteComment | null }, commentOpen: boolean) => card.ai.length > 0 || !!card.comment || commentOpen;

/** What sits beside a note's card: each model's AI review, and below it the note's
 *  comment once someone writes one or clicks Add comment. */
export function NoteSide({ source, noteId, card, commentOpen, onCommentClosed, className }: {
  source: Source;
  noteId: string;
  card: { ai: AiReview[]; comment: NoteComment | null };
  commentOpen: boolean;
  onCommentClosed: () => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4", className)}>
      {card.ai.map((review) => (
        <AiReviewPanel key={review.model} review={review} />
      ))}
      {(card.comment || commentOpen) && <CommentBox source={source} noteId={noteId} comment={card.comment} onClosed={onCommentClosed} />}
    </div>
  );
}
