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
