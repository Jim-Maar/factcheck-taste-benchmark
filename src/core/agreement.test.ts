import { describe, expect, test } from "bun:test";
import { agreement, wilson, type Pair } from "./agreement";

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
});
