import { agreement, correctedPrevalence, fleissKappa, type Agreement, type Prevalence } from "./agreement";
import type { AiRecommendation, NeedsNote, Verdict } from "./taste";

/* The Summary tab: what has been judged and reviewed on the X tab, what the
 * reviews cost, and how each model and notewriter does on each kind of taste
 * failure. Everything is worked out here from the rows that
 * summaryFetch.ts reads, so a new model or label shows up without a
 * migration. Pure functions, so scripts/ai/compare.ts uses them too. */

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
  recommendation: AiRecommendation;
  labels: string[];
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** The harness that ran the review (run.ts); null for a review made by hand. */
  harness: string | null;
  /** The prompt it was made with; null before run.ts recorded it, or when
   *  the column isn't there yet. */
  promptVersion: string | null;
  createdAt: string;
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
  /** How X rated each judged or reviewed note: helpful or not_helpful. */
  xStatus?: Map<string, string>;
}

/** A taste-failure count and what it is out of, among the notes X rated
 *  helpful and among those it rated not helpful. Rates are shown this way
 *  because a sample can hold far more not-helpful notes than X does (about
 *  3.5%), and those fail far more often, so one pooled rate would mislead. */
export interface ByStatus {
  helpful: { failures: number; notes: number };
  notHelpful: { failures: number; notes: number };
}

/** The share of X's AI notes rated not helpful (scripts/ai/sets/strat-1000.json:
 *  1,164 of 32,996 on posts still up, our notewriter left out). */
export const X_NOT_HELPFUL_SHARE = 0.035;

/** One taste-failure rate weighted to X's own mix of helpful and not-helpful
 *  notes, so a sample with more not-helpful notes than X doesn't inflate it.
 *  With only one side present, that side's rate. Null with neither. */
export function weightedRate(b: ByStatus): number | null {
  const h = b.helpful.notes ? b.helpful.failures / b.helpful.notes : null;
  const n = b.notHelpful.notes ? b.notHelpful.failures / b.notHelpful.notes : null;
  if (h === null) return n;
  if (n === null) return h;
  return (1 - X_NOT_HELPFUL_SHARE) * h + X_NOT_HELPFUL_SHARE * n;
}

/** Splits notes by X's status, counting those `failed` says failed. */
export function byStatus(data: SummaryData, noteIds: string[], failed: (noteId: string) => boolean): ByStatus {
  const split: ByStatus = { helpful: { failures: 0, notes: 0 }, notHelpful: { failures: 0, notes: 0 } };
  for (const id of noteIds) {
    const status = data.xStatus?.get(id);
    const side = status === "helpful" ? split.helpful : status === "not_helpful" ? split.notHelpful : null;
    if (!side) continue;
    side.notes++;
    if (failed(id)) side.failures++;
  }
  return split;
}

/** What the Summary calls an estimated cost. LIST_PRICES were copied by hand
 *  and nobody has checked them against a bill. */
export const ESTIMATED_COST = "est., list price unverified";

/** What a review cost: the dollars its harness reported, else an estimate
 *  from its tokens at list price, else unknown. */
export function reviewCost(review: SummaryReview): { usd: number; estimated: boolean } | null {
  if (review.costUsd !== null) return { usd: review.costUsd, estimated: false };
  const price = LIST_PRICES[review.model];
  if (!price || review.inputTokens === null || review.outputTokens === null) return null;
  const cached = review.cachedInputTokens ?? 0;
  return { usd: ((review.inputTokens - cached) * price.input + cached * price.cachedInput + review.outputTokens * price.output) / 1e6, estimated: true };
}

/** The choice of prompt for a review made before run.ts recorded one. */
export const UNRECORDED_PROMPT = "unrecorded";

export interface PromptChoice {
  id: string;
  reviews: number;
  /** When its newest review was made. */
  latest: string;
}

/** The prompts the run.ts reviews were made with, newest first, so the
 *  default is the prompt of the newest review. */
export function promptVersions(data: SummaryData): PromptChoice[] {
  const byPrompt = Map.groupBy(
    data.reviews.filter((r) => r.harness !== null),
    (r) => r.promptVersion ?? UNRECORDED_PROMPT,
  );
  return [...byPrompt]
    .map(([id, rs]) => ({ id, reviews: rs.length, latest: rs.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), "") }))
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

/** The data with only the reviews made the same way: by run.ts (a harness
 *  is set), and with `prompt` when one is given. A review made by hand, or
 *  with other instructions, would mix two experiments in one number. */
export function sameProtocol(data: SummaryData, prompt: string | null): SummaryData {
  return {
    ...data,
    reviews: data.reviews.filter((r) => r.harness !== null && (prompt === null || (r.promptVersion ?? UNRECORDED_PROMPT) === prompt)),
  };
}

export interface ModelStats {
  model: string;
  reviews: number;
  tasteFailures: number;
  /** Its taste-failure rate among notes X rated helpful and not helpful. */
  failuresByStatus: ByStatus;
  /** How its calls agree with the labellers', on the notes they called a
   *  taste failure or fine. */
  vsLabellers: Agreement;
  /** Reviews whose cost is known or estimated, and their total. A model's
   *  cost is only ever shown on its own: one model's is billed, another's is
   *  worked out from list prices. */
  costed: number;
  costUsd: number;
  estimated: boolean;
  avgInputTokens: number | null;
  avgOutputTokens: number | null;
  /** Its taste-failure rate on every note it reviewed, corrected for the
   *  failures it misses and the false alarms it gives on the labelled notes. */
  prevalence: Prevalence;
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
      const tasteFailures = reviews.filter((r) => r.recommendation === "taste_failure").length;
      const vs = agreement(comparable.map((r) => ({ truth: data.verdicts.get(r.noteId) === "taste_failure", call: r.recommendation === "taste_failure" })));
      return {
        model,
        reviews: reviews.length,
        tasteFailures,
        failuresByStatus: byStatus(data, reviews.map((r) => r.noteId), (id) => reviews.find((r) => r.noteId === id)?.recommendation === "taste_failure"),
        vsLabellers: vs,
        costed: costs.length,
        costUsd: costs.reduce((s, c) => s + c.usd, 0),
        estimated: costs.some((c) => c.estimated),
        avgInputTokens: avg((r) => r.inputTokens!),
        avgOutputTokens: avg((r) => r.outputTokens!),
        prevalence: correctedPrevalence([{ weight: 1, positives: tasteFailures, notes: reviews.length }], ...sensitivityAndSpecificity(vs)),
      };
    })
    .sort((a, b) => b.reviews - a.reviews || a.model.localeCompare(b.model));
}

/** A judge's sensitivity (failures caught of failures) and specificity (fine
 *  notes cleared of fine notes) against the labellers. */
export function sensitivityAndSpecificity(a: Agreement): [{ hits: number; of: number }, { hits: number; of: number }] {
  return [
    { hits: a.caught, of: a.caught + a.missed },
    { hits: a.cleared, of: a.cleared + a.falseAlarms },
  ];
}

export interface ModelAgreement {
  pairs: { a: string; b: string; agreement: Agreement }[];
  /** Fleiss' kappa of all the models together, on the notes all reviewed. */
  fleiss: number | null;
  fleissNotes: number;
}

/** How the models agree with each other: Cohen's kappa of each pair on the
 *  notes both reviewed, and Fleiss' kappa of all of them. */
export function modelAgreement(data: SummaryData, models: string[]): ModelAgreement {
  const call = new Map(data.reviews.map((r) => [`${r.model} ${r.noteId}`, r.recommendation === "taste_failure"]));
  const notes = [...new Set(data.reviews.map((r) => r.noteId))];
  const pairs = models.flatMap((a, i) =>
    models.slice(i + 1).map((b) => ({
      a,
      b,
      agreement: agreement(notes.filter((id) => call.has(`${a} ${id}`) && call.has(`${b} ${id}`)).map((id) => ({ truth: call.get(`${a} ${id}`)!, call: call.get(`${b} ${id}`)! }))),
    })),
  );
  const rows = notes.filter((id) => models.every((m) => call.has(`${m} ${id}`))).map((id) => models.map((m) => call.get(`${m} ${id}`)!));
  return { pairs, fleiss: models.length > 2 ? fleissKappa(rows) : null, fleissNotes: rows.length };
}

export interface Totals {
  judged: number;
  tasteFailures: number;
  /** Judged notes that weren't unsure: the taste-failure rate's denominator. */
  decided: number;
  /** The labellers' taste-failure rate among decided notes X rated helpful
   *  and not helpful. */
  failuresByStatus: ByStatus;
  labelled: number;
  reviews: number;
  models: number;
  reviewedNotes: number;
  /** The labellers' answers to whether the post needed a note. */
  needsNote: Record<NeedsNote, number>;
}

export function totals(data: SummaryData, models: ModelStats[]): Totals {
  return {
    judged: data.verdicts.size,
    tasteFailures: [...data.verdicts.values()].filter((v) => v === "taste_failure").length,
    decided: [...data.verdicts.values()].filter((v) => v !== "unsure").length,
    failuresByStatus: byStatus(data, [...data.verdicts].filter(([, v]) => v !== "unsure").map(([id]) => id), (id) => data.verdicts.get(id) === "taste_failure"),
    labelled: [...data.handLabels.values()].filter((l) => l.length).length,
    reviews: data.reviews.length,
    models: models.length,
    reviewedNotes: new Set(data.reviews.map((r) => r.noteId)).size,
    needsNote: {
      yes: [...data.needsNote.values()].filter((a) => a === "yes").length,
      no: [...data.needsNote.values()].filter((a) => a === "no").length,
      unsure: [...data.needsNote.values()].filter((a) => a === "unsure").length,
    },
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

/** The judge that stands for the labellers, beside the models. */
export const LABELLERS = "labellers";

/** The notes a judge has fully labelled, with the labels it gave each. For
 *  the labellers, a note called fine, or a taste failure with at least one
 *  label: an unsure or somewhat note, or a failure not labelled yet, would
 *  count against every label when a model labels every failure it calls.
 *  For a model, every note it reviewed. */
export function judgedNotes(data: SummaryData, judge: string): Map<string, string[]> {
  if (judge === LABELLERS) {
    return new Map(
      [...data.verdicts]
        .filter(([id, v]) => v === "fine" || (v === "taste_failure" && (data.handLabels.get(id)?.length ?? 0) > 0))
        .map(([id, v]) => [id, v === "fine" ? [] : data.handLabels.get(id)!]),
    );
  }
  return new Map(data.reviews.filter((r) => r.model === judge).map((r) => [r.noteId, r.labels]));
}

/** The notes every one of the judges has judged (see judgedNotes), so their
 *  label shares are out of the same notes. */
export function commonNotes(data: SummaryData, judges: string[]): Set<string> {
  const [first, ...rest] = judges.map((j) => judgedNotes(data, j));
  if (!first) return new Set();
  return new Set([...first.keys()].filter((id) => rest.every((m) => m.has(id))));
}

/** How often a notewriter's notes get each label from a judge: of its notes
 *  the judge judged (and in `only`, when given), the share given the label.
 *  A null writer is every notewriter together. */
export function writerLabelShares(data: SummaryData, judge: string, writerId: string | null, labels: string[], only?: Set<string>): Score[] {
  const notes = [...judgedNotes(data, judge)].filter(([id]) => (!only || only.has(id)) && (writerId === null || data.writers.get(id)?.id === writerId));
  return labels.map((label) => score(notes.filter(([, ls]) => ls.some((l) => sameLabel(l, label))).length, notes.length));
}

/** A label as stored ("missed-joke") as a reader sees it ("Missed joke"). */
export const labelText = (label: string) => {
  const text = label.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export interface WriterStats {
  id: string;
  name: string;
  judged: number;
  tasteFailures: number;
  /** Judged notes that weren't unsure, which the failure rate is out of. */
  decided: number;
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
    const stats = byWriter.get(writer.id) ?? { ...writer, judged: 0, tasteFailures: 0, decided: 0, askedNeed: 0, notNeeded: 0 };
    byWriter.set(writer.id, stats);
    return stats;
  };
  for (const [noteId, verdict] of data.verdicts) {
    const stats = of(noteId);
    if (!stats) continue;
    stats.judged++;
    if (verdict !== "unsure") stats.decided++;
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

export interface LabelCounts {
  /** Every label anyone gave, most given first. */
  labels: string[];
  /** How many notes the labellers gave each label to, of how many. */
  hand: number[];
  handNotes: number;
  /** How many notes each model gave each label to, of how many, by model. */
  byModel: { model: string; counts: number[]; notes: number }[];
}

/** How many notes each judge gave each label to, of the notes it judged
 *  (see judgedNotes) and in `only`, when given. A note with two labels
 *  counts once under each. A model's own spelling of a label is matched
 *  ignoring case; a label no one else uses gets a column of its own. */
export function labelCounts(data: SummaryData, models: string[], only?: Set<string>): LabelCounts {
  const names = new Map<string, string>();
  for (const name of data.labelNames) names.set(name.toLowerCase(), name);
  for (const r of data.reviews) for (const l of r.labels) if (!names.has(l.toLowerCase())) names.set(l.toLowerCase(), l);
  const keys = [...names.keys()];
  const count = (labelLists: string[][]) => keys.map((k) => labelLists.filter((ls) => ls.some((l) => l.toLowerCase() === k)).length);
  const judged = (judge: string) => [...judgedNotes(data, judge)].filter(([id]) => !only || only.has(id)).map(([, ls]) => ls);
  const handLists = judged(LABELLERS);
  const hand = count(handLists);
  const byModel = models.map((model) => {
    const lists = judged(model);
    return { model, counts: count(lists), notes: lists.length };
  });
  const total = (i: number) => hand[i]! + byModel.reduce((s, m) => s + m.counts[i]!, 0);
  const order = keys.map((_, i) => i).filter((i) => total(i) > 0).sort((a, b) => total(b) - total(a) || keys[a]!.localeCompare(keys[b]!));
  return {
    labels: order.map((i) => names.get(keys[i]!)!),
    hand: order.map((i) => hand[i]!),
    handNotes: handLists.length,
    byModel: byModel.map((m) => ({ model: m.model, counts: order.map((i) => m.counts[i]!), notes: m.notes })),
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

/** The fewest reviews a model needs to be shown; one or two reviews, such
 *  as a model tried once, would only add noise to the charts. */
export const MIN_REVIEWS = 5;

/** The data without the reviews of models below MIN_REVIEWS. */
export function withoutTriedModels(data: SummaryData): SummaryData {
  const counts = new Map<string, number>();
  for (const r of data.reviews) counts.set(r.model, (counts.get(r.model) ?? 0) + 1);
  return { ...data, reviews: data.reviews.filter((r) => counts.get(r.model)! >= MIN_REVIEWS) };
}
