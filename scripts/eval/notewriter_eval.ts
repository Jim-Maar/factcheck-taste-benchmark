import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { auditActions, newSession, QuotaError, readAnswer, runSession, sessionActions, type Harness, type Prices, type Usage } from "../ai/harness";
import { transcript } from "../ai/note";
import { fetchLivePostStrict, indent, mediaLines, renderPost, type PostSource } from "../ai/thread";
import { localMedia } from "../ai/workspace";
import { target } from "../import/db";
import type { XMedia } from "../import/xPosts";

/* Runs a model as a Community Notes writer over the notewriter eval
 * (eval/notewriter-eval.csv, built by build_csv.py): for each post it
 * decides whether to write a note, and writes one if so. Run from the
 * repository root:
 *
 *   bun scripts/eval/notewriter_eval.ts <eval.csv> <claude|codex> <model> <results.jsonl> [--effort <level>] [--parallel <n>]
 *
 * Each post gets one fresh session of the same harness as the AI reviewer
 * (scripts/ai/harness.ts): an empty folder outside the repository, no
 * credentials of this project, web search on, X and Community Notes sites
 * blocked. The session sees the post as run.ts shows it to the reviewer (the
 * thread above it, its quotes, its images and video frames saved in the
 * folder, the transcripts of its videos), with notewriter.md, and never any
 * note. It writes answer.json. Each answer is appended to the results file,
 * so a stopped run picks up where it stopped. */

const USAGE = "Usage: bun scripts/eval/notewriter_eval.ts <eval.csv> <claude|codex> <model> <results.jsonl> [--effort <level>] [--parallel <n>]";
const REPO = resolve(import.meta.dir, "../..");
const ANSWER_FILE = "answer.json";
const DECISIONS = ["write_note", "no_note"] as const;
const SESSION_TIMEOUT_MS = 15 * 60_000;
const RETRIES = 2;
const RETRY_PAUSE_MS = 30_000;
const QUOTA_PAUSE_MS = 5 * 60_000;
const QUOTA_STRIKES = 3;

interface EvalRow {
  tweet_id: string;
  label: string;
}

/** A CSV file as rows of named fields (RFC 4180: quoted fields may hold
 *  commas, line breaks and doubled quotes). */
function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") record.push(field), (field = "");
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field), records.push(record), (record = []), (field = "");
    } else field += char;
  }
  if (field || record.length) record.push(field), records.push(record);
  const [header, ...rows] = records;
  return rows.filter((row) => row.length === header!.length).map((row) => Object.fromEntries(header!.map((name, i) => [name, row[i]!])));
}

/** The post as the reviewer sees it: live from X's embed endpoint with its
 *  thread and quotes, or the stored copy when X no longer serves it. */
async function postView(tweetId: string, source: PostSource): Promise<string> {
  const live = await source.post(tweetId);
  if (live) return (await renderPost(source, live)).join("\n");
  const { data: post, error } = await target.from("x_posts").select("*").eq("tweet_id", tweetId).single();
  if (error) throw error;
  return [
    "POST",
    "(X no longer serves this post. This is the copy saved when it was imported, without the thread above it or the quotes inside its quote.)",
    `${[post.author_name, post.author_handle && `@${post.author_handle}`].filter(Boolean).join(" ") || "Unknown author"}, ${post.posted_at}:`,
    post.text,
    ...(await mediaLines(source, (post.media ?? []) as XMedia[])),
    ...(post.referenced
      ? [
          `It ${post.referenced_kind === "replied_to" ? "replies to" : post.referenced_kind === "quoted" ? "quotes" : "references"} this post:`,
          ...indent([post.referenced.text ?? "(no text)", ...(await mediaLines(source, (post.referenced.media ?? []) as XMedia[]))]),
        ]
      : []),
  ].join("\n");
}

function parseAnswer(raw: unknown): { decision: (typeof DECISIONS)[number]; note: string; reasoning: string } {
  const answer = (raw ?? {}) as { decision?: unknown; note?: unknown; reasoning?: unknown };
  if (!DECISIONS.includes(answer.decision as (typeof DECISIONS)[number]) || typeof answer.reasoning !== "string") {
    throw new Error(`The answer needs a decision of ${DECISIONS.join(" or ")} and a reasoning: ${JSON.stringify(raw).slice(0, 300)}`);
  }
  const note = typeof answer.note === "string" ? answer.note : "";
  if (answer.decision === "write_note" && !note.trim()) throw new Error("The answer decides to write a note but has none.");
  return { decision: answer.decision as (typeof DECISIONS)[number], note, reasoning: answer.reasoning };
}

interface Run {
  harness: Harness;
  model: string;
  effort: string;
  instructions: string;
  logs: string;
  prices: Prices;
}

async function attempt(run: Run, row: EvalRow, n: number) {
  const session = await newSession();
  try {
    const media = localMedia({ post: fetchLivePostStrict, mediaLocation: (url) => url, transcript }, session.workDir);
    const [text] = await media.finish([await postView(row.tweet_id, media.source)]);
    const prompt = [run.instructions, "", "## The post", "", text, "", `Write your answer to ./${ANSWER_FILE} now.`].join("\n");
    const logBase = join(run.logs, row.tweet_id, `attempt-${n}`);
    const usage: Usage = await runSession({ harness: run.harness, model: run.model, effort: run.effort, prompt, session, logBase, timeoutMs: SESSION_TIMEOUT_MS, prices: run.prices });
    const audit = auditActions(sessionActions(await Bun.file(`${logBase}.transcript.jsonl`).text()));
    const answer = parseAnswer((await readAnswer(session, ANSWER_FILE, usage.lastMessage)).value);
    return { ...answer, usage, audit };
  } finally {
    await session.remove();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string) => {
    const at = args.indexOf(name);
    if (at === -1) return fallback;
    const [, value] = args.splice(at, 2);
    if (!value) throw new Error(USAGE);
    return value;
  };
  const effort = option("--effort", "medium");
  const parallel = Number(option("--parallel", "4"));
  const [csvPath, harness, model, resultsPath] = args;
  if (!csvPath || !harness || !model || !resultsPath || !(parallel >= 1)) throw new Error(USAGE);

  const rows: EvalRow[] = parseCsv(await Bun.file(csvPath).text()).map((row) => ({ tweet_id: row.tweet_id!, label: row.label! }));
  const results = Bun.file(resultsPath);
  const done = new Set(
    (await results.exists() ? (await results.text()).split("\n").filter(Boolean) : []).map((line) => (JSON.parse(line) as { tweet_id: string }).tweet_id),
  );
  const todo = rows.filter((row) => !done.has(row.tweet_id));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logs = join(homedir(), "taste-runs", `${stamp}-notewriter-${model.replace(/[^\w.-]/g, "_")}`);
  await mkdir(logs, { recursive: true });
  const run: Run = {
    harness: harness as Harness,
    model,
    effort,
    instructions: await Bun.file(join(REPO, "scripts/eval/notewriter.md")).text(),
    logs,
    prices: (await Bun.file(join(REPO, "scripts/ai/prices.json")).json()) as Prices,
  };
  console.log(`Running ${model} (effort ${effort}) as notewriter on ${todo.length} of ${rows.length} posts, ${parallel} at a time.\nLogs: ${logs}`);

  let next = 0;
  let finished = 0;
  let failed = 0;
  let quotaStrikes = 0;
  let stopped = false;
  let cost = 0;
  const worker = async () => {
    while (next < todo.length && !stopped) {
      const row = todo[next++]!;
      for (let n = 1; n <= RETRIES + 1 && !stopped; n++) {
        try {
          const result = await attempt(run, row, n);
          quotaStrikes = 0;
          cost += result.usage.costUsd ?? 0;
          await appendFile(resultsPath, `${JSON.stringify({
            tweet_id: row.tweet_id, label: row.label, model, effort, decision: result.decision, note: result.note, reasoning: result.reasoning,
            cost_usd: result.usage.costUsd, input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens, audit: result.audit,
          })}\n`);
          console.log(`[${++finished}/${todo.length}] ${row.tweet_id} ${row.label} -> ${result.decision}${result.audit.length ? ` (audit: ${result.audit.length} hits)` : ""}, $${(result.usage.costUsd ?? 0).toFixed(3)}`);
          break;
        } catch (error) {
          const message = (error as { message?: string }).message ?? String(error);
          console.log(`  ${row.tweet_id} attempt ${n} failed: ${message.slice(0, 300)}`);
          if (error instanceof QuotaError && ++quotaStrikes >= QUOTA_STRIKES) {
            stopped = true;
            console.log("Stopping: three quota or rate-limit failures in a row. Run the same command later to continue.");
          } else if (n <= RETRIES) await Bun.sleep((error instanceof QuotaError ? QUOTA_PAUSE_MS : RETRY_PAUSE_MS) * 2 ** (n - 1));
          else failed++;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  console.log(`\n${finished} answered, ${failed} failed, ${todo.length - finished - failed} not started. Cost $${cost.toFixed(2)}.`);
  if (failed || stopped) process.exitCode = 1;
}

await main();
