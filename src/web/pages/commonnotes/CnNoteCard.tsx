import { useState } from "react";
import type { CnNote } from "@cn/core/taste";
import type { ProjectHeader } from "@cn/core/types";
import { LabelRow } from "@cn/features/notes/LabelRow";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { NoteSide } from "@cn/features/notes/NoteSide";
import { ReviewSection } from "@cn/features/notes/ReviewSection";
import { useLabelling } from "@cn/features/notes/useLabelling";
import { Button } from "@cn/ui/Button";
import { QuoteIcon } from "@cn/ui/icons";
import { ClaimCard } from "../../components/ClaimCard";
import { ProjectAvatar } from "../../components/ProjectAvatar";

const ACTION_ICON_SIZE = "1.15em";
const TOUCH_TARGET = "[@media(pointer:coarse)]:min-h-10";
const COMMON_NOTES_URL = "https://commonnotes.net";

const WRITER_NAMES: Record<CnNote["writer"], string> = { pipeline: "Pipeline", claude: "Claude note writer", reader: "Reader" };

/** The note on commonnotes.net, where it can be seen in place. */
const noteUrl = (card: CnNote, project: ProjectHeader) => `${COMMON_NOTES_URL}/notes/${encodeURIComponent(project.slug)}/${encodeURIComponent(card.post.id)}?note=${encodeURIComponent(card.note.id)}`;

/** The creator a note belongs to, at the top of its card, as on the All notes
 *  page of commonnotes.net, with how many readers saw the notes on the post. */
function CreatorByline({ card }: { card: CnNote }) {
  const { project, views } = card;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {project && (
          <span className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary">
            <ProjectAvatar project={project} size={22} />
            {project.name}
          </span>
        )}
        <span className="text-sm text-fg-muted" title="Readers outside the team who were shown the notes on this post">
          {views === 1 ? "1 view" : `${views} views`}
        </span>
      </span>
      {project && (
        <a href={noteUrl(card, project)} target="_blank" rel="noreferrer" className="text-xs text-link hover:underline">
          On commonnotes.net ↗
        </a>
      )}
    </div>
  );
}

/** One note of commonnotes.net as its All notes page shows it: the claim in
 *  its post, the note with its status and sources and the website's votes.
 *  The labeller's review and the labels sit beside it with the AI reviews. */
export function CnNoteCard({ card }: { card: CnNote }) {
  const { setVerdict, setAccuracy, setNeedsNote } = useLabelling("commonnotes");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const { note } = card;
  const review = (
    <ReviewSection
      needsNote={card.needsNote}
      accuracy={card.accuracy}
      verdict={card.verdict}
      labelCount={card.labels.length}
      onNeedsNote={(needsNote) => setNeedsNote(note.id, needsNote)}
      onAccuracy={(accuracy) => setAccuracy(note.id, accuracy)}
      onVerdict={(verdict) => setVerdict(note.id, verdict)}
    >
      <LabelRow source="commonnotes" noteId={note.id} labels={card.labels} onAddComment={card.comment || commentOpen ? undefined : () => setCommentOpen(true)}>
        {note.has_source_details && (
          <Button variant="link" className={TOUCH_TARGET} aria-expanded={sourcesOpen} onClick={() => setSourcesOpen((open) => !open)}>
            <QuoteIcon size={ACTION_ICON_SIZE} aria-hidden /> Source details
          </Button>
        )}
      </LabelRow>
    </ReviewSection>
  );
  return (
    <ClaimCard
      id={`note-${note.id}`}
      claim={note.claim}
      paragraph={note.claim.context_paragraph}
      post={card.post}
      byline={<CreatorByline card={card} />}
      aside={<NoteSide review={review} source="commonnotes" noteId={note.id} card={card} commentOpen={commentOpen} onCommentClosed={() => setCommentOpen(false)} />}
    >
      <NoteBox note={note} status={card.ratingStatus} sourcesOpen={sourcesOpen} byline={`${WRITER_NAMES[card.writer]} · ${new Date(note.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`} />
      <p className="mt-2 text-xs text-fg-muted">
        Votes on commonnotes.net: {note.helpful_count} helpful, {note.somewhat_helpful_count} somewhat, {note.not_helpful_count} not helpful
        {card.pHelpful !== null && ` · ${Math.round(card.pHelpful * 100)}% chance of ending helpful`}
      </p>
    </ClaimCard>
  );
}
