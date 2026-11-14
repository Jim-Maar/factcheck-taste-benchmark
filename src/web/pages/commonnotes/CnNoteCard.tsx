import { useState } from "react";
import type { CnNote } from "@cn/core/taste";
import type { ProjectHeader } from "@cn/core/types";
import { AiReviewPanel } from "@cn/features/notes/AiReviewPanel";
import { LabelRow } from "@cn/features/notes/LabelRow";
import { NoteBox } from "@cn/features/notes/NoteBox";
import { useLabelling } from "@cn/features/notes/useLabelling";
import { VerdictPills } from "@cn/features/notes/VerdictPills";
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
 *  its post, the note with its status and sources, and in place of the rating
 *  pills the verdict, then the labels where the website has its actions. */
export function CnNoteCard({ card }: { card: CnNote }) {
  const { setVerdict } = useLabelling("commonnotes");
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const { note } = card;
  return (
    <ClaimCard id={`note-${note.id}`} claim={note.claim} paragraph={note.claim.context_paragraph} post={card.post} byline={<CreatorByline card={card} />}>
      <NoteBox note={note} status={card.ratingStatus} sourcesOpen={sourcesOpen} byline={`${WRITER_NAMES[card.writer]} · ${new Date(note.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`} question={<span className="font-semibold">Taste failure?</span>}>
        <VerdictPills verdict={card.verdict} onChange={(verdict) => setVerdict(note.id, verdict)} />
      </NoteBox>
      <p className="mt-2 text-xs text-fg-muted">
        Votes on commonnotes.net: {note.helpful_count} helpful, {note.somewhat_helpful_count} somewhat, {note.not_helpful_count} not helpful
        {card.pHelpful !== null && ` · ${Math.round(card.pHelpful * 100)}% chance of ending helpful`}
      </p>
      {card.ai && <AiReviewPanel review={card.ai} />}
      <LabelRow source="commonnotes" noteId={note.id} labels={card.labels}>
        {note.has_source_details && (
          <Button variant="link" className={TOUCH_TARGET} aria-expanded={sourcesOpen} onClick={() => setSourcesOpen((open) => !open)}>
            <QuoteIcon size={ACTION_ICON_SIZE} aria-hidden /> Source details
          </Button>
        )}
      </LabelRow>
    </ClaimCard>
  );
}
