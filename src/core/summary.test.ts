import { describe, expect, test } from "bun:test";
import { commonNotes, judgedNotes, labelAxes, labelCounts, modelAgreement, modelRecall, modelStats, promptVersions, reviewCost, sameProtocol, splits, totals, weightedRate, writerLabelShares, writerStats, withoutTriedModels, LABELLERS, UNRECORDED_PROMPT, type Split, type SummaryData, type SummaryReview } from "./summary";

const review = (noteId: string, model: string, recommendation: "taste_failure" | "fine", labels: string[] = [], more: Partial<SummaryReview> = {}): SummaryReview => ({
  noteId, model, recommendation, labels, inputTokens: null, cachedInputTokens: null, outputTokens: null, costUsd: null, harness: "claude-code", promptVersion: null, createdAt: "2026-11-15T00:00:00Z", ...more,
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
  xStatus: new Map([["a", "not_helpful"], ["b", "not_helpful"], ["c", "helpful"], ["d", "helpful"]]),
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
    expect([m1.reviews, m1.tasteFailures, m1.vsLabellers.notes, m1.vsLabellers.caught, m1.vsLabellers.missed]).toEqual([3, 2, 2, 1, 1]);
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
    expect(counts.byModel).toEqual([{ model: "m1", counts: [2, 1, 1], notes: 3 }, { model: "gpt-6-luna", counts: [0, 0, 0], notes: 1 }]);
  });

  test("leaves out models with fewer than five reviews", () => {
    const many = Array.from({ length: 5 }, (_, i) => review(`n${i}`, "big", "fine"));
    expect(withoutTriedModels({ ...data, reviews: [...data.reviews, ...many] }).reviews.map((r) => r.model)).toEqual(Array(5).fill("big"));
  });

  test("scores notewriters on their judged notes", () => {
    expect(writerLabelShares(data, LABELLERS, "w1", ["Pedantic"])).toEqual([{ share: 1, hits: 2, of: 2 }]);
    // The unsure note c is left out of the labellers' notes.
    expect(writerLabelShares(data, LABELLERS, null, ["Pedantic"])).toEqual([{ share: 2 / 3, hits: 2, of: 3 }]);
    // Judged by a model: m1 reviewed W2's note c only, and gave it missed-joke.
    expect(writerLabelShares(data, "m1", "w2", ["Pedantic", "missed-joke"])).toEqual([{ share: 0, hits: 0, of: 1 }, { share: 1, hits: 1, of: 1 }]);
    expect(writerStats(data).map((w) => [w.name, w.judged, w.decided, w.tasteFailures, w.askedNeed, w.notNeeded])).toEqual([["W1", 2, 2, 2, 2, 1], ["W2", 2, 1, 0, 1, 1]]);
  });

  test("counts as labelled only fine notes and failures with a label", () => {
    const more: SummaryData = { ...data, verdicts: new Map([...data.verdicts, ["e", "taste_failure"], ["f", "somewhat"]]) };
    expect([...judgedNotes(more, LABELLERS).keys()]).toEqual(["a", "b", "d"]);
    expect([...commonNotes(more, [LABELLERS, "m1"])]).toEqual(["a", "b"]);
    const counts = labelCounts(more, ["m1"], commonNotes(more, [LABELLERS, "m1"]));
    expect([counts.handNotes, counts.byModel[0]!.notes]).toEqual([2, 2]);
    expect(writerLabelShares(more, "m1", null, ["Pedantic"], new Set(["a", "b"]))).toEqual([{ share: 0.5, hits: 1, of: 2 }]);
  });

  test("keeps only run.ts reviews with the picked prompt, newest prompt first", () => {
    const mixed: SummaryData = {
      ...data,
      reviews: [
        review("a", "m1", "fine", [], { harness: null }),
        review("b", "m1", "fine", [], { promptVersion: "v1", createdAt: "2026-11-14T00:00:00Z" }),
        review("c", "m1", "fine", [], { promptVersion: "v2", createdAt: "2026-11-16T00:00:00Z" }),
        review("d", "m1", "fine"),
      ],
    };
    expect(promptVersions(mixed).map((p) => [p.id, p.reviews])).toEqual([["v2", 1], [UNRECORDED_PROMPT, 1], ["v1", 1]]);
    expect(sameProtocol(mixed, null).reviews.map((r) => r.noteId)).toEqual(["b", "c", "d"]);
    expect(sameProtocol(mixed, "v1").reviews.map((r) => r.noteId)).toEqual(["b"]);
    expect(sameProtocol(mixed, UNRECORDED_PROMPT).reviews.map((r) => r.noteId)).toEqual(["d"]);
  });

  test("compares the models with each other on the notes both reviewed", () => {
    const three: SummaryData = { ...data, reviews: [...data.reviews, review("a", "m3", "taste_failure"), review("b", "m3", "fine")] };
    const result = modelAgreement(three, ["m1", "gpt-6-luna", "m3"]);
    expect(result.pairs.map((p) => [p.a, p.b, p.agreement.notes])).toEqual([["m1", "gpt-6-luna", 1], ["m1", "m3", 2], ["gpt-6-luna", "m3", 1]]);
    expect(result.fleissNotes).toBe(1);
  });
  test("weights a split rate to X's mix of helpful and not-helpful notes", () => {
    expect(weightedRate({ helpful: { failures: 1, notes: 10 }, notHelpful: { failures: 5, notes: 10 } })).toBeCloseTo(0.965 * 0.1 + 0.035 * 0.5);
    expect(weightedRate({ helpful: { failures: 0, notes: 0 }, notHelpful: { failures: 1, notes: 2 } })).toBe(0.5);
    expect(weightedRate({ helpful: { failures: 0, notes: 0 }, notHelpful: { failures: 0, notes: 0 } })).toBeNull();
  });

  test("splits taste-failure rates by X's rating", () => {
    const m1 = modelStats(data).find((m) => m.model === "m1")!;
    expect(m1.failuresByStatus).toEqual({ helpful: { failures: 1, notes: 1 }, notHelpful: { failures: 1, notes: 2 } });
    // The labellers: a and b failed (not helpful), d fine (helpful), c unsure left out.
    expect(totals(data, []).failuresByStatus).toEqual({ helpful: { failures: 0, notes: 1 }, notHelpful: { failures: 2, notes: 2 } });
  });
});
