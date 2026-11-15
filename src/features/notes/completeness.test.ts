import { describe, expect, test } from "bun:test";
import { missingAnswers, missingText } from "./completeness";

describe("missingAnswers", () => {
  test("a note with every answer is finished", () => {
    expect(missingAnswers({ needsNote: "yes", accuracy: "correct", verdict: "fine", labelCount: 0 })).toEqual([]);
  });
  test("lists each unanswered question", () => {
    expect(missingAnswers({ needsNote: null, accuracy: null, verdict: "fine", labelCount: 0 })).toEqual(["needsNote", "accuracy"]);
  });
  test("a taste failure needs a label", () => {
    expect(missingAnswers({ needsNote: "no", accuracy: "wrong", verdict: "taste_failure", labelCount: 0 })).toEqual(["label"]);
    expect(missingAnswers({ needsNote: "no", accuracy: "wrong", verdict: "taste_failure", labelCount: 1 })).toEqual([]);
  });
});

describe("missingText", () => {
  test("joins the parts in a phrase", () => {
    expect(missingText(["accuracy"])).toBe("answer accuracy");
    expect(missingText(["needsNote", "accuracy"])).toBe("answer needs a note and accuracy");
    expect(missingText(["needsNote", "accuracy", "verdict"])).toBe("answer needs a note, accuracy and taste failure");
    expect(missingText(["accuracy", "label"])).toBe("answer accuracy and add a label");
    expect(missingText(["label"])).toBe("add a label");
  });
});
