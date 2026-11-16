import { parseCsv } from "@cn/shared/csv";
import type { NoteStatus } from "./noteScore";
import { supabase } from "./supabase";
import type { XNote } from "./taste";

/* The notewriter eval of eval/README.md: 200 posts on X, each labelled with
 * whether a good notewriter writes a community note on it, and the answers of
 * every model run on it. The labels and answers are read from the files in
 * eval/, so a new results file shows up here once it is committed. The posts
 * come from the database, as the Community Notes tab shows them. */

export type Decision = "write_note" | "no_note";

export interface EvalPost {
  tweetId: string;
  label: Decision;
  /** The AI note on X behind the label: rated helpful for write_note, not
   *  helpful for no_note. */
  referenceNote: { id: string; text: string; status: NoteStatus };
  /** Why the judge called the note a taste failure, for no_note posts. */
  judgeReasoning: string;
}

export interface EvalAnswer {
  decision: Decision;
  note: string;
  reasoning: string;
}

/** One model's run over the eval, named after its results file. */
export interface EvalRun {
  id: string;
  /** The model's name, such as "Opus 5.5". */
  model: string;
  effort: string;
  answers: Map<string, EvalAnswer>;
}

export interface EvalData {
  posts: EvalPost[];
  runs: EvalRun[];
}

/* Vite reads these files when the site is built, as text, into a chunk of
 * their own that loads only when the eval tab opens. */
const EVAL_CSV = import.meta.glob<string>("/eval/notewriter-eval.csv", { query: "?raw", import: "default" });
const RESULT_FILES = import.meta.glob<string>("/eval/results/*.jsonl", { query: "?raw", import: "default" });

/** "claude-opus-5-5" as "Opus 5.5", and "gpt-5.6-terra" as "GPT-5.6 Terra". */
export function modelName(model: string): string {
  const claude = /^claude-([a-z]+)-(\d+)-(\d+)$/.exec(model);
  if (claude) return `${claude[1]![0]!.toUpperCase()}${claude[1]!.slice(1)} ${claude[2]}.${claude[3]}`;
  return model.replace(/^gpt-/, "GPT-").replace(/-([a-z])/g, (_, letter: string) => ` ${letter.toUpperCase()}`);
}

interface ResultLine {
  tweet_id: string;
  model: string;
  effort: string;
  decision: Decision;
  note: string;
  reasoning: string;
}

/** A results file as a run. A post answered twice counts with its first
 *  answer, as in scripts/eval/report.py. */
function parseRun(path: string, text: string): EvalRun {
  const lines = text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as ResultLine);
  const answers = new Map<string, EvalAnswer>();
  for (const line of lines) {
    if (!answers.has(line.tweet_id)) answers.set(line.tweet_id, { decision: line.decision, note: line.note, reasoning: line.reasoning });
  }
  const id = path.split("/").at(-1)!.replace(/\.jsonl$/, "");
  const first = lines[0];
  return { id, model: first ? modelName(first.model) : id, effort: first?.effort ?? "", answers };
}

export async function loadEvalData(): Promise<EvalData> {
  const [csv, ...results] = await Promise.all([Object.values(EVAL_CSV)[0]!(), ...Object.values(RESULT_FILES).map((load) => load())]);
  const posts = parseCsv(csv).map((row) => ({
    tweetId: row.tweet_id!,
    label: row.label as Decision,
    referenceNote: { id: row.note_id!, text: row.note_text!, status: row.note_status as NoteStatus },
    judgeReasoning: row.judge_reasoning!,
  }));
  const runs = Object.keys(RESULT_FILES).map((path, i) => parseRun(path, results[i]!));
  return { posts, runs };
}

/** How many posts a run got right, overall and on each side. */
export function runScore(run: EvalRun, posts: EvalPost[]) {
  const answered = posts.filter((post) => run.answers.has(post.tweetId));
  const right = (side?: Decision) => answered.filter((post) => (!side || post.label === side) && run.answers.get(post.tweetId)!.decision === post.label).length;
  const count = (side: Decision) => answered.filter((post) => post.label === side).length;
  return {
    answered: answered.length,
    right: right(),
    noNote: { right: right("no_note"), of: count("no_note") },
    writeNote: { right: right("write_note"), of: count("write_note") },
  };
}

/** The posts of these ids, as the Community Notes cards show them. */
export async function fetchPostCards(tweetIds: string[]): Promise<Map<string, XNote["post"]>> {
  const { data, error } = await supabase.rpc("x_post_cards", { p_tweet_ids: tweetIds });
  if (error) throw error;
  return new Map((data as { tweet_id: string; post: XNote["post"] }[]).map((row) => [row.tweet_id, row.post]));
}
