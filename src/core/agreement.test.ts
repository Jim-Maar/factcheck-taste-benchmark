import { describe, expect, test } from "bun:test";
import { agreement, correctedPrevalence, fleissKappa, kappaText, wilson, type Pair } from "./agreement";

const pairs = (spec: [boolean, boolean, number][]): Pair[] => spec.flatMap(([truth, call, n]) => Array.from({ length: n }, () => ({ truth, call })));

describe("agreement", () => {
  test("matches Fable's table on the 47 judged notes", () => {
    // 14 caught, 3 missed, 22 cleared, 8 false alarms: kappa 0.52.
    const a = agreement(pairs([[true, true, 14], [true, false, 3], [false, false, 22], [false, true, 8]]));
    expect([a.caught, a.missed, a.cleared, a.falseAlarms]).toEqual([14, 3, 22, 8]);
    expect(a.agreement).toBeCloseTo(36 / 47);
    expect(a.baseline).toBeCloseTo(30 / 47);
    expect(a.kappa!).toBeCloseTo(0.52, 2);
    expect(a.kappaCi![0]).toBeLessThan(a.kappa!);
    expect(a.kappaCi![1]).toBeGreaterThan(a.kappa!);
  });

  test("gives a judge that always says fine a kappa of 0, however often it agrees", () => {
    const a = agreement(pairs([[true, false, 3], [false, false, 7]]));
    expect(a.agreement).toBeCloseTo(0.7);
    expect(a.kappa).toBe(0);
  });

  test("leaves kappa undefined when both always give the same answer", () => {
    expect(agreement(pairs([[false, false, 5]])).kappa).toBeNull();
  });

  test("gives the Wilson interval of a proportion", () => {
    const [low, high] = wilson(36, 47);
    expect(low).toBeCloseTo(0.627, 2);
    expect(high).toBeCloseTo(0.861, 2);
  });

  test("says n too small for a kappa on fewer than ten notes", () => {
    expect(kappaText(agreement(pairs([[true, true, 4], [false, false, 5]])))).toBe("n too small");
    expect(kappaText(agreement(pairs([[true, true, 5], [false, false, 5]])))).toMatch(/^1\.00/);
  });

  test("gives Fleiss' kappa of several judges", () => {
    // Two judges: Fleiss' kappa is close to Cohen's when their rates match.
    const rows = [...Array(10).fill([true, true]), ...Array(10).fill([false, false]), [true, false], [false, true]];
    expect(fleissKappa(rows)!).toBeCloseTo(1 - (2 / 22) / 0.5, 5);
    expect(fleissKappa([[true, true, true], [true, true, true]])).toBeNull();
    expect(fleissKappa([[true]])).toBeNull();
  });
});

describe("corrected prevalence", () => {
  test("undoes a judge's known errors", () => {
    // True rate 10%: sensitivity 0.8 and specificity 0.9 give a raw rate of 0.08 + 0.09 = 0.17.
    const p = correctedPrevalence([{ weight: 1, positives: 170, notes: 1000 }], { hits: 80, of: 100 }, { hits: 90, of: 100 });
    expect(p.raw).toBeCloseTo(0.17);
    expect(p.estimate!).toBeCloseTo(0.1, 5);
    expect(p.ci![0]).toBeLessThan(0.1);
    expect(p.ci![1]).toBeGreaterThan(0.1);
    // The interval carries the uncertainty of sensitivity and specificity, so it is wider than the raw rate's alone.
    expect(p.ci![1] - p.ci![0]).toBeGreaterThan(wilson(170, 1000)[1] - wilson(170, 1000)[0]);
  });

  test("clamps to 0 and gives up on a judge no better than chance", () => {
    expect(correctedPrevalence([{ weight: 1, positives: 5, notes: 100 }], { hits: 8, of: 10 }, { hits: 8, of: 10 }).estimate).toBe(0);
    const chance = correctedPrevalence([{ weight: 1, positives: 50, notes: 100 }], { hits: 5, of: 10 }, { hits: 5, of: 10 });
    expect([chance.estimate, chance.ci]).toEqual([null, null]);
    expect(correctedPrevalence([{ weight: 1, positives: 5, notes: 100 }], { hits: 0, of: 0 }, { hits: 8, of: 10 }).estimate).toBeNull();
  });

  test("weights strata back to the population", () => {
    // Half the sample from a stratum that is 4% of the population.
    const p = correctedPrevalence([{ weight: 0.96, positives: 10, notes: 100 }, { weight: 0.04, positives: 60, notes: 100 }], { hits: 1, of: 1 }, { hits: 1, of: 1 });
    expect(p.raw).toBeCloseTo(0.96 * 0.1 + 0.04 * 0.6);
    expect(p.estimate!).toBeCloseTo(p.raw);
  });
});
