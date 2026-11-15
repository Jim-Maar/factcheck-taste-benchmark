import { useState } from "react";
import { humanizeTagName } from "@cn/core/ratingReasons";
import type { XNote } from "@cn/core/taste";
import { LabelRow } from "@cn/features/notes/LabelRow";
import { StatusBadge } from "@cn/features/notes/NoteBox";
import { NoteSide } from "@cn/features/notes/NoteSide";
import { ReviewSection } from "@cn/features/notes/ReviewSection";
import { useLabelling } from "@cn/features/notes/useLabelling";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";
import { communityNoteUrl } from "@cn/shared/communityNoteUrl";
import { LinkifiedText } from "@cn/shared/LinkifiedText";
import { eyebrowVariants } from "@cn/ui/typography";
import { VALUE_NAMES } from "../../noteFields";
import { XPostCard } from "./XPostCard";

type Ratings = XNote["ratings"];
type Side = "helpful" | "notHelpful";

const SIDES = {
  helpful: { label: "Helpful", tone: "border-transparent bg-positive-selected text-positive-selected-fg" },
  notHelpful: { label: "Not helpful", tone: "border-transparent bg-negative-selected text-negative-selected-fg" },
} as const;

/** The ratings X's raters gave, read-only, as the website's rating pills look
 *  once chosen. A click on Helpful or Not helpful lists the reasons the raters
 *  of that side gave. A second click closes the list. Somewhat helpful counts
 *  as helpful on X and has no reasons of its own. */
function XRatings({ ratings }: { ratings: Ratings }) {
  const [open, setOpen] = useState<Side | null>(null);
  const reasons = open === "helpful" ? ratings.helpfulReasons : open === "notHelpful" ? ratings.notHelpfulReasons : {};
  const counts: Record<Side, number> = { helpful: ratings.helpful, notHelpful: ratings.notHelpful };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-fg-muted">X ratings</span>
        {(["helpful", "notHelpful"] as const).map((side) => (
          <button
            key={side}
            type="button"
            aria-expanded={open === side}
            onClick={() => setOpen(open === side ? null : side)}
            className={cn(chipVariants(), SIDES[side].tone, open === side && "ring-2 ring-focus")}
          >
            {SIDES[side].label} {counts[side]}
          </button>
        ))}
        {ratings.somewhatHelpful > 0 && <span className={cn(chipVariants(), "border-transparent bg-caution-selected text-caution-selected-fg")}>Somewhat {ratings.somewhatHelpful}</span>}
      </div>
      {open && (
        <ul className="flex flex-wrap gap-1.5">
          {Object.entries(reasons)
            .filter(([, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([reason, count]) => (
              <li key={reason} className={cn(chipVariants(), "border-line font-medium text-fg-secondary")}>
                {humanizeTagName(reason)} <span className="font-semibold">{count}</span>
              </li>
            ))}
          {Object.values(reasons).every((count) => count === 0) && <li className="text-xs text-fg-muted">The raters gave no reasons.</li>}
        </ul>
      )}
    </div>
  );
}

/** What the notewriter answered when it wrote the note, as quiet chips. */
function WriterAnswers({ answers }: { answers: XNote["writerAnswers"] }) {
  const parts = [
    answers.classification === "NOT_MISLEADING" ? "Post not misleading" : answers.classification ? "Post misleading" : null,
    ...answers.reasons.map((reason) => VALUE_NAMES.writer_reasons!(reason)),
    answers.mediaNote ? "Media note" : null,
    answers.collaborativeNote ? "Collaborative note" : null,
  ].filter((part): part is string => !!part);
  if (parts.length === 0) return null;
  return (
    <ul className="contents" aria-label="What the writer answered">
      {parts.map((part) => (
        <li key={part} title="What the notewriter answered when writing the note" className="inline-flex h-6 items-center rounded-full border border-line px-2 text-xs text-fg-muted">
          {part}
        </li>
      ))}
    </ul>
  );
}

/** The other notes on the same post, behind a toggle, each with its status. */
function OtherNotes({ notes }: { notes: XNote["otherNotes"] }) {
  const [open, setOpen] = useState(false);
  if (notes.length === 0) return null;
  const helpful = notes.filter((note) => note.status === "helpful").length;
  return (
    <div className="mt-2">
      <Button variant="link" className="text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide" : "Show"} the {notes.length === 1 ? "other note" : `${notes.length} other notes`} on this post
        {helpful > 0 && ` (${helpful} rated helpful)`}
      </Button>
      {open && (
        <ul className="mt-2 space-y-3">
          {notes.map((note) => (
            <li key={note.noteId} className="rounded-card border border-line p-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <StatusBadge status={note.status} />
                <span className="text-xs text-fg-muted">{note.isAi ? "AI notewriter" : "Person"}</span>
              </div>
              <LinkifiedText className="text-sm text-fg whitespace-pre-wrap [overflow-wrap:anywhere]" linkClassName="text-link hover:underline break-all" text={note.text} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One AI notewriter's note on X: the post in its box, then the note under
 *  a Community Note heading with its status, writer, the writer's answers and
 *  X's ratings. Adapted from commonnotes.net's X notewriter page. */
function XNoteBody({ note }: { note: XNote }) {
  const written = new Date(note.written).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <Card className="mx-auto w-full max-w-[40rem] p-4 lg:mx-0 lg:max-w-none">
      <XPostCard post={note.post} />
      <section aria-label="Community Note" className="mt-4">
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
          <h3 className={eyebrowVariants()}>Community Note</h3>
          <a href={communityNoteUrl(note.noteId)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-link hover:underline">
            View on X ↗
          </a>
        </div>
        <div className="mb-2">
          <StatusBadge status={note.status} />
        </div>
        <LinkifiedText className="text-sm text-fg whitespace-pre-wrap [overflow-wrap:anywhere]" linkClassName="text-link hover:underline break-all" text={note.noteText} />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-fg-muted" title={`Author id ${note.notewriter.id}`}>
            {note.notewriter.name} · {written}
          </span>
          <WriterAnswers answers={note.writerAnswers} />
        </div>
        <div className="mt-3">
          <XRatings ratings={note.ratings} />
        </div>
        <OtherNotes notes={note.otherNotes} />
      </section>
    </Card>
  );
}

/** The note's card, and beside it on a wide screen, or below it on a narrow
 *  one, the labeller's review, the AI reviews and the comment. On a wide
 *  screen that column follows the window down as the reader scrolls, just
 *  below the site header (3.5rem), and stops at the bottom of the card's
 *  row; a column taller than the window scrolls inside itself. */
export function XNoteCard({ note }: { note: XNote }) {
  const { setVerdict, setAccuracy, setNeedsNote } = useLabelling("x");
  const [commentOpen, setCommentOpen] = useState(false);
  const review = (
    <ReviewSection
      needsNote={note.needsNote}
      accuracy={note.accuracy}
      verdict={note.verdict}
      onNeedsNote={(needsNote) => setNeedsNote(note.noteId, needsNote)}
      onAccuracy={(accuracy) => setAccuracy(note.noteId, accuracy)}
      onVerdict={(verdict) => setVerdict(note.noteId, verdict)}
    >
      <LabelRow source="x" noteId={note.noteId} labels={note.labels} onAddComment={note.comment || commentOpen ? undefined : () => setCommentOpen(true)} />
    </ReviewSection>
  );
  return (
    <div className="items-start space-y-4 lg:grid lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:gap-4 lg:space-y-0">
      <XNoteBody note={note} />
      <NoteSide
        review={review}
        source="x"
        noteId={note.noteId}
        card={note}
        commentOpen={commentOpen}
        onCommentClosed={() => setCommentOpen(false)}
        className="mx-auto w-full max-w-[40rem] lg:sticky lg:top-[4.5rem] lg:mx-0 lg:max-h-[calc(100vh-5.5rem)] lg:max-w-none lg:overflow-y-auto"
      />
    </div>
  );
}
