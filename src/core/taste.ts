import type { QueryRequest } from "./fieldQuery";
import type { NoteStatus } from "./noteScore";
import { supabase } from "./supabase";
import type { FeedItemRow, NoteRow, NoteSourceDetail, ProjectHeader } from "./types";

/* Everything the two tabs read and write. Every list goes through the
 * database functions of supabase/migrations/003_pages.sql, and every verdict
 * and label is a row the shared login may write. */

/** Which tab: the AI notewriters' notes on X, or the notes on commonnotes.net. */
export type Source = "x" | "commonnotes";

export const NOTE_PAGE_SIZE = 10;

/** A note's verdict. A note nobody judged has none. */
export type Verdict = "taste_failure" | "fine";

export interface Label {
  id: number;
  name: string;
}

/** An AI reviewer's account of a note: what is going on in the post and the
 *  note, and the verdict it recommends with its reasons. */
export interface AiReview {
  explanation: string;
  recommendation: Verdict;
  reasoning: string;
  model: string;
  createdAt: string;
}

/** A photo, video or gif of a post, in the X API's shape. */
export interface XMedia {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: { url: string; bit_rate?: number; content_type: string }[];
}

/** The one comment on a note, which every labeller can change. */
export interface NoteComment {
  text: string;
  updatedAt: string;
}

/** One rated note of an AI notewriter on X, with the post it is on. */
export interface XNote {
  noteId: string;
  noteText: string;
  status: NoteStatus;
  written: string;
  notewriter: { id: string; name: string; isOurs: boolean };
  ratings: {
    helpful: number;
    somewhatHelpful: number;
    notHelpful: number;
    helpfulReasons: Record<string, number>;
    notHelpfulReasons: Record<string, number>;
  };
  /** What the notewriter answered when it wrote the note. */
  writerAnswers: {
    classification: string | null;
    reasons: string[];
    trustworthySources: boolean | null;
    mediaNote: boolean | null;
    collaborativeNote: boolean | null;
  };
  post: {
    id: string;
    /** Null until the import fetched the post, false when X no longer has it. */
    available: boolean | null;
    text: string | null;
    handle: string | null;
    name: string | null;
    postedAt: string | null;
    media: XMedia[];
    /** The post this one quotes or replies to. */
    referenced: { kind: "quoted" | "replied_to" | "retweeted" | null; text?: string | null; media?: XMedia[] } | null;
  };
  /** The other notes on the same post, by anyone. */
  otherNotes: { noteId: string; text: string; status: NoteStatus; isAi: boolean }[];
  verdict: Verdict | null;
  labels: Label[];
  ai: AiReview | null;
  comment: NoteComment | null;
}

/** One note of commonnotes.net, in the shapes the website's own card reads. */
export interface CnNote {
  note: NoteRow;
  ratingStatus: NoteStatus;
  pHelpful: number | null;
  writer: "pipeline" | "claude" | "reader";
  post: FeedItemRow;
  platform: string;
  views: number;
  project: ProjectHeader | null;
  verdict: Verdict | null;
  labels: Label[];
  ai: AiReview | null;
  comment: NoteComment | null;
}

export interface NoteCards {
  x: XNote;
  commonnotes: CnNote;
}

/** A card of either tab, with the sort key the next page starts after. The
 *  key's numbers stay text, because a JSON number would round them and the
 *  next page would then repeat or skip a card. */
export interface PagedCard<S extends Source> {
  noteId: string;
  sortKey: string[];
  card: NoteCards[S];
}

export interface NoteCursor {
  key: string[];
  id: string;
}

/** The request as the database functions take it: the filters and sorts of
 *  fieldQuery, plus the words of the search box. */
export type NoteRequest = QueryRequest & { search: string };

/** One page of the notes that pass the request, in its order, starting after
 *  `cursor`. */
export async function fetchNotePage<S extends Source>(source: S, request: NoteRequest, cursor: NoteCursor | null): Promise<PagedCard<S>[]> {
  const { data, error } = await supabase.rpc("note_page", {
    p_source: source,
    p_request: request,
    p_after_key: cursor?.key,
    p_after_id: cursor?.id,
    p_limit: NOTE_PAGE_SIZE,
  });
  if (error) throw error;
  return (data as { note_id: string; sort_key: string[]; card: NoteCards[S] }[]).map((row) => ({ noteId: row.note_id, sortKey: row.sort_key, card: row.card }));
}

export interface NoteSummary {
  notes: number;
  judged: number;
  tasteFailures: number;
}

export async function fetchNoteSummary(source: Source, request: NoteRequest): Promise<NoteSummary> {
  const { data, error } = await supabase.rpc("note_summary", { p_source: source, p_request: request }).single();
  if (error) throw error;
  const row = data as { notes: number; judged: number; taste_failures: number };
  return { notes: row.notes, judged: row.judged, tasteFailures: row.taste_failures };
}

/** A choice field to count values for, and the column with each value's
 *  display name when the values come from the data. */
export interface FacetRequest {
  column: string;
  labelColumn?: string;
}

/** How many notes each value of these choice fields would show under the
 *  request's other filters, by field. */
export async function fetchNoteFacets(source: Source, request: NoteRequest, facets: FacetRequest[]): Promise<Record<string, { value: string; label: string | null; count: number }[]>> {
  const { data, error } = await supabase.rpc("note_facets", {
    p_source: source,
    p_request: request,
    p_facets: facets.map((facet) => (facet.labelColumn ? { column: facet.column, label_column: facet.labelColumn } : { column: facet.column })),
  });
  if (error) throw error;
  const byField: Record<string, { value: string; label: string | null; count: number }[]> = {};
  for (const row of data as { field: string; value: string; label: string | null; notes: number }[]) {
    (byField[row.field] ??= []).push({ value: row.value, label: row.label, count: row.notes });
  }
  return byField;
}

/** The quotes behind a CommonNotes note's sources, for "Source details". */
export async function fetchNoteSourceDetails(noteId: string): Promise<NoteSourceDetail[]> {
  const { data, error } = await supabase.rpc("cn_source_details", { p_note_id: noteId });
  if (error) throw error;
  return data as NoteSourceDetail[];
}

export interface LabelUse extends Label {
  uses: number;
}

/** Every label, most used first. */
export async function fetchLabels(): Promise<LabelUse[]> {
  const { data, error } = await supabase.rpc("label_list");
  if (error) throw error;
  return (data as { id: number; name: string; uses: number }[]).map((row) => ({ id: row.id, name: row.name, uses: Number(row.uses) }));
}

/** Sets a note's verdict, or clears it with null. */
export async function saveVerdict(source: Source, noteId: string, verdict: Verdict | null): Promise<void> {
  const { error } = verdict
    ? await supabase.from("verdicts").upsert({ source, note_id: noteId, verdict, updated_at: new Date().toISOString() })
    : await supabase.from("verdicts").delete().match({ source, note_id: noteId });
  if (error) throw error;
}

/** Sets a note's comment, or removes it when the text is empty. Returns the
 *  comment as the card shows it. */
export async function saveComment(source: Source, noteId: string, text: string): Promise<NoteComment | null> {
  const comment = text.trim();
  if (!comment) {
    const { error } = await supabase.from("note_comments").delete().match({ source, note_id: noteId });
    if (error) throw error;
    return null;
  }
  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from("note_comments").upsert({ source, note_id: noteId, comment, updated_at: updatedAt });
  if (error) throw error;
  return { text: comment, updatedAt };
}

const UNIQUE_VIOLATION = "23505";

/** Creates a label. When a label of that name exists already, in any case,
 *  that label is returned instead. */
export async function createLabel(name: string): Promise<Label> {
  const trimmed = name.trim();
  const { data, error } = await supabase.from("labels").insert({ name: trimmed }).select("id, name").single();
  if (!error) return data as Label;
  if (error.code !== UNIQUE_VIOLATION) throw error;
  const existing = await supabase.from("labels").select("id, name").ilike("name", trimmed.replace(/[\\%_]/g, "\\$&")).single();
  if (existing.error) throw existing.error;
  return existing.data as Label;
}

interface AiReviewRow {
  source: Source;
  note_id: string;
  explanation: string;
  recommendation: Verdict;
  reasoning: string;
  model: string;
  created_at: string;
}

/** Calls `onReview` with every AI review of the tab that is written or
 *  rewritten from now on, as Supabase Realtime reports it. Returns the
 *  function that stops listening. */
export function watchAiReviews(source: Source, onReview: (noteId: string, review: AiReview) => void): () => void {
  const channel = supabase
    .channel(`ai-reviews-${source}`)
    .on<AiReviewRow>("postgres_changes", { event: "*", schema: "taste", table: "ai_reviews", filter: `source=eq.${source}` }, ({ new: row }) => {
      if (!("note_id" in row)) return;
      onReview(row.note_id, { explanation: row.explanation, recommendation: row.recommendation, reasoning: row.reasoning, model: row.model, createdAt: row.created_at });
    })
    .subscribe();
  return () => void supabase.removeChannel(channel);
}

export async function addNoteLabel(source: Source, noteId: string, labelId: number): Promise<void> {
  const { error } = await supabase.from("note_labels").upsert({ source, note_id: noteId, label_id: labelId }, { ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeNoteLabel(source: Source, noteId: string, labelId: number): Promise<void> {
  const { error } = await supabase.from("note_labels").delete().match({ source, note_id: noteId, label_id: labelId });
  if (error) throw error;
}
