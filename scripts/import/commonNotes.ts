import type { SupabaseClient } from "@supabase/supabase-js";
import { noteStatus } from "../../src/core/noteScore";
import { fetchAllRows, fetchRowsIn, sourceClient, upsertRows } from "./db";

/* The CommonNotes tab: every note on commonnotes.net, with its claim, post,
 * creator and sources, copied from cn-return-bot's everything_* tables with
 * their original column names. */

type SourceNote = {
  id: string;
  claim_id: string;
  note: string;
  author_id: string | null;
  author_name: string | null;
  improved_from_note_id: string | null;
  status: string;
  created_at: string;
  helpful_count: number | null;
  somewhat_helpful_count: number | null;
  not_helpful_count: number | null;
  p_helpful: number | null;
};

/** The notes the Claude note writer wrote. */
async function claudeNoteIds(source: SupabaseClient): Promise<Set<string>> {
  const drafts = await fetchAllRows<{ id: string; note_id: string | null }>(source, "everything_claude_drafts", "id, note_id", "id");
  return new Set(drafts.flatMap((d) => (d.note_id ? [d.note_id] : [])));
}

/** Who wrote a note, as cn-return-bot's notewriter_field_rows decides it
 *  (migration 159): the Claude note writer when a Claude draft points at the
 *  note, a reader when the note has an author, and the pipeline otherwise. */
const writerOf = (note: SourceNote, claudeNotes: Set<string>) => (claudeNotes.has(note.id) ? "claude" : note.author_id ? "reader" : "pipeline");

/** How many devices outside the team showed each post's notes, from the
 *  database function the website's feed uses. */
async function itemViews(source: SupabaseClient): Promise<Map<string, number>> {
  const { data, error } = await source.rpc("everything_item_views");
  if (error) throw new Error(`Reading item views failed: ${error.message}`);
  const views = data as { item_ids: string[]; viewers: number[] };
  return new Map(views.item_ids.map((id, i) => [id, Number(views.viewers[i])]));
}

function noteRow(note: SourceNote, claudeNotes: Set<string>) {
  const counts = {
    helpful_count: note.helpful_count ?? 0,
    somewhat_helpful_count: note.somewhat_helpful_count ?? 0,
    not_helpful_count: note.not_helpful_count ?? 0,
  };
  return {
    ...note,
    ...counts,
    rating_status: noteStatus({ ...counts, author_id: note.author_id }),
    writer: writerOf(note, claudeNotes),
  };
}

/** Copies the commonnotes.net notes. cn-return-bot's everything_notes also
 *  mirrors our X notes, which have no claim. Those belong to the X tab and
 *  are left out, so the copy starts from the notes that have a claim and
 *  takes only the claims, posts and sources those notes need. */
export async function importCommonNotes(): Promise<void> {
  const source = await sourceClient();
  const views = await itemViews(source);
  const claudeNotes = await claudeNoteIds(source);

  const notes = await fetchAllRows<SourceNote>(source, "everything_notes",
    "id, claim_id, note, author_id, author_name, improved_from_note_id, status, created_at, helpful_count, somewhat_helpful_count, not_helpful_count, p_helpful", "id", "claim_id");
  const claims = await fetchRowsIn<{ id: string; item_id: string }>(source, "everything_claims",
    "id, item_id, claim, context_quote, context_paragraph, context_url, image_urls, updated_quote, start_seconds, end_seconds", "id", [...new Set(notes.map((n) => n.claim_id))]);
  const items = await fetchRowsIn<{ id: string; project_id: string | null }>(source, "everything_items",
    "id, project_id, source, url, title, published_at, created_at", "id", [...new Set(claims.map((c) => c.item_id))]);
  const projects = await fetchAllRows(source, "everything_projects", "id, slug, name, feed_url, avatar_url", "id");
  const noteIds = new Set(notes.map((n) => n.id));
  const sources = (await fetchAllRows<{ note_id: string }>(source, "everything_note_sources", "id, note_id, url, quote, explanation, sort_order", "id"))
    .filter((s) => noteIds.has(s.note_id));

  await upsertRows("cn_projects", projects, "id");
  await upsertRows("cn_items", items.map((item) => ({ ...item, views: views.get(item.id) ?? 0 })), "id");
  await upsertRows("cn_claims", claims, "id");
  await upsertRows("cn_notes", notes.map((note) => noteRow(note, claudeNotes)), "id");
  await upsertRows("cn_note_sources", sources, "id");
  console.log(`[commonnotes] ${projects.length} projects, ${items.length} items, ${claims.length} claims, ${notes.length} notes, ${sources.length} sources`);
}
