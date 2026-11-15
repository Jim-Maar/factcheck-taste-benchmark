import { target } from "../import/db";

/* Draws a review set: a reproducible stratified random sample of the X notes
 * on posts still on X, for the models to review and the labellers to label.
 * Run from the repository root:
 *
 *   bun scripts/ai/sample.ts <name>         writes scripts/ai/sets/<name>.txt and <name>.json
 *   --notes <n>                             how many notes (default 1000)
 *   --not-helpful-share <share>             the share of the set rated not helpful (default 0.5)
 *   --max-writer-share <share>              the most of each stratum one notewriter may have (default 0.1)
 *   --include-ours                          also draw from the team's own notewriter (x_notewriters.is_ours)
 *   --seed <n>                              the seed of the random order (default 1)
 *   --by-shuffle                            order by x_notes.shuffle instead of the seed
 *   --first <set file>                      put every note of this set in first, counted in the quotas
 *   --from <set file>                       draw only from the notes of this set
 *   --unjudged                              leave out notes a labeller has already judged
 *
 * The strata are X's rating, helpful or not helpful. Not helpful notes are
 * about 4% of the notes but half the set by default, so the models and the
 * labellers see enough of them. The cap keeps a notewriter that wrote most
 * of the notes from filling the set. Both make the set unlike the
 * population, so the JSON beside it records the population's and the set's
 * count in every stratum and notewriter, and scripts/ai/compare.ts
 * --prevalence weights by them.
 *
 * The seeded order is a hash of the seed and the note id, so a note keeps its
 * place when later imports add other notes, and the same database gives the
 * same set. The set file is one note id per line, the shape run.ts and the
 * review_sets migrations read.
 */

const STRATA = ["helpful", "not_helpful"] as const;
type Stratum = (typeof STRATA)[number];

interface Note {
  note_id: string;
  tweet_id: string;
  author_id: string;
  status: Stratum;
  shuffle: number;
}

function flag(name: string): boolean {
  const at = args.indexOf(name);
  if (at === -1) return false;
  args.splice(at, 1);
  return true;
}

function option(name: string): string | undefined {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const [, value] = args.splice(at, 2);
  if (value === undefined) throw new Error(`${name} needs a value`);
  return value;
}

const args = process.argv.slice(2);
const notes = Number(option("--notes") ?? 1000);
const notHelpfulShare = Number(option("--not-helpful-share") ?? 0.5);
const maxWriterShare = Number(option("--max-writer-share") ?? 0.1);
const seed = Number(option("--seed") ?? 1);
const firstFile = option("--first");
const fromFile = option("--from");
const includeOurs = flag("--include-ours");
const byShuffle = flag("--by-shuffle");
const unjudged = flag("--unjudged");
const [name, ...rest] = args;
if (!name || rest.length) throw new Error("Usage: bun scripts/ai/sample.ts <name> [options], see the comment at the top");

/** Every row of a table, a thousand at a time, in the order of a unique key. */
async function all<T>(table: string, columns: string, order: string, filter: (q: any) => any = (q) => q): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(target.from(table).select(columns)).order(order).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as T[]));
    if (data.length < 1000) return rows;
  }
}

const readSet = async (path: string) => new Set((await Bun.file(path).text()).split("\n").map((l) => l.trim()).filter(Boolean));

/** A 32-bit hash of the seed and a note id (FNV-1a, then murmur3's finaliser). */
function rank(id: string): number {
  let h = 0x811c9dc5 ^ seed;
  for (const c of `${seed}:${id}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const [allNotes, availablePosts, writerRows, verdictRows] = await Promise.all([
  all<Note>("x_notes", "note_id, tweet_id, author_id, status, shuffle", "note_id", (q) => q.in("status", STRATA)),
  all<{ tweet_id: string }>("x_posts", "tweet_id", "tweet_id", (q) => q.eq("available", true)),
  all<{ author_id: string; name: string; is_ours: boolean }>("x_notewriters", "author_id, name, is_ours", "author_id"),
  unjudged ? all<{ note_id: string }>("verdicts", "note_id", "note_id", (q) => q.eq("source", "x")) : Promise.resolve([]),
]);
const available = new Set(availablePosts.map((p) => p.tweet_id));
const writers = new Map(writerRows.map((w) => [w.author_id, w]));
const population = allNotes.filter((n) => available.has(n.tweet_id) && (includeOurs || !writers.get(n.author_id)?.is_ours));
const first = firstFile ? await readSet(firstFile) : new Set<string>();
const from = fromFile ? await readSet(fromFile) : null;
const judged = new Set(verdictRows.map((v) => v.note_id));
const pool = population.filter((n) => (!from || from.has(n.note_id)) && !judged.has(n.note_id));
const missingFirst = [...first].filter((id) => !population.some((n) => n.note_id === id));
if (missingFirst.length) console.warn(`${missingFirst.length} notes of ${firstFile} aren't in the population (post gone, needs ratings or our notewriter); left out.`);

const quota: Record<Stratum, number> = { not_helpful: Math.round(notes * notHelpfulShare), helpful: notes - Math.round(notes * notHelpfulShare) };
const cap = (stratum: Stratum) => Math.max(1, Math.floor(maxWriterShare * quota[stratum]));
const order = (a: Note, b: Note) => (byShuffle ? a.shuffle - b.shuffle : rank(a.note_id) - rank(b.note_id)) || a.note_id.localeCompare(b.note_id);

const picked: Note[] = [];
const taken = new Map<string, number>();
const take = (n: Note) => {
  picked.push(n);
  taken.set(`${n.status} ${n.author_id}`, (taken.get(`${n.status} ${n.author_id}`) ?? 0) + 1);
};
for (const n of population.filter((n) => first.has(n.note_id)).sort(order)) take(n);
for (const stratum of STRATA) {
  let have = picked.filter((n) => n.status === stratum).length;
  for (const n of pool.filter((n) => n.status === stratum && !first.has(n.note_id)).sort(order)) {
    if (have >= quota[stratum]) break;
    if ((taken.get(`${stratum} ${n.author_id}`) ?? 0) >= cap(stratum)) continue;
    take(n);
    have++;
  }
  if (have < quota[stratum]) console.warn(`Only ${have} of ${quota[stratum]} ${stratum} notes: the pool ran out under the cap of ${cap(stratum)} per notewriter.`);
}

/** The count of notes in each stratum and, within it, each notewriter. */
function breakdown(of: Note[]) {
  return Object.fromEntries(
    STRATA.map((stratum) => {
      const inStratum = of.filter((n) => n.status === stratum);
      const byWriter = Map.groupBy(inStratum, (n) => n.author_id);
      return [
        stratum,
        {
          notes: inStratum.length,
          share: of.length ? inStratum.length / of.length : 0,
          writers: Object.fromEntries(
            [...byWriter].sort(([a], [b]) => a.localeCompare(b)).map(([id, ns]) => [id, { name: writers.get(id)?.name ?? id, notes: ns.length }]),
          ),
        },
      ];
    }),
  );
}

const ids = picked.map((n) => n.note_id);
const base = `scripts/ai/sets/${name}`;
await Bun.write(`${base}.txt`, `${ids.join("\n")}\n`);
await Bun.write(
  `${base}.json`,
  `${JSON.stringify(
    {
      name,
      drawnAt: new Date().toISOString(),
      params: { notes, notHelpfulShare, maxWriterShare, capPerStratum: { helpful: cap("helpful"), not_helpful: cap("not_helpful") }, includeOurs, seed: byShuffle ? null : seed, byShuffle, first: firstFile ?? null, from: fromFile ?? null, unjudged },
      population: { notes: population.length, strata: breakdown(population) },
      pool: { notes: pool.length },
      sample: { notes: picked.length, strata: breakdown(picked) },
    },
    null,
    2,
  )}\n`,
);

console.log(`${picked.length} notes to ${base}.txt, the parameters and proportions to ${base}.json.`);
console.log(`Population: ${population.length} notes on posts still on X${includeOurs ? "" : ", not counting our notewriter's"}; drawn from ${pool.length}.`);
for (const stratum of STRATA) {
  const p = population.filter((n) => n.status === stratum).length;
  const s = picked.filter((n) => n.status === stratum).length;
  console.log(`  ${stratum}: ${s} in the set (${Math.round((100 * s) / picked.length)}%), ${p} in the population (${((100 * p) / population.length).toFixed(1)}%)`);
}
const byWriter = Map.groupBy(picked, (n) => n.author_id);
for (const [id, ns] of [...byWriter].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${writers.get(id)?.name ?? id}: ${ns.length} (${ns.filter((n) => n.status === "helpful").length} helpful, ${ns.filter((n) => n.status === "not_helpful").length} not helpful)`);
}
