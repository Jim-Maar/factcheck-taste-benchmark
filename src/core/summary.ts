import { supabase } from "./supabase";
import type { NeedsNote, Verdict } from "./taste";

/* The Summary tab: what has been judged and reviewed on the X tab, what the
 * reviews cost, and how each model and notewriter does on each kind of taste
 * failure. Everything is read from the tables and worked out here, so a new
 * model or label shows up without a migration. */

/** USD per million tokens, from the providers' list prices. Only for a cost
 *  estimate when a harness reported tokens but no dollars (Codex reports no
 *  dollars). Codex on a ChatGPT plan isn't billed per token, so this is what
 *  the same run would cost on the API. Checked 2026-11-15. */
export const LIST_PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
};

export interface SummaryReview {
  noteId: string;
  model: string;
  recommendation: "taste_failure" | "fine";
  labels: string[];
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface SummaryData {
  reviews: SummaryReview[];
  verdicts: Map<string, Verdict>;
  /** A labeller's answer to whether the post needed a note at all. */
  needsNote: Map<string, NeedsNote>;
  /** The hand labels of each note, by name. */
  handLabels: Map<string, string[]>;
  labelNames: string[];
  /** Who wrote each judged or reviewed note. */
  writers: Map<string, { id: string; name: string }>;
}

/** What a review cost: the dollars its harness reported, else an estimate
 *  from its tokens at list price, else unknown. */
export function reviewCost(review: SummaryReview): { usd: number; estimated: boolean } | null {
  if (review.costUsd !== null) return { usd: review.costUsd, estimated: false };
  const price = LIST_PRICES[review.model];
  if (!price || review.inputTokens === null || review.outputTokens === null) return null;
  const cached = review.cachedInputTokens ?? 0;
  return { usd: ((review.inputTokens - cached) * price.input + cached * price.cachedInput + review.outputTokens * price.output) / 1e6, estimated: true };
}

export interface ModelStats {
  model: string;
  reviews: number;
  tasteFailures: number;
  /** Reviews of notes a labeller called a taste failure or fine, and how many
   *  of those the model agreed with. */
  comparable: number;
  agreed: number;
  /** Reviews whose cost is known or estimated, and their total. */
  costed: number;
  costUsd: number;
  estimated: boolean;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
}

export function modelStats(data: SummaryData): ModelStats[] {
  const byModel = Map.groupBy(data.reviews, (r) => r.model);
  return [...byModel]
    .map(([model, reviews]) => {
      const comparable = reviews.filter((r) => {
        const v = data.verdicts.get(r.noteId);
        return v === "taste_failure" || v === "fine";
      });
      const costs = reviews.map(reviewCost).filter((c) => c !== null);
      const metered = reviews.filter((r) => r.inputTokens !== null && r.outputTokens !== null);
      const avg = (pick: (r: SummaryReview) => number) => (metered.length ? Math.round(metered.reduce((s, r) => s + pick(r), 0) / metered.length) : null);
      return {
        model,
        reviews: reviews.length,
        tasteFailures: reviews.filter((r) => r.recommendation === "taste_failure").length,
        comparable: comparable.length,
        agreed: comparable.filter((r) => data.verdicts.get(r.noteId) === r.recommendation).length,
        costed: costs.length,
        costUsd: costs.reduce((s, c) => s + c.usd, 0),
        estimated: costs.some((c) => c.estimated),
        avgInputTokens: avg((r) => r.inputTokens!),
        avgOutputTokens: avg((r) => r.outputTokens!),
      };
    })
    .sort((a, b) => b.reviews - a.reviews || a.model.localeCompare(b.model));
}

export interface Totals {
  judged: number;
  tasteFailures: number;
  labelled: number;
  reviews: number;
  models: number;
  reviewedNotes: number;
  /** The labellers' answers to whether the post needed a note. */
  needsNote: Record<NeedsNote, number>;
  costed: number;
  costUsd: number;
  estimated: boolean;
}

export function totals(data: SummaryData, models: ModelStats[]): Totals {
  return {
    judged: data.verdicts.size,
    tasteFailures: [...data.verdicts.values()].filter((v) => v === "taste_failure").length,
    labelled: [...data.handLabels.values()].filter((l) => l.length).length,
    reviews: data.reviews.length,
    models: models.length,
    reviewedNotes: new Set(data.reviews.map((r) => r.noteId)).size,
    needsNote: {
      yes: [...data.needsNote.values()].filter((a) => a === "yes").length,
      no: [...data.needsNote.values()].filter((a) => a === "no").length,
      unsure: [...data.needsNote.values()].filter((a) => a === "unsure").length,
    },
    costed: models.reduce((s, m) => s + m.costed, 0),
    costUsd: models.reduce((s, m) => s + m.costUsd, 0),
    estimated: models.some((m) => m.estimated),
  };
}

const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The labels the radars have axes for: those a labeller has given at least
 *  once, most given first. Without hand labels a model can't be scored. */
export function labelAxes(data: SummaryData): { label: string; notes: number }[] {
  return data.labelNames
    .map((label) => ({ label, notes: [...data.handLabels.values()].filter((ls) => ls.some((l) => sameLabel(l, label))).length }))
    .filter((axis) => axis.notes > 0)
    .sort((a, b) => b.notes - a.notes || a.label.localeCompare(b.label));
}

/** A share, and the count it is out of: null when that count is zero. */
export interface Score {
  share: number | null;
  hits: number;
  of: number;
}

const score = (hits: number, of: number): Score => ({ share: of ? hits / of : null, hits, of });

/** How well a model catches each label: of the notes a labeller gave the
 *  label to, and the model reviewed, the share the model also gave it to. */
export function modelRecall(data: SummaryData, model: string, axes: string[]): Score[] {
  const reviews = new Map(data.reviews.filter((r) => r.model === model).map((r) => [r.noteId, r]));
  return axes.map((label) => {
    const notes = [...data.handLabels].filter(([id, ls]) => reviews.has(id) && ls.some((l) => sameLabel(l, label)));
    return score(notes.filter(([id]) => reviews.get(id)!.labels.some((l) => sameLabel(l, label))).length, notes.length);
  });
}

/** How often a notewriter falls into each label: of its notes a labeller
 *  judged, the share given the label. */
export function writerFailures(data: SummaryData, writerId: string | null, axes: string[]): Score[] {
  const judged = [...data.verdicts.keys()].filter((id) => writerId === null || data.writers.get(id)?.id === writerId);
  return axes.map((label) => score(judged.filter((id) => data.handLabels.get(id)?.some((l) => sameLabel(l, label))).length, judged.length));
}

export interface WriterStats {
  id: string;
  name: string;
  judged: number;
  tasteFailures: number;
  /** Notes whose post a labeller said whether it needed a note, and how many
   *  of those it didn't. */
  askedNeed: number;
  notNeeded: number;
}

export function writerStats(data: SummaryData): WriterStats[] {
  const byWriter = new Map<string, WriterStats>();
  const of = (noteId: string) => {
    const writer = data.writers.get(noteId);
    if (!writer) return null;
    const stats = byWriter.get(writer.id) ?? { ...writer, judged: 0, tasteFailures: 0, askedNeed: 0, notNeeded: 0 };
    byWriter.set(writer.id, stats);
    return stats;
  };
  for (const [noteId, verdict] of data.verdicts) {
    const stats = of(noteId);
    if (!stats) continue;
    stats.judged++;
    if (verdict === "taste_failure") stats.tasteFailures++;
  }
  for (const [noteId, answer] of data.needsNote) {
    const stats = of(noteId);
    if (!stats || answer === "unsure") continue;
    stats.askedNeed++;
    if (answer === "no") stats.notNeeded++;
  }
  return [...byWriter.values()].sort((a, b) => b.judged - a.judged || a.name.localeCompare(b.name));
}

/** Every row of a table, a thousand at a time; with `xOnly`, only the X tab's. */
export interface LabelCounts {
  /** Every label anyone gave, most given first. */
  labels: string[];
  /** How many notes the labellers gave each label to. */
  hand: number[];
  /** How many notes each model gave each label to, by model. */
  byModel: { model: string; counts: number[] }[];
}

/** How many notes each judge gave each label to. A note with two labels
 *  counts once under each. A model's own spelling of a label is matched
 *  ignoring case; a label no one else uses gets a column of its own. */
export function labelCounts(data: SummaryData, models: string[]): LabelCounts {
  const names = new Map<string, string>();
  for (const name of data.labelNames) names.set(name.toLowerCase(), name);
  for (const r of data.reviews) for (const l of r.labels) if (!names.has(l.toLowerCase())) names.set(l.toLowerCase(), l);
  const keys = [...names.keys()];
  const count = (labelLists: string[][]) => keys.map((k) => labelLists.filter((ls) => ls.some((l) => l.toLowerCase() === k)).length);
  const hand = count([...data.verdicts.keys()].map((id) => data.handLabels.get(id) ?? []));
  const byModel = models.map((model) => ({ model, counts: count(data.reviews.filter((r) => r.model === model).map((r) => r.labels)) }));
  const total = (i: number) => hand[i]! + byModel.reduce((s, m) => s + m.counts[i]!, 0);
  const order = keys.map((_, i) => i).filter((i) => total(i) > 0).sort((a, b) => total(b) - total(a) || keys[a]!.localeCompare(keys[b]!));
  return {
    labels: order.map((i) => names.get(keys[i]!)!),
    hand: order.map((i) => hand[i]!),
    byModel: byModel.map((m) => ({ model: m.model, counts: order.map((i) => m.counts[i]!) })),
  };
}

/** The parts a judge's split bar has: a failure under one of the commonest
 *  labels, a failure under any other label or none, a note it was unsure of
 *  or called somewhat, and a fine note. */
export const SPLIT_LABELS = 6;
export type SplitPart = { kind: "label"; label: string } | { kind: "other" } | { kind: "unsure" } | { kind: "fine" };

export interface Split {
  judge: string;
  notes: number;
  /** Counts in the order the bar draws them; a part at zero is left out. */
  parts: { part: SplitPart; notes: number }[];
}

/** How each judge (the labellers, then each model) splits the notes it
 *  judged. A failure with several labels counts under the commonest. */
export function splits(data: SummaryData, axes: string[], models: string[]): Split[] {
  const shown = axes.slice(0, SPLIT_LABELS);
  const order: SplitPart[] = [...shown.map((label) => ({ kind: "label" as const, label })), { kind: "other" }, { kind: "unsure" }, { kind: "fine" }];
  const key = (p: SplitPart) => (p.kind === "label" ? `label:${p.label}` : p.kind);
  const partOf = (failed: boolean | null, labels: string[]): SplitPart => {
    if (failed === null) return { kind: "unsure" };
    if (!failed) return { kind: "fine" };
    const label = shown.find((a) => labels.some((l) => sameLabel(l, a)));
    return label ? { kind: "label", label } : { kind: "other" };
  };
  const split = (judge: string, judged: SplitPart[]): Split => {
    const counts = new Map<string, number>();
    for (const p of judged) counts.set(key(p), (counts.get(key(p)) ?? 0) + 1);
    return { judge, notes: judged.length, parts: order.map((part) => ({ part, notes: counts.get(key(part)) ?? 0 })).filter((p) => p.notes > 0) };
  };
  const hand = [...data.verdicts].map(([id, v]) => partOf(v === "taste_failure" ? true : v === "fine" ? false : null, data.handLabels.get(id) ?? []));
  return [
    split("Labellers", hand),
    ...models.map((model) => split(model, data.reviews.filter((r) => r.model === model).map((r) => partOf(r.recommendation === "taste_failure", r.labels)))),
  ];
}

async function all<T>(table: string, columns: string, xOnly = false): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const query = supabase.from(table).select(columns);
    const { data, error } = await (xOnly ? query.eq("source", "x") : query).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as unknown as T[]));
    if (data.length < 1000) return rows;
  }
}

export async function fetchSummary(): Promise<SummaryData> {
  const [reviewRows, verdictRows, labelRows, noteLabelRows, needsNoteRows] = await Promise.all([
    all<{ note_id: string; model: string; recommendation: "taste_failure" | "fine"; labels: string[]; input_tokens: number | null; cached_input_tokens: number | null; output_tokens: number | null; cost_usd: number | string | null }>(
      "ai_reviews", "note_id, model, recommendation, labels, input_tokens, cached_input_tokens, output_tokens, cost_usd", true),
    all<{ note_id: string; verdict: Verdict }>("verdicts", "note_id, verdict", true),
    all<{ id: number; name: string }>("labels", "id, name"),
    all<{ note_id: string; label_id: number }>("note_labels", "note_id, label_id", true),
    all<{ note_id: string; answer: NeedsNote }>("needs_note", "note_id, answer", true),
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
  for (let at = 0; at < ids.length; at += 200) {
    const { data, error } = await supabase.from("x_notes").select("note_id, x_notewriters(author_id, name)").in("note_id", ids.slice(at, at + 200));
    if (error) throw error;
    for (const row of data as unknown as { note_id: string; x_notewriters: { author_id: string; name: string } | null }[]) {
      if (row.x_notewriters) writers.set(row.note_id, { id: row.x_notewriters.author_id, name: row.x_notewriters.name });
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
    })),
    verdicts,
    needsNote,
    handLabels,
    labelNames: labelRows.map((l) => l.name),
    writers,
  };
}
