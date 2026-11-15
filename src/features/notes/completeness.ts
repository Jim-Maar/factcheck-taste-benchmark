import type { Accuracy, NeedsNote, Verdict } from "@cn/core/taste";

/** What a labeller still owes a note. */
export type Missing = "needsNote" | "accuracy" | "verdict" | "label";

const QUESTION_NAMES: Record<Exclude<Missing, "label">, string> = { needsNote: "needs a note", accuracy: "accuracy", verdict: "taste failure" };

const joinAnd = (parts: readonly string[]) => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

/** What a note's review still lacks. A note is finished when all three
 *  questions have an answer. Labels are optional, except that a note judged a
 *  taste failure needs at least one, to say what kind of failure it is. */
export function missingAnswers({ needsNote, accuracy, verdict, labelCount }: { needsNote: NeedsNote | null; accuracy: Accuracy | null; verdict: Verdict | null; labelCount: number }): Missing[] {
  const missing: Missing[] = [];
  if (needsNote === null) missing.push("needsNote");
  if (accuracy === null) missing.push("accuracy");
  if (verdict === null) missing.push("verdict");
  if (verdict === "taste_failure" && labelCount === 0) missing.push("label");
  return missing;
}

/** What is missing as an instruction for the Unfinished line, such as
 *  "answer accuracy and add a label". */
export function missingText(missing: readonly Missing[]): string {
  const questions = missing.filter((part): part is Exclude<Missing, "label"> => part !== "label").map((part) => QUESTION_NAMES[part]);
  return joinAnd([...(questions.length ? [`answer ${joinAnd(questions)}`] : []), ...(missing.includes("label") ? ["add a label"] : [])]);
}
