/* How well a judge's yes/no calls agree with the labellers', beyond what
 * guessing would give. Pure functions, so both the Summary tab and
 * scripts/ai/compare.ts use them. "Positive" is a taste failure. */

/** One note: what the labellers called it and what the judge called it. */
export interface Pair {
  truth: boolean;
  call: boolean;
}

export interface Agreement {
  notes: number;
  /** Taste failures the judge caught and missed; fine notes it called fine
   *  and called failures. */
  caught: number;
  missed: number;
  cleared: number;
  falseAlarms: number;
  agreement: number;
  agreementCi: [number, number];
  /** What always answering the labellers' commoner answer would agree. */
  baseline: number;
  /** Cohen's kappa: 0 is chance, 1 is perfect. Null when it is undefined,
   *  such as when every note got the same answer from both. */
  kappa: number | null;
  kappaCi: [number, number] | null;
}

function kappaOf(pairs: Pair[]): number | null {
  const n = pairs.length;
  if (!n) return null;
  const both = pairs.filter((p) => p.truth && p.call).length;
  const neither = pairs.filter((p) => !p.truth && !p.call).length;
  const truthYes = pairs.filter((p) => p.truth).length;
  const callYes = pairs.filter((p) => p.call).length;
  const observed = (both + neither) / n;
  const expected = (truthYes * callYes + (n - truthYes) * (n - callYes)) / (n * n);
  return expected === 1 ? null : (observed - expected) / (1 - expected);
}

/** The Wilson score interval of a proportion, at 95%. */
export function wilson(hits: number, n: number): [number, number] {
  if (!n) return [0, 1];
  const z = 1.96;
  const p = hits / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** A small seeded random number generator (mulberry32), so the bootstrap
 *  gives the same interval on every load. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 95% percentile bootstrap interval of kappa, resampling the notes. */
function kappaInterval(pairs: Pair[], resamples = 2000): [number, number] | null {
  const random = seeded(1);
  const kappas: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const sample = pairs.map(() => pairs[Math.floor(random() * pairs.length)]!);
    const k = kappaOf(sample);
    if (k !== null) kappas.push(k);
  }
  if (kappas.length < resamples / 2) return null;
  kappas.sort((a, b) => a - b);
  return [kappas[Math.floor(kappas.length * 0.025)]!, kappas[Math.ceil(kappas.length * 0.975) - 1]!];
}

export function agreement(pairs: Pair[]): Agreement {
  const n = pairs.length;
  const agreed = pairs.filter((p) => p.truth === p.call).length;
  const truthYes = pairs.filter((p) => p.truth).length;
  const kappa = kappaOf(pairs);
  return {
    notes: n,
    caught: pairs.filter((p) => p.truth && p.call).length,
    missed: pairs.filter((p) => p.truth && !p.call).length,
    cleared: pairs.filter((p) => !p.truth && !p.call).length,
    falseAlarms: pairs.filter((p) => !p.truth && p.call).length,
    agreement: n ? agreed / n : 0,
    agreementCi: wilson(agreed, n),
    baseline: n ? Math.max(truthYes, n - truthYes) / n : 0,
    kappa,
    kappaCi: kappa === null ? null : kappaInterval(pairs),
  };
}

/** The fewest notes a kappa is shown for; below it the interval is so wide
 *  the number says nothing. */
export const MIN_KAPPA_NOTES = 10;

/** Kappa with its interval as text, "n too small" under MIN_KAPPA_NOTES. */
export function kappaText(a: Agreement, none = "–"): string {
  if (a.notes < MIN_KAPPA_NOTES) return "n too small";
  if (a.kappa === null) return none;
  return `${a.kappa.toFixed(2)}${a.kappaCi ? ` (${a.kappaCi[0].toFixed(2)} to ${a.kappaCi[1].toFixed(2)})` : ""}`;
}

/** Fleiss' kappa of several judges' yes/no calls: one row per note, every
 *  row from the same judges. Null when it is undefined, such as when there
 *  are fewer than two judges or every call was the same. */
export function fleissKappa(rows: boolean[][]): number | null {
  const n = rows.length;
  const m = rows[0]?.length ?? 0;
  if (!n || m < 2 || rows.some((r) => r.length !== m)) return null;
  let agreeing = 0;
  let yes = 0;
  for (const row of rows) {
    const y = row.filter(Boolean).length;
    yes += y;
    agreeing += (y * y + (m - y) * (m - y) - m) / (m * (m - 1));
  }
  const observed = agreeing / n;
  const p = yes / (n * m);
  const expected = p * p + (1 - p) * (1 - p);
  return expected === 1 ? null : (observed - expected) / (1 - expected);
}

/** A draw from Gamma(shape, 1) (Marsaglia and Tsang), for the Beta draws below. */
function gamma(shape: number, random: () => number): number {
  if (shape < 1) return gamma(shape + 1, random) * Math.pow(random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      // A standard normal by Box and Muller.
      x = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** A proportion drawn from its Jeffreys posterior, Beta(hits + ½, misses + ½),
 *  which stays sensible at 0 of n and n of n. */
function drawShare(hits: number, of: number, random: () => number): number {
  const a = gamma(hits + 0.5, random);
  return a / (a + gamma(of - hits + 0.5, random));
}

/** A count out of a total, such as failures caught out of failures. */
export interface Count {
  hits: number;
  of: number;
}

export interface Prevalence {
  /** The judge's own share of positives, weighted by stratum. */
  raw: number;
  notes: number;
  sensitivity: number | null;
  specificity: number | null;
  /** The corrected share, clamped to 0 to 1; null when the judge is no
   *  better than chance on the labelled notes (sensitivity + specificity ≤ 1)
   *  or either was measured on no notes. */
  estimate: number | null;
  ci: [number, number] | null;
}

/** How common taste failures really are among notes no labeller has seen,
 *  from a judge's calls on them and how well it does on the labelled notes:
 *  the Rogan–Gladen estimate (raw + specificity − 1) / (sensitivity +
 *  specificity − 1). Each stratum is a part of the population with its share
 *  of it (`weight`, summing to 1) and the judge's positives among the notes
 *  it reviewed there, so a stratified sample is weighted back to the
 *  population. The 95% interval is a seeded parametric bootstrap that draws
 *  every stratum's rate, the sensitivity and the specificity from their
 *  Jeffreys posteriors, so the uncertainty of all three is carried through. */
export function correctedPrevalence(
  strata: { weight: number; positives: number; notes: number }[],
  sensitivity: Count,
  specificity: Count,
  resamples = 2000,
): Prevalence {
  const used = strata.filter((s) => s.notes > 0 && s.weight > 0);
  const total = used.reduce((s, x) => s + x.weight, 0);
  const notes = used.reduce((s, x) => s + x.notes, 0);
  const raw = total ? used.reduce((s, x) => s + (x.weight / total) * (x.positives / x.notes), 0) : 0;
  const se = sensitivity.of ? sensitivity.hits / sensitivity.of : null;
  const sp = specificity.of ? specificity.hits / specificity.of : null;
  const correct = (rate: number, se: number, sp: number) => (se + sp - 1 <= 0 ? null : Math.min(1, Math.max(0, (rate + sp - 1) / (se + sp - 1))));
  const base = { raw, notes, sensitivity: se, specificity: sp };
  if (se === null || sp === null || !notes) return { ...base, estimate: null, ci: null };
  const estimate = correct(raw, se, sp);
  if (estimate === null) return { ...base, estimate, ci: null };
  const random = seeded(2);
  const draws: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const rate = used.reduce((s, x) => s + (x.weight / total) * drawShare(x.positives, x.notes, random), 0);
    const d = correct(rate, drawShare(sensitivity.hits, sensitivity.of, random), drawShare(specificity.hits, specificity.of, random));
    if (d !== null) draws.push(d);
  }
  if (draws.length < resamples / 2) return { ...base, estimate, ci: null };
  draws.sort((a, b) => a - b);
  return { ...base, estimate, ci: [draws[Math.floor(draws.length * 0.025)]!, draws[Math.ceil(draws.length * 0.975) - 1]!] };
}
