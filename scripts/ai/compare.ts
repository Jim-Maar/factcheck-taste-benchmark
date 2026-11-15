import { agreement, type Agreement } from "../../src/core/agreement";
import { target } from "../import/db";

/* Compares the models that reviewed X notes: how often each calls a note a
 * taste failure, how often it agrees with the labellers' verdicts and with
 * each other model, and what its reviews cost. Run from the repository root:
 *
 *   bun scripts/ai/compare.ts                 every model
 *   bun scripts/ai/compare.ts <model>...      these models, on the notes all of them reviewed
 *   --prompt <version>                        only reviews made with that prompt (prompt_version, see run.ts)
 *
 * Agreement with the labellers is on the notes they called a taste failure
 * or fine, as Cohen's kappa with a 95% bootstrap interval, beside the
 * agreement that always giving their commoner answer would get.
 */

interface Review {
  note_id: string;
  model: string;
  recommendation: string;
  cost_usd: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

async function all<T>(table: string, columns: string, filter: (q: any) => any = (q) => q): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(target.from(table).select(columns)).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as T[]));
    if (data.length < 1000) return rows;
  }
}

const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "-");

const args = process.argv.slice(2);
const promptAt = args.indexOf("--prompt");
const promptVersion = promptAt === -1 ? undefined : args.splice(promptAt, 2)[1];
const picked = args;
let reviews = await all<Review>("ai_reviews", "note_id, model, recommendation, cost_usd, input_tokens, output_tokens", (q) =>
  promptVersion ? q.eq("source", "x").eq("prompt_version", promptVersion) : q.eq("source", "x"),
);
if (promptVersion) console.log(`Only reviews made with prompt ${promptVersion}.\n`);
if (picked.length) {
  const unknown = picked.filter((model) => !reviews.some((r) => r.model === model));
  if (unknown.length) throw new Error(`No reviews by ${unknown.join(", ")}`);
  // Only the notes every picked model reviewed, so the models are compared on the same notes.
  const byNote = Map.groupBy(reviews.filter((r) => picked.includes(r.model)), (r) => r.note_id);
  const shared = new Set([...byNote].filter(([, rs]) => rs.length === picked.length).map(([id]) => id));
  reviews = reviews.filter((r) => picked.includes(r.model) && shared.has(r.note_id));
  console.log(`${shared.size} notes reviewed by all of ${picked.join(", ")}.\n`);
}
const verdicts = new Map(
  (await all<{ note_id: string; verdict: string }>("verdicts", "note_id, verdict", (q) => q.eq("source", "x"))).map((v) => [v.note_id, v.verdict]),
);
const models = [...new Set(reviews.map((r) => r.model))].sort();
const recommendation = new Map(reviews.map((r) => [`${r.model} ${r.note_id}`, r.recommendation]));

const kappaText = (a: Agreement) =>
  a.kappa === null ? "-" : `κ ${a.kappa.toFixed(2)}${a.kappaCi ? ` (${a.kappaCi[0].toFixed(2)} to ${a.kappaCi[1].toFixed(2)})` : ""}`;
const binary = (verdict: string | undefined) => verdict === "taste_failure" || verdict === "fine";

console.log("model | notes | taste failure | vs labellers | cost known | total cost | cost per review | tokens in/out per review");
for (const model of models) {
  const mine = reviews.filter((r) => r.model === model);
  const vs = agreement(mine.filter((r) => binary(verdicts.get(r.note_id))).map((r) => ({ truth: verdicts.get(r.note_id) === "taste_failure", call: r.recommendation === "taste_failure" })));
  const costed = mine.filter((r) => r.cost_usd !== null);
  const total = costed.reduce((sum, r) => sum + Number(r.cost_usd), 0);
  const metered = mine.filter((r) => r.input_tokens !== null);
  const avg = (key: "input_tokens" | "output_tokens") => (metered.length ? Math.round(metered.reduce((s, r) => s + Number(r[key]), 0) / metered.length) : "-");
  console.log(
    [
      model,
      mine.length,
      pct(mine.filter((r) => r.recommendation === "taste_failure").length, mine.length),
      vs.notes
        ? `${kappaText(vs)}, ${pct(vs.caught + vs.cleared, vs.notes)} agree (baseline ${pct(Math.round(vs.baseline * vs.notes), vs.notes)}), caught ${vs.caught} of ${vs.caught + vs.missed} failures, on ${vs.notes}`
        : "no labelled notes",
      `${costed.length}`,
      costed.length ? `$${total.toFixed(2)}` : "-",
      costed.length ? `$${(total / costed.length).toFixed(4)}` : "-",
      `${avg("input_tokens")}/${avg("output_tokens")}`,
    ].join(" | "),
  );
}

if (models.length > 1) {
  console.log("\nmodel pair | notes both reviewed | agree | kappa");
  for (const [i, a] of models.entries()) {
    for (const b of models.slice(i + 1)) {
      const both = reviews.filter((r) => r.model === a && recommendation.has(`${b} ${r.note_id}`));
      const agree = both.filter((r) => recommendation.get(`${b} ${r.note_id}`) === r.recommendation).length;
      const pair = agreement(both.map((r) => ({ truth: recommendation.get(`${b} ${r.note_id}`) === "taste_failure", call: r.recommendation === "taste_failure" })));
      console.log(`${a} vs ${b} | ${both.length} | ${pct(agree, both.length)} | ${kappaText(pair)}`);
    }
  }
}
