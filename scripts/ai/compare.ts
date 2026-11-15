import { correctedPrevalence, kappaText, type Agreement } from "../../src/core/agreement";
import { ESTIMATED_COST, modelAgreement, modelStats, sensitivityAndSpecificity, UNRECORDED_PROMPT, type SummaryData, type SummaryReview } from "../../src/core/summary";
import type { Verdict } from "../../src/core/taste";
import { target } from "../import/db";

/* Compares the models that reviewed X notes: how often each calls a note a
 * taste failure, how often it agrees with the labellers' verdicts and with
 * each other model, and what its reviews cost. Run from the repository root:
 *
 *   bun scripts/ai/compare.ts                 every model
 *   bun scripts/ai/compare.ts <model>...      these models, on the notes all of them reviewed
 *   --prompt <version>                        only reviews made with that prompt (prompt_version, see run.ts);
 *                                             "unrecorded" for run.ts reviews made before it was recorded
 *   --include-manual                          also reviews made by hand (no harness), left out by default
 *   --set <name>                              only notes of scripts/ai/sets/<name>.txt
 *   --prevalence                              each model's taste-failure rate corrected for its errors on the
 *                                             labelled notes; weighted back to the population when the set has
 *                                             a sample.ts JSON beside it
 *
 * By default only reviews run.ts made count, so a review made by hand isn't
 * pooled with them; pass --prompt too to compare reviews made with the same
 * instructions. Agreement with the labellers is on the notes they called a
 * taste failure or fine, as Cohen's kappa with a 95% bootstrap interval,
 * beside the agreement that always giving their commoner answer would get.
 * Costs use the Summary tab's rule (reviewCost in src/core/summary.ts) and
 * are per model only, since one model's are billed and another's estimated.
 */

interface ReviewRow {
  note_id: string;
  model: string;
  recommendation: "taste_failure" | "fine";
  labels: string[] | null;
  cost_usd: number | string | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  harness: string | null;
  created_at: string;
  prompt_version?: string | null;
}

/** Every row of a table, a thousand at a time, in the order of a unique key. */
async function all<T>(table: string, columns: string, order: string[], filter: (q: any) => any = (q) => q): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = filter(target.from(table).select(columns));
    for (const column of order) query = query.order(column);
    const { data, error } = await query.range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as T[]));
    if (data.length < 1000) return rows;
  }
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "-");
const share = (v: number | null) => (v === null ? "-" : `${Math.round(100 * v)}%`);
const usd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args.splice(at, 2)[1];
};
const flag = (name: string) => {
  const at = args.indexOf(name);
  if (at !== -1) args.splice(at, 1);
  return at !== -1;
};
const promptVersion = option("--prompt");
const setName = option("--set");
const includeManual = flag("--include-manual");
const showPrevalence = flag("--prevalence");
const picked = args;

const COLUMNS = "note_id, model, recommendation, labels, cost_usd, input_tokens, cached_input_tokens, output_tokens, harness, created_at";
let rows: ReviewRow[];
let hasPromptVersion = true;
try {
  rows = await all<ReviewRow>("ai_reviews", `${COLUMNS}, prompt_version`, ["note_id", "model"], (q) => q.eq("source", "x"));
} catch (error) {
  if (!String((error as { message?: string }).message).includes("prompt_version")) throw error;
  hasPromptVersion = false;
  rows = await all<ReviewRow>("ai_reviews", COLUMNS, ["note_id", "model"], (q) => q.eq("source", "x"));
}
if (promptVersion && !hasPromptVersion) throw new Error("ai_reviews has no prompt_version column yet (migration 018)");

const num = (v: number | string | null) => (v === null ? null : Number(v));
const toReview = (r: ReviewRow): SummaryReview => ({
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
});

const manual = rows.filter((r) => r.harness === null).length;
let protocol = rows.map(toReview).filter((r) => includeManual || r.harness !== null);
if (promptVersion) protocol = protocol.filter((r) => (r.promptVersion ?? UNRECORDED_PROMPT) === promptVersion);
console.log(
  `${includeManual ? "Every review, by hand or by run.ts" : `Only reviews run.ts made (${manual} made by hand left out)`}${promptVersion ? `, with prompt ${promptVersion}` : ""}.`,
);
if (!promptVersion && hasPromptVersion) {
  const prompts = Map.groupBy(protocol, (r) => r.promptVersion ?? UNRECORDED_PROMPT);
  if (prompts.size > 1) console.log(`These span ${prompts.size} prompts (${[...prompts].map(([v, rs]) => `${v} ${rs.length}`).join(", ")}); pass --prompt to keep one.`);
}

let reviews = protocol;
let setIds: Set<string> | null = null;
if (setName) {
  setIds = new Set((await Bun.file(`scripts/ai/sets/${setName}.txt`).text()).split(/\s+/).filter(Boolean));
  reviews = reviews.filter((r) => setIds!.has(r.noteId));
  console.log(`Only the ${setIds.size} notes of ${setName}.`);
}
if (picked.length) {
  const unknown = picked.filter((model) => !reviews.some((r) => r.model === model));
  if (unknown.length) throw new Error(`No reviews by ${unknown.join(", ")} under this filter`);
  // Only the notes every picked model reviewed, so the models are compared on the same notes.
  const byNote = Map.groupBy(reviews.filter((r) => picked.includes(r.model)), (r) => r.noteId);
  const shared = new Set([...byNote].filter(([, rs]) => rs.length === picked.length).map(([id]) => id));
  reviews = reviews.filter((r) => picked.includes(r.model) && shared.has(r.noteId));
  console.log(`${shared.size} notes reviewed by all of ${picked.join(", ")}.`);
}
console.log("");

const verdicts = new Map(
  (await all<{ note_id: string; verdict: Verdict }>("verdicts", "note_id, verdict", ["note_id"], (q) => q.eq("source", "x"))).map((v) => [v.note_id, v.verdict]),
);
const dataOf = (rs: SummaryReview[]): SummaryData => ({ reviews: rs, verdicts, needsNote: new Map(), handLabels: new Map(), labelNames: [], writers: new Map() });
const stats = modelStats(dataOf(reviews)).sort((a, b) => a.model.localeCompare(b.model));
const models = stats.map((m) => m.model);

const vsText = (vs: Agreement) =>
  vs.notes
    ? `κ ${kappaText(vs, "-")}, ${pct(vs.caught + vs.cleared, vs.notes)} agree (baseline ${pct(Math.round(vs.baseline * vs.notes), vs.notes)}), caught ${vs.caught} of ${vs.caught + vs.missed} failures, on ${vs.notes}`
    : "no labelled notes";

console.log("model | notes | taste failure | vs labellers | cost (this model only) | cost per review | tokens in/out per review");
for (const m of stats) {
  const est = m.estimated ? ` ${ESTIMATED_COST}` : "";
  console.log(
    [
      m.model,
      m.reviews,
      pct(m.tasteFailures, m.reviews),
      vsText(m.vsLabellers),
      m.costed ? `${usd(m.costUsd)}${est}${m.costed < m.reviews ? ` (${m.costed} of ${m.reviews} costed)` : ""}` : "unknown",
      m.costed ? usd(m.costUsd / m.costed) : "-",
      `${m.avgInputTokens ?? "-"}/${m.avgOutputTokens ?? "-"}`,
    ].join(" | "),
  );
}

if (models.length > 1) {
  const between = modelAgreement(dataOf(reviews), models);
  console.log("\nmodel pair | notes both reviewed | agree | kappa");
  for (const p of between.pairs) console.log(`${p.a} vs ${p.b} | ${p.agreement.notes} | ${pct(Math.round(p.agreement.agreement * p.agreement.notes), p.agreement.notes)} | ${kappaText(p.agreement, "-")}`);
  if (between.fleiss !== null) console.log(`Fleiss' κ of all ${models.length}, on the ${between.fleissNotes} notes all reviewed: ${between.fleiss.toFixed(2)}`);
}

if (showPrevalence) {
  interface Breakdown {
    notes: number;
    strata: Record<string, { notes: number; writers: Record<string, { notes: number }> }>;
  }
  const sidecar = setName ? Bun.file(`scripts/ai/sets/${setName}.json`) : null;
  const population: Breakdown | null = sidecar && (await sidecar.exists()) ? (await sidecar.json()).population : null;
  // Each reviewed note's stratum and notewriter, to weight by.
  const cellOf = new Map<string, string>();
  if (population) {
    const ids = [...new Set(reviews.map((r) => r.noteId))];
    for (let at = 0; at < ids.length; at += 200) {
      const { data, error } = await target.from("x_notes").select("note_id, status, author_id").in("note_id", ids.slice(at, at + 200));
      if (error) throw error;
      for (const n of data) cellOf.set(n.note_id, `${n.status} ${n.author_id}`);
    }
  }
  // Sensitivity and specificity from every labelled note the model reviewed under the protocol, not only the set's.
  const measured = new Map(modelStats(dataOf(protocol)).map((m) => [m.model, m.vsLabellers]));
  console.log(
    `\nTaste-failure rate corrected for each model's errors on the labelled notes (Rogan–Gladen, 95% interval)${population ? `, weighted to the ${population.notes} notes ${setName} was drawn from by rating and notewriter` : setName ? `; ${setName} has no sample.ts JSON, so unweighted` : "; unweighted, so it is the rate on the notes reviewed, not on X"}.`,
  );
  console.log("model | notes | own rate | sensitivity | specificity | corrected rate");
  for (const m of stats) {
    const mine = reviews.filter((r) => r.model === m.model);
    let strata = [{ weight: 1, positives: m.tasteFailures, notes: m.reviews }];
    let left = 0;
    if (population) {
      // A notewriter's notes stand for its part of their rating's population;
      // a notewriter with none reviewed passes its part to the others of that rating.
      const byCell = Map.groupBy(mine.filter((r) => cellOf.has(r.noteId)), (r) => cellOf.get(r.noteId)!);
      left = mine.length - [...byCell.values()].reduce((s, rs) => s + rs.length, 0);
      strata = Object.entries(population.strata).flatMap(([stratum, s]) => {
        const cells = Object.entries(s.writers).filter(([writer]) => byCell.has(`${stratum} ${writer}`));
        const covered = cells.reduce((sum, [, w]) => sum + w.notes, 0);
        return cells.map(([writer, w]) => {
          const rs = byCell.get(`${stratum} ${writer}`)!;
          return { weight: (s.notes / population.notes) * (w.notes / covered), positives: rs.filter((r) => r.recommendation === "taste_failure").length, notes: rs.length };
        });
      });
    }
    const vs = measured.get(m.model)!;
    const [se, sp] = sensitivityAndSpecificity(vs);
    const p = correctedPrevalence(strata, se, sp);
    console.log(
      [
        m.model,
        `${p.notes}${left ? ` (${left} outside the population left out)` : ""}`,
        share(p.raw),
        `${share(p.sensitivity)} of ${se.of}`,
        `${share(p.specificity)} of ${sp.of}`,
        p.estimate === null ? "- (no better than chance, or nothing labelled)" : `${share(p.estimate)}${p.ci ? ` (${share(p.ci[0])} to ${share(p.ci[1])})` : ""}`,
      ].join(" | "),
    );
  }
}
