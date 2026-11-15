import { describe, expect, test } from "bun:test";
import { labelAxes, labelCounts, modelRecall, modelStats, reviewCost, splits, writerFailures, writerStats, type Split, type SummaryData, type SummaryReview } from "./summary";

const review = (noteId: string, model: string, recommendation: "taste_failure" | "fine", labels: string[] = [], more: Partial<SummaryReview> = {}): SummaryReview => ({
  noteId, model, recommendation, labels, inputTokens: null, cachedInputTokens: null, outputTokens: null, costUsd: null, ...more,
});

const data: SummaryData = {
  reviews: [
    review("a", "m1", "taste_failure", ["pedantic"], { costUsd: 0.5 }),
    review("b", "m1", "fine"),
    review("c", "m1", "taste_failure", ["missed-joke"]),
    review("a", "gpt-6-luna", "fine", [], { inputTokens: 1_100_000, cachedInputTokens: 1_000_000, outputTokens: 10_000 }),
  ],
  verdicts: new Map([["a", "taste_failure"], ["b", "taste_failure"], ["c", "unsure"], ["d", "fine"]]),
  needsNote: new Map([["a", "no"], ["b", "yes"], ["c", "unsure"], ["d", "no"]]),
  handLabels: new Map([["a", ["Pedantic"]], ["b", ["Pedantic", "missed-joke"]], ["d", []]]),
  labelNames: ["Pedantic", "missed-joke", "unclear"],
  writers: new Map([["a", { id: "w1", name: "W1" }], ["b", { id: "w1", name: "W1" }], ["c", { id: "w2", name: "W2" }], ["d", { id: "w2", name: "W2" }]]),
};

describe("summary", () => {
  test("estimates a cost from tokens at list price only when no dollars were reported", () => {
    expect(reviewCost(data.reviews[0]!)).toEqual({ usd: 0.5, estimated: false });
    expect(reviewCost(data.reviews[1]!)).toBeNull();
    // 100k uncached at $0.10, 1M cached at $0.01, 10k out at $0.50.
    expect(reviewCost(data.reviews[3]!)!.usd).toBeCloseTo(0.01 + 0.01 + 0.005);
    expect(reviewCost(data.reviews[3]!)!.estimated).toBe(true);
  });

  test("counts agreement only on notes judged taste failure or fine", () => {
    const m1 = modelStats(data).find((m) => m.model === "m1")!;
    expect([m1.reviews, m1.tasteFailures, m1.comparable, m1.agreed]).toEqual([3, 2, 2, 1]);
    expect([m1.costed, m1.costUsd, m1.estimated]).toEqual([1, 0.5, false]);
  });

  test("puts only hand-given labels on the axes, most given first", () => {
    expect(labelAxes(data)).toEqual([{ label: "Pedantic", notes: 2 }, { label: "missed-joke", notes: 1 }]);
  });

  test("scores a model on the hand-labelled notes it reviewed, ignoring case", () => {
    expect(modelRecall(data, "m1", ["Pedantic", "missed-joke"])).toEqual([{ share: 0.5, hits: 1, of: 2 }, { share: 0, hits: 0, of: 1 }]);
    expect(modelRecall(data, "gpt-6-luna", ["missed-joke"])).toEqual([{ share: null, hits: 0, of: 0 }]);
  });

  test("splits each judge's notes by the commonest label of each failure", () => {
    const [hand, m1] = splits(data, ["Pedantic", "missed-joke"], ["m1"]);
    const show = (s: Split) => s.parts.map((p) => [p.part.kind === "label" ? p.part.label : p.part.kind, p.notes]);
    expect(show(hand!)).toEqual([["Pedantic", 2], ["unsure", 1], ["fine", 1]]);
    expect(show(m1!)).toEqual([["Pedantic", 1], ["missed-joke", 1], ["fine", 1]]);
    expect(splits(data, [], ["m1"])[1]!.parts.map((p) => p.part.kind)).toEqual(["other", "fine"]);
  });

  test("counts each judge's labels, most given first, matching a model's spelling", () => {
    const counts = labelCounts({ ...data, reviews: [...data.reviews, review("b", "m1", "taste_failure", ["PEDANTIC", "made-up"])] }, ["m1", "gpt-6-luna"]);
    expect(counts.labels).toEqual(["Pedantic", "missed-joke", "made-up"]);
    expect(counts.hand).toEqual([2, 1, 0]);
    expect(counts.byModel).toEqual([{ model: "m1", counts: [2, 1, 1] }, { model: "gpt-6-luna", counts: [0, 0, 0] }]);
  });

  test("scores notewriters on their judged notes", () => {
    expect(writerFailures(data, "w1", ["Pedantic"])).toEqual([{ share: 1, hits: 2, of: 2 }]);
    expect(writerFailures(data, null, ["Pedantic"])).toEqual([{ share: 0.5, hits: 2, of: 4 }]);
    expect(writerStats(data).map((w) => [w.name, w.judged, w.tasteFailures, w.askedNeed, w.notNeeded])).toEqual([["W1", 2, 2, 2, 1], ["W2", 2, 0, 1, 1]]);
  });
});
