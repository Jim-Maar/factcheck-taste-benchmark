import { useState } from "react";
import { humanizeTagName } from "@cn/core/ratingReasons";
import type { XNote } from "@cn/core/taste";
import { LabelRow } from "@cn/features/notes/LabelRow";
import { RatingPanel, StatusBadge } from "@cn/features/notes/NoteBox";
import { hasNoteSide, NoteSide } from "@cn/features/notes/NoteSide";
import { useLabelling } from "@cn/features/notes/useLabelling";
import { AccuracyPills, VerdictPills } from "@cn/features/notes/VerdictPills";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";
import { communityNoteUrl } from "@cn/shared/communityNoteUrl";
import { LinkifiedText } from "@cn/shared/LinkifiedText";
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

/** What the notewriter answered when it wrote the note, in one quiet line. */
function WriterAnswers({ answers }: { answers: XNote["writerAnswers"] }) {
  const parts = [
    answers.classification === "NOT_MISLEADING" ? "Post not misleading" : answers.classification ? "Post misleading" : null,
    ...answers.reasons.map((reason) => VALUE_NAMES.writer_reasons!(reason)),
    answers.mediaNote ? "Media note" : null,
    answers.collaborativeNote ? "Collaborative note" : null,
  ].filter((part): part is string => !!part);
  if (parts.length === 0) return null;
  return <p className="mt-2 text-xs text-fg-muted">Writer's answers: {parts.join(" · ")}</p>;
}

/** The other notes on the same post, behind a toggle, each with its status. */
function OtherNotes({ notes }: { notes: XNote["otherNotes"] }) {
  const [open, setOpen] = useState(false);
  if (notes.length === 0) return null;
  const helpful = notes.filter((note) => note.status === "helpful").length;
  return (
    <div className="mt-3">
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

/** One AI notewriter's note on X in the website's note style: the post on
 *  top, then the note with X's status line and the ratings from X's public
 *  data, then the verdict and the labels. Adapted from commonnotes.net's X
 *  notewriter page. */
function XNoteBody({ note, onAddComment }: { note: XNote; onAddComment?: () => void }) {
  const { setVerdict, setAccuracy } = useLabelling("x");
  const written = new Date(note.written).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <Card className="mx-auto w-full max-w-[40rem] p-4 xl:mx-0 xl:max-w-none">
      <div className="mb-4">
        <XPostCard post={note.post} />
      </div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <StatusBadge status={note.status} />
        <span className="shrink-0 text-xs text-fg-muted" title={`Author id ${note.notewriter.id}`}>
          {note.notewriter.name} · {written}
        </span>
      </div>
      <LinkifiedText className="text-sm text-fg whitespace-pre-wrap [overflow-wrap:anywhere]" linkClassName="text-link hover:underline break-all" text={note.noteText} />
      <WriterAnswers answers={note.writerAnswers} />
      <RatingPanel
        question={
          <a href={communityNoteUrl(note.noteId)} target="_blank" rel="noreferrer" className="font-semibold text-link hover:underline">
            The note on X ↗
          </a>
        }
      >
        <XRatings ratings={note.ratings} />
      </RatingPanel>
      <OtherNotes notes={note.otherNotes} />
      <RatingPanel question={<span className="font-semibold">Accurate?</span>}>
        <AccuracyPills accuracy={note.accuracy} onChange={(accuracy) => setAccuracy(note.noteId, accuracy)} />
      </RatingPanel>
      <RatingPanel question={<span className="font-semibold">Taste failure?</span>}>
        <VerdictPills verdict={note.verdict} onChange={(verdict) => setVerdict(note.noteId, verdict)} />
      </RatingPanel>
      <LabelRow source="x" noteId={note.noteId} labels={note.labels} onAddComment={onAddComment} />
    </Card>
  );
}

/** The note's card, and beside it on a wide screen, or below it on a narrow
 *  one, the AI review and the comment. Every card keeps the same column,
 *  whether it has anything beside it or not, so the cards line up. */
export function XNoteCard({ note }: { note: XNote }) {
  const [commentOpen, setCommentOpen] = useState(false);
  return (
    <div className="items-start space-y-4 xl:grid xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] xl:gap-4 xl:space-y-0">
      <XNoteBody note={note} onAddComment={note.comment || commentOpen ? undefined : () => setCommentOpen(true)} />
      {hasNoteSide(note, commentOpen) && (
        <NoteSide source="x" noteId={note.noteId} card={note} commentOpen={commentOpen} onCommentClosed={() => setCommentOpen(false)} className="mx-auto w-full max-w-[40rem] xl:mx-0 xl:max-w-none" />
      )}
    </div>
  );
}
