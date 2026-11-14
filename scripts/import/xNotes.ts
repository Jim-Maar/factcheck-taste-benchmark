import { readdirSync } from "fs";
import { join } from "path";
import { target, upsertRows } from "./db";
import { firstField, zipHeader, zipRows, type Row } from "./tsv";

/* The X tab's notes, from X's public Community Notes data only: every note by
 * an AI notewriter that is rated helpful or rated not helpful, with its
 * ratings, the raters' reasons and the other notes on the same post. */

const AI_AUTHOR_IDS_FILE = `${process.env.HOME}/dev/repos/cn-return-bot/datasets/big_eval/ai_author_ids.txt`;
const OUR_AUTHOR_ID = "813EB394B10809EBA8D09BCFA8E2E1C25A2DA0085186867F9E9C00696951C447";
const NOTEWRITER_NAME_ID_CHARS = 6;
const WRITER_REASON_PREFIXES = ["misleading", "notMisleading"];
/** The rating columns that look like reason tags but are not. */
const NON_TAG_RATING_COLUMNS = new Set(["helpful", "notHelpful", "helpfulnessLevel"]);

type Status = "helpful" | "not_helpful" | "needs_ratings";

interface StatusEntry {
  status: Status;
  ratedAt: string | null;
}

interface OtherNote {
  noteId: string;
  text: string;
  status: Status;
  isAi: boolean;
}

interface Ratings {
  helpful: number;
  somewhat: number;
  notHelpful: number;
  helpfulTags: Record<string, number>;
  notHelpfulTags: Record<string, number>;
}

const toStatus = (current: string): Status =>
  current === "CURRENTLY_RATED_HELPFUL" ? "helpful" : current === "CURRENTLY_RATED_NOT_HELPFUL" ? "not_helpful" : "needs_ratings";

const millisToIso = (millis: string): string | null => (millis && millis !== "-1" && millis !== "0" ? new Date(Number(millis)).toISOString() : null);

const dumpFiles = (dumpDir: string, prefix: string) =>
  readdirSync(dumpDir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".zip"))
    .sort()
    .map((name) => join(dumpDir, name));

async function loadAiAuthorIds(): Promise<Set<string>> {
  const text = await Bun.file(AI_AUTHOR_IDS_FILE).text();
  return new Set(text.split("\n").map((line) => line.trim()).filter(Boolean));
}

/** The notewriters, named by the start of their id. A name changed in the
 *  database stays, because existing rows are left alone. */
async function upsertNotewriters(authorIds: Set<string>): Promise<void> {
  const rows = [...authorIds].map((id) =>
    id === OUR_AUTHOR_ID
      ? { author_id: id, name: "Our notewriter", is_ours: true }
      : { author_id: id, name: `AI notewriter ${id.slice(0, NOTEWRITER_NAME_ID_CHARS)}`, is_ours: false },
  );
  await upsertRows("x_notewriters", rows, "author_id", true);
}

/** The status of every note that is not plain "needs more ratings", and for
 *  the AI notewriters' notes also when they were first rated. Storing only
 *  the decided notes keeps the map small. */
async function readStatuses(dumpDir: string, aiAuthors: Set<string>): Promise<Map<string, StatusEntry>> {
  const statuses = new Map<string, StatusEntry>();
  for (const file of dumpFiles(dumpDir, "noteStatusHistory")) {
    for await (const row of zipRows(file)) {
      const status = toStatus(row("currentStatus"));
      const isAi = aiAuthors.has(row("noteAuthorParticipantId"));
      if (status === "needs_ratings" && !isAi) continue;
      statuses.set(row("noteId"), { status, ratedAt: isAi ? millisToIso(row("timestampMillisOfFirstNonNMRStatus")) : null });
    }
  }
  return statuses;
}

/** The names of the writer's own answer columns that are ticked, such as
 *  misleadingFactualError. */
function writerReasons(row: Row, header: string[]): string[] {
  return header.filter((column) => WRITER_REASON_PREFIXES.some((prefix) => column.startsWith(prefix)) && row(column) === "1");
}

function noteRow(row: Row, header: string[], status: StatusEntry, dumpDate: string) {
  return {
    note_id: row("noteId"),
    tweet_id: row("tweetId"),
    author_id: row("noteAuthorParticipantId"),
    note_text: row("summary"),
    written: millisToIso(row("createdAtMillis")),
    status: status.status,
    rated_at: status.ratedAt,
    classification: row("classification") || null,
    writer_reasons: writerReasons(row, header),
    trustworthy_sources: row("trustworthySources") === "1",
    media_note: row("isMediaNote") === "1",
    collaborative_note: row("isCollaborativeNote") === "1",
    dump_date: dumpDate,
  };
}

type NoteRow = ReturnType<typeof noteRow>;

/** The note ids already copied. They stay in the tab even after X moves them
 *  back to needs more ratings, so their verdicts and labels stay too. */
async function existingNoteIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  const PAGE = 1000;
  let last = "";
  for (;;) {
    const { data, error } = await target.from("x_notes").select("note_id").gt("note_id", last).order("note_id").limit(PAGE);
    if (error) throw new Error(`Reading x_notes failed: ${error.message}`);
    for (const r of data) ids.add(r.note_id);
    if (data.length < PAGE) return ids;
    last = data.at(-1)!.note_id;
  }
}

/** The AI notewriters' rated notes, plus every note copied before. */
async function readKeptNotes(dumpDir: string, aiAuthors: Set<string>, statuses: Map<string, StatusEntry>, existing: Set<string>, dumpDate: string): Promise<NoteRow[]> {
  const kept: NoteRow[] = [];
  for (const file of dumpFiles(dumpDir, "notes-")) {
    const header = await zipHeader(file);
    for await (const row of zipRows(file)) {
      const noteId = row("noteId");
      if (!aiAuthors.has(row("noteAuthorParticipantId"))) continue;
      const status = statuses.get(noteId);
      const rated = status !== undefined && status.status !== "needs_ratings";
      if (!rated && !existing.has(noteId)) continue;
      kept.push(noteRow(row, header, status ?? { status: "needs_ratings", ratedAt: null }, dumpDate));
    }
  }
  return kept;
}

/** Every note on the given posts, by post. */
async function readNotesOnPosts(dumpDir: string, tweetIds: Set<string>, aiAuthors: Set<string>, statuses: Map<string, StatusEntry>): Promise<Map<string, OtherNote[]>> {
  const byTweet = new Map<string, OtherNote[]>();
  for (const file of dumpFiles(dumpDir, "notes-")) {
    for await (const row of zipRows(file)) {
      const tweetId = row("tweetId");
      if (!tweetIds.has(tweetId)) continue;
      const noteId = row("noteId");
      const note = { noteId, text: row("summary"), status: statuses.get(noteId)?.status ?? "needs_ratings", isAi: aiAuthors.has(row("noteAuthorParticipantId")) };
      if (!byTweet.has(tweetId)) byTweet.set(tweetId, []);
      byTweet.get(tweetId)!.push(note);
    }
  }
  return byTweet;
}

const emptyRatings = (): Ratings => ({ helpful: 0, somewhat: 0, notHelpful: 0, helpfulTags: {}, notHelpfulTags: {} });

/** A rating's level. Old ratings have no helpfulnessLevel and say it in the
 *  helpful and notHelpful columns instead. */
function ratingLevel(row: Row): "HELPFUL" | "SOMEWHAT_HELPFUL" | "NOT_HELPFUL" | null {
  const level = row("helpfulnessLevel");
  if (level === "HELPFUL" || level === "SOMEWHAT_HELPFUL" || level === "NOT_HELPFUL") return level;
  if (row("helpful") === "1") return "HELPFUL";
  if (row("notHelpful") === "1") return "NOT_HELPFUL";
  return null;
}

function countRating(ratings: Ratings, row: Row, helpfulTags: string[], notHelpfulTags: string[]): void {
  const level = ratingLevel(row);
  if (level === "HELPFUL") ratings.helpful++;
  if (level === "SOMEWHAT_HELPFUL") ratings.somewhat++;
  if (level === "NOT_HELPFUL") ratings.notHelpful++;
  // As in cn-return-bot's src/production/fill_ratings.py, every ticked tag
  // counts, whatever the level.
  for (const tag of helpfulTags) if (row(tag) === "1") ratings.helpfulTags[tag] = (ratings.helpfulTags[tag] ?? 0) + 1;
  for (const tag of notHelpfulTags) if (row(tag) === "1") ratings.notHelpfulTags[tag] = (ratings.notHelpfulTags[tag] ?? 0) + 1;
}

/** The ratings of the given notes, from every ratings file. Only rows of
 *  those notes are split into fields, which keeps the pass over hundreds of
 *  millions of rows fast. */
async function readRatings(dumpDir: string, noteIds: Set<string>): Promise<Map<string, Ratings>> {
  const ratings = new Map<string, Ratings>();
  for (const file of dumpFiles(dumpDir, "ratings-")) {
    const started = Date.now();
    const header = await zipHeader(file);
    const notHelpfulTags = header.filter((column) => column.startsWith("notHelpful") && !NON_TAG_RATING_COLUMNS.has(column));
    const helpfulTags = header.filter((column) => column.startsWith("helpful") && !NON_TAG_RATING_COLUMNS.has(column));
    for await (const row of zipRows(file, (line) => noteIds.has(firstField(line)))) {
      const noteId = row("noteId");
      if (!ratings.has(noteId)) ratings.set(noteId, emptyRatings());
      countRating(ratings.get(noteId)!, row, helpfulTags, notHelpfulTags);
    }
    console.log(`[x] ${file.split("/").at(-1)} read in ${Math.round((Date.now() - started) / 1000)}s`);
  }
  return ratings;
}

function withRatingsAndOthers(note: NoteRow, ratings: Ratings | undefined, notesOnPost: OtherNote[] | undefined) {
  const r = ratings ?? emptyRatings();
  return {
    ...note,
    helpful_ratings: r.helpful,
    somewhat_helpful_ratings: r.somewhat,
    not_helpful_ratings: r.notHelpful,
    helpful_tags: r.helpfulTags,
    not_helpful_tags: r.notHelpfulTags,
    other_notes: (notesOnPost ?? []).filter((other) => other.noteId !== note.note_id),
  };
}

/** Copies the X tab's notes from the public data in `dumpDir`, dated
 *  `dumpDate` (YYYY-MM-DD). */
export async function importXNotes(dumpDir: string, dumpDate: string): Promise<void> {
  const aiAuthors = await loadAiAuthorIds();
  await upsertNotewriters(aiAuthors);
  console.log(`[x] ${aiAuthors.size} AI notewriters`);

  const statuses = await readStatuses(dumpDir, aiAuthors);
  console.log(`[x] ${statuses.size} statuses read`);
  const existing = await existingNoteIds();
  const notes = await readKeptNotes(dumpDir, aiAuthors, statuses, existing, dumpDate);
  console.log(`[x] ${notes.length} notes kept (${existing.size} were already copied)`);

  const notesOnPosts = await readNotesOnPosts(dumpDir, new Set(notes.map((n) => n.tweet_id)), aiAuthors, statuses);
  const ratings = await readRatings(dumpDir, new Set(notes.map((n) => n.note_id)));
  console.log(`[x] ratings found for ${ratings.size} notes`);

  const rows = notes.map((note) => withRatingsAndOthers(note, ratings.get(note.note_id), notesOnPosts.get(note.tweet_id)));
  await upsertRows("x_notes", rows, "note_id");
  console.log(`[x] ${rows.length} notes written`);
}
