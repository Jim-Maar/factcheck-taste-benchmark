import type { SummaryData } from "./summary";
import { supabase } from "./supabase";
import type { AiRecommendation, NeedsNote, Verdict } from "./taste";

/* Reads what the Summary tab shows. Kept apart from summary.ts, which only
 * works things out, so scripts can use those functions without the
 * browser's database client. */

/** Every row of a table, a thousand at a time, in the order of `order` (a
 *  unique key, so no row is skipped or read twice across pages); with
 *  `xOnly`, only the X tab's. */
async function all<T>(table: string, columns: string, order: string[], xOnly = false): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase.from(table).select(columns);
    if (xOnly) query = query.eq("source", "x");
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as unknown as T[]));
    if (data.length < 1000) return rows;
  }
}

interface ReviewRow {
  note_id: string;
  model: string;
  recommendation: AiRecommendation;
  labels: string[];
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | string | null;
  harness: string | null;
  created_at: string;
  prompt_version?: string | null;
}

const REVIEW_COLUMNS = "note_id, model, recommendation, labels, input_tokens, cached_input_tokens, output_tokens, cost_usd, harness, created_at";

/** The reviews, with their prompt version when migration 018 has added it. */
async function reviews(): Promise<ReviewRow[]> {
  try {
    return await all<ReviewRow>("ai_reviews", `${REVIEW_COLUMNS}, prompt_version`, ["note_id", "model"], true);
  } catch (error) {
    if (!String((error as { message?: string }).message ?? error).includes("prompt_version")) throw error;
    return all<ReviewRow>("ai_reviews", REVIEW_COLUMNS, ["note_id", "model"], true);
  }
}

export async function fetchSummary(): Promise<SummaryData> {
  const [reviewRows, verdictRows, labelRows, noteLabelRows, needsNoteRows] = await Promise.all([
    reviews(),
    all<{ note_id: string; verdict: Verdict }>("verdicts", "note_id, verdict", ["note_id"], true),
    all<{ id: number; name: string }>("labels", "id, name", ["id"]),
    all<{ note_id: string; label_id: number }>("note_labels", "note_id, label_id", ["note_id", "label_id"], true),
    all<{ note_id: string; answer: NeedsNote }>("needs_note", "note_id, answer", ["note_id"], true),
  ]);
  const needsNote = new Map(needsNoteRows.map((n) => [n.note_id, n.answer]));
  const labelName = new Map(labelRows.map((l) => [l.id, l.name]));
  const handLabels = new Map<string, string[]>();
  for (const row of noteLabelRows) {
    const name = labelName.get(row.label_id);
    if (name) handLabels.set(row.note_id, [...(handLabels.get(row.note_id) ?? []), name]);
  }
  const verdicts = new Map(verdictRows.map((v) => [v.note_id, v.verdict]));
  const ids = [...new Set([...verdicts.keys(), ...needsNote.keys(), ...reviewRows.map((r) => r.note_id)])];
  const writers = new Map<string, { id: string; name: string }>();
  const xStatus = new Map<string, string>();
  for (let at = 0; at < ids.length; at += 200) {
    const { data, error } = await supabase.from("x_notes").select("note_id, status, x_notewriters(author_id, name)").in("note_id", ids.slice(at, at + 200));
    if (error) throw error;
    for (const row of data as unknown as { note_id: string; status: string; x_notewriters: { author_id: string; name: string } | null }[]) {
      if (row.x_notewriters) writers.set(row.note_id, { id: row.x_notewriters.author_id, name: row.x_notewriters.name });
      xStatus.set(row.note_id, row.status);
    }
  }
  const num = (v: number | string | null) => (v === null ? null : Number(v));
  return {
    reviews: reviewRows.map((r) => ({
      noteId: r.note_id,
      model: r.model,
      recommendation: r.recommendation,
      labels: r.labels ?? [],
      inputTokens: num(r.input_tokens),
      cachedInputTokens: num(r.cached_input_tokens),
      outputTokens: num(r.output_tokens),
      costUsd: num(r.cost_usd),
      harness: r.harness,
      promptVersion: r.prompt_version ?? null,
      createdAt: r.created_at,
    })),
    verdicts,
    needsNote,
    handLabels,
    labelNames: labelRows.map((l) => l.name),
    writers,
    xStatus,
  };
}
