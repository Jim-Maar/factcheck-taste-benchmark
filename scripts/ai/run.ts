import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { target } from "../import/db";
import { hasFfmpeg } from "./frames";
import {
  auditActions, DEFAULT_EFFORT, EFFORTS, HARNESSES, newSession, QuotaError, readAnswer, runSession, sessionActions,
  type Harness, type Prices, type Usage,
} from "./harness";
import { hasColumn, labelList, labelNames, noteView, parseReview, saveReview, transcript, type Review } from "./note";
import { EmbedUnavailable, fetchLivePostStrict } from "./thread";
import { localMedia } from "./workspace";

/* Runs a model over a list of X notes, one fresh harness session per note, so
 * each review is the model's own judgement of that note alone and its cost is
 * known exactly. Run from the repository root:
 *
 *   bun scripts/ai/run.ts <codex|claude> <model> <note id>...        these notes
 *   bun scripts/ai/run.ts <codex|claude> <model> --like <other model> the notes another model reviewed
 *   bun scripts/ai/run.ts <codex|claude> <model> --latest <count>     the newest notes on posts still on X
 *   bun scripts/ai/run.ts <codex|claude> <model> --set <name>         the notes of scripts/ai/sets/<name>.txt
 *
 * Options: --parallel <n> sessions at once (default 2); --timeout <minutes>
 * per session (default 15); --effort <low|medium|high|xhigh> (default
 * medium); --retries <n> per note (default 2); --logs <dir> (default
 * ~/taste-runs/<time>-<model>); --dry-run, which does everything but write
 * to the database and prints each review; --allow-dirty, only with
 * --dry-run, to try uncommitted reviewer files.
 *
 * With --like and --latest, notes the model has already reviewed are left
 * out; name a note's id to review it again. With --set, the notes the model
 * has already reviewed with the current prompt are left out, so a stopped run
 * picks up where it stopped.
 *
 * Each session starts with a clean context (harness.ts): a new empty folder
 * outside the repository, no credentials of this project, none of the user's
 * instructions, memory, hooks or plugins. This script shows the session the
 * note (note.ts: the thread, the post, its quotes and the note, never how X
 * rated it), with reviewer.md and the label definitions, and saves the
 * post's images and frames from its videos into the folder. The session
 * writes its review to review.json there; this script checks it and saves it
 * under the note and model it chose. When X's embed endpoint fails, the note
 * fails and is tried again, so no session sees less of a post than another;
 * a post X no longer serves is shown as stored, and the prompt says so.
 *
 * Every session's prompt and full transcript are kept in the log folder.
 * After the run, the transcripts are searched for lookups the prompt forbids
 * (the post on X, its embed, Community Notes, the database), and the hits are
 * printed per note. A note whose session fails is tried again after a pause
 * that doubles each time; a quota or rate limit pauses longer, and after
 * QUOTA_STRIKES of them in a row the run stops starting notes.
 *
 * Every model gets the same prompt: PROMPT_FILES as last committed. The run
 * refuses to start while they have uncommitted changes, and records on each
 * review the commit it ran with (prompt_version, migration 18). A review
 * being replaced is first appended to SUPERSEDED, so no review is lost.
 *
 * Tokens are counted as OpenAI counts them: input includes the cached input.
 * Claude Code reports its own cost in dollars. Codex reports only tokens, so
 * its cost comes from scripts/ai/prices.json, and stays empty for a model
 * without prices there (or when Codex runs on a ChatGPT plan, which isn't
 * billed per token: leave its prices out). */

const USAGE =
  "Usage: bun scripts/ai/run.ts <codex|claude> <model> (<note id>... | --like <model> | --latest <count> | --set <name>) " +
  "[--parallel <n>] [--timeout <minutes>] [--effort <level>] [--retries <n>] [--logs <dir>] [--dry-run [--allow-dirty]]";

/** Everything that decides what the reviewer sees and is told. */
const PROMPT_FILES = [
  "scripts/ai/reviewer.md", "scripts/ai/run.ts", "scripts/ai/harness.ts", "scripts/ai/note.ts", "scripts/ai/workspace.ts",
  "scripts/ai/review.ts", "scripts/ai/thread.ts", "scripts/ai/frames.ts", "src/core/xVideo.ts", "scripts/import/xPosts.ts",
  "src/core/labelDefinitions.ts",
];
const REPO = resolve(import.meta.dir, "../..");
const SUPERSEDED = join(REPO, "scripts/ai/sets/superseded.jsonl");
const ANSWER_FILE = "review.json";
/** Pauses before trying a note again, doubled each time. */
const RETRY_PAUSE_MS = 30_000;
const QUOTA_PAUSE_MS = 5 * 60_000;
/** Quota failures in a row after which the run stops starting notes. */
const QUOTA_STRIKES = 3;

interface Outcome {
  noteId: string;
  status: "saved" | "printed" | "deleted" | "failed" | "not started";
  usage?: Usage;
  error?: string;
  attempts: number;
  audit: string[];
}

async function git(...args: string[]) {
  const proc = Bun.spawn(["git", ...args], { cwd: REPO, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return out.trim();
}

/** The commit that last changed PROMPT_FILES, or an error if they have
 *  changes not yet committed, which no other run could repeat. */
async function promptVersion(allowDirty: boolean): Promise<string> {
  const dirty = await git("status", "--porcelain", "--", ...PROMPT_FILES);
  const commit = await git("log", "-1", "--format=%h", "--", ...PROMPT_FILES);
  if (!dirty) return commit;
  if (!allowDirty) throw new Error(`Commit the reviewer's files first, so every model gets the same prompt:\n${dirty}`);
  console.warn(`Running with uncommitted reviewer files (--allow-dirty):\n${dirty}`);
  return `${commit}-dirty`;
}

/** Appends a model's current review of a note, if it has one, to SUPERSEDED,
 *  before a new one replaces it. */
async function keepOldReview(model: string, noteId: string) {
  const { data, error } = await target.from("ai_reviews").select("*").match({ source: "x", note_id: noteId, model }).maybeSingle();
  if (error) throw error;
  if (data) await appendFile(SUPERSEDED, `${JSON.stringify({ ...data, superseded_at: new Date().toISOString() })}\n`);
}

interface Run {
  harness: Harness;
  model: string;
  effort: string;
  version: string;
  instructions: string;
  labels: string[];
  logs: string;
  timeoutMs: number;
  dryRun: boolean;
  /** Whether taste.ai_reviews has the needs_note column (migration 19). */
  needsNoteColumn: boolean;
  prices: Prices;
}

type Attempt = { status: "deleted" } | { status: "done"; review: Review; usage: Usage; audit: string[] };

/** One session on one note: shows it the note, runs it, checks its review
 *  and saves it. Throws when any of that fails. */
async function attempt(run: Run, noteId: string, n: number): Promise<Attempt> {
  const session = await newSession();
  try {
    const media = localMedia({ post: fetchLivePostStrict, mediaLocation: (url) => url, transcript }, session.workDir);
    const view = await noteView(noteId, media.source);
    if (view.kind === "deleted") return { status: "deleted" };
    const [text] = await media.finish([view.text]);
    const prompt = [
      run.instructions,
      "",
      "## The note to review",
      "",
      ...(view.stored ? ["X no longer serves this post, so you see the copy stored when it was imported, without the thread above it. Judge the note from what is shown.", ""] : []),
      text,
      "",
      `Write your review to ./${ANSWER_FILE} now.`,
    ].join("\n");
    const logBase = join(run.logs, noteId, `attempt-${n}`);
    if (view.stored) console.log(`  ${noteId}: X no longer serves the post; showing the stored copy.`);
    const usage = await runSession({ harness: run.harness, model: run.model, effort: run.effort, prompt, session, logBase, timeoutMs: run.timeoutMs, prices: run.prices });
    const audit = auditActions(sessionActions(await Bun.file(`${logBase}.transcript.jsonl`).text()), view.noteText);
    const answer = await readAnswer(session, ANSWER_FILE, usage.lastMessage);
    await Bun.write(`${logBase}.review.json`, JSON.stringify(answer.value, null, 2));
    if (answer.from !== ANSWER_FILE) console.log(`  ${noteId}: no ${ANSWER_FILE}, the review was taken from ${answer.from}.`);
    const review = parseReview(answer.value, run.labels);
    if (run.dryRun) return { status: "done", review, usage, audit };
    await keepOldReview(run.model, noteId);
    await saveReview({
      source: "x",
      note_id: noteId,
      model: run.model,
      ...review,
      created_at: new Date().toISOString(),
      harness: run.harness,
      prompt_version: run.version,
      input_tokens: usage.inputTokens,
      cached_input_tokens: usage.cachedInputTokens,
      output_tokens: usage.outputTokens,
      cost_usd: usage.costUsd,
    }, run.needsNoteColumn);
    return { status: "done", review, usage, audit };
  } finally {
    await session.remove();
  }
}

/** The notes the model has reviewed, or with a version, only those it
 *  reviewed with that prompt. */
async function reviewedBy(model: string, version?: string): Promise<Set<string>> {
  let query = target.from("ai_reviews").select("note_id").eq("source", "x").eq("model", model);
  if (version) query = query.eq("prompt_version", version);
  const { data, error } = await query;
  if (error) throw error;
  return new Set(data.map((row) => row.note_id as string));
}

async function latestNotes(count: number, skip: Set<string>): Promise<string[]> {
  const picked: string[] = [];
  for (let page = 0; picked.length < count; page++) {
    const { data, error } = await target
      .from("x_notes")
      .select("note_id, tweet_id")
      .order("written", { ascending: false })
      .range(page * 200, page * 200 + 199);
    if (error) throw error;
    if (!data.length) break;
    const { data: posts, error: postsError } = await target.from("x_posts").select("tweet_id").eq("available", true).in("tweet_id", data.map((row) => row.tweet_id));
    if (postsError) throw postsError;
    const available = new Set(posts.map((post) => post.tweet_id as string));
    picked.push(...data.filter((row) => available.has(row.tweet_id) && !skip.has(row.note_id)).map((row) => row.note_id as string));
  }
  return picked.slice(0, count);
}

const usageText = (u?: Usage) =>
  u ? `${u.inputTokens} in (${u.cachedInputTokens} cached), ${u.outputTokens} out, ${u.costUsd === null ? "cost unknown" : `$${u.costUsd.toFixed(4)}`}` : "";

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    if (at === -1) return undefined;
    const [, value] = args.splice(at, 2);
    if (!value) throw new Error(USAGE);
    return value;
  };
  const flag = (name: string) => {
    const at = args.indexOf(name);
    if (at !== -1) args.splice(at, 1);
    return at !== -1;
  };
  const parallel = Number(option("--parallel") ?? 2);
  const timeoutMs = Number(option("--timeout") ?? 15) * 60_000;
  const effort = option("--effort") ?? DEFAULT_EFFORT;
  const retries = Number(option("--retries") ?? 2);
  const logsOption = option("--logs");
  const like = option("--like");
  const latest = option("--latest");
  const set = option("--set");
  const dryRun = flag("--dry-run");
  const allowDirty = flag("--allow-dirty");
  const [harness, model, ...ids] = args;
  if (!HARNESSES.includes(harness as Harness) || !model || (!ids.length && !like && !latest && !set)) throw new Error(USAGE);
  if (ids.some((id) => id.startsWith("--"))) throw new Error(`Unknown option ${ids.find((id) => id.startsWith("--"))}. ${USAGE}`);
  if (!EFFORTS.includes(effort as (typeof EFFORTS)[number])) throw new Error(`--effort is one of ${EFFORTS.join(", ")}`);
  if (!(timeoutMs > 0) || !(parallel >= 1) || !(retries >= 0)) throw new Error(USAGE);
  if (allowDirty && !dryRun) throw new Error("--allow-dirty works only with --dry-run: a saved review must come from committed reviewer files.");

  const version = await promptVersion(allowDirty);
  // Without ffmpeg a session sees no more of a video than its preview image, and its reviews would differ from another machine's.
  if (!hasFfmpeg()) {
    if (!dryRun) throw new Error("Install ffmpeg first: the reviewer needs it to look at the videos of posts.");
    console.warn("ffmpeg isn't installed: sessions see only the preview images of videos.");
  }
  if (!dryRun && !(await hasColumn("prompt_version"))) throw new Error("Apply migration 018 (prompt_version) first.");
  const needsNoteColumn = await hasColumn("needs_note");
  if (!needsNoteColumn) console.warn("taste.ai_reviews has no needs_note column yet (migration 19): each review's needs_note answer is kept only in the logs.");

  const done = await reviewedBy(model);
  let doneNow = new Set<string>();
  try {
    doneNow = await reviewedBy(model, version);
  } catch (error) {
    if (!dryRun) throw error;
    console.warn(`Can't tell which notes were reviewed with this prompt (${(error as { message?: string }).message}); in a dry run, every note is reviewed.`);
  }
  const setIds = set ? (await Bun.file(join(REPO, `scripts/ai/sets/${set}.txt`)).text()).split(/\s+/).filter(Boolean) : [];
  const noteIds = set
    ? setIds.filter((id) => !doneNow.has(id))
    : like
      ? [...(await reviewedBy(like))].filter((id) => !done.has(id))
      : latest
        ? await latestNotes(Number(latest), done)
        : ids;
  if (!noteIds.length) return console.log("No notes to review.");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const logs = resolve(logsOption ?? join(homedir(), "taste-runs", `${stamp}-${model.replace(/[^\w.-]/g, "_")}`));
  if (logs.startsWith(`${REPO}/`) || logs === REPO) throw new Error("Keep the logs outside the repository.");
  await mkdir(logs, { recursive: true });
  const labels = await labelNames();
  const reviewer = await Bun.file(join(REPO, "scripts/ai/reviewer.md")).text();
  if (!reviewer.includes("{{LABELS}}")) throw new Error("reviewer.md has lost its {{LABELS}} placeholder.");
  const run: Run = {
    harness: harness as Harness,
    model,
    effort,
    version,
    instructions: reviewer.replace("{{LABELS}}", labelList(labels)),
    labels,
    logs,
    timeoutMs,
    dryRun,
    needsNoteColumn,
    prices: (await Bun.file(join(REPO, "scripts/ai/prices.json")).json()) as Prices,
  };
  await Bun.write(join(logs, "run.json"), JSON.stringify({ harness, model, effort, version, dryRun, parallel, timeoutMs, retries, noteIds, started: new Date().toISOString() }, null, 2));
  console.log(
    `${dryRun ? "DRY RUN (nothing is saved): r" : "R"}eviewing ${noteIds.length} notes with ${model} on ${harness}, effort ${effort}, prompt ${version}, ${parallel} at a time.\nLogs: ${logs}`,
  );

  const outcomes: Outcome[] = [];
  let next = 0;
  let quotaStrikes = 0;
  let stopped = false;
  const worker = async () => {
    while (next < noteIds.length && !stopped) {
      const noteId = noteIds[next++]!;
      const outcome: Outcome = { noteId, status: "failed", attempts: 0, audit: [] };
      for (let n = 1; n <= retries + 1 && !stopped; n++) {
        outcome.attempts = n;
        try {
          const result = await attempt(run, noteId, n);
          quotaStrikes = 0;
          if (result.status === "deleted") outcome.status = "deleted";
          else {
            Object.assign(outcome, { status: dryRun ? "printed" : "saved", usage: result.usage, audit: result.audit, error: undefined });
            if (dryRun) console.log(`  ${noteId} review: ${JSON.stringify(result.review, null, 2).replace(/\n/g, "\n  ")}`);
          }
          break;
        } catch (error) {
          const quota = error instanceof QuotaError;
          outcome.error = `${error instanceof EmbedUnavailable ? "X's embed endpoint: " : ""}${(error as { message?: string }).message ?? String(error)}`;
          console.log(`  ${noteId} attempt ${n} failed: ${outcome.error}`);
          if (quota && ++quotaStrikes >= QUOTA_STRIKES) {
            stopped = true;
            console.log(`Stopping: ${QUOTA_STRIKES} quota or rate-limit failures in a row. Run the same command later to continue.`);
            break;
          }
          if (n <= retries) await Bun.sleep((quota ? QUOTA_PAUSE_MS : RETRY_PAUSE_MS) * 2 ** (n - 1));
        }
      }
      outcomes.push(outcome);
      const what = outcome.status === "failed" ? `FAILED after ${outcome.attempts} attempts: ${outcome.error}` : outcome.status === "deleted" ? "skipped: the post is deleted" : outcome.status;
      console.log(`[${outcomes.length}/${noteIds.length}] ${noteId} ${what}${outcome.usage ? `; ${usageText(outcome.usage)}` : ""}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
  const started = new Set(outcomes.map((o) => o.noteId));
  for (const noteId of noteIds) if (!started.has(noteId)) outcomes.push({ noteId, status: "not started", attempts: 0, audit: [] });
  await Bun.write(join(logs, "outcomes.json"), JSON.stringify(outcomes, null, 2));

  const flagged = outcomes.filter((o) => o.audit.length);
  console.log(`\nAudit of the transcripts for forbidden lookups: ${flagged.length ? `${flagged.length} notes with hits` : "no hits"}.`);
  for (const o of flagged) console.log(`  ${o.noteId}:\n${o.audit.map((hit) => `    ${hit}`).join("\n")}`);

  const reviewed = outcomes.filter((o) => o.status === "saved" || o.status === "printed");
  const known = reviewed.map((o) => o.usage?.costUsd).filter((c): c is number => typeof c === "number");
  const count = (status: Outcome["status"]) => outcomes.filter((o) => o.status === status).length;
  console.log(
    `\n${reviewed.length} of ${outcomes.length} ${dryRun ? "reviewed (dry run, none saved)" : "saved"}; ${count("deleted")} skipped as deleted, ${count("failed")} failed, ${count("not started")} not started.` +
      (known.length ? ` Cost $${known.reduce((a, b) => a + b, 0).toFixed(4)}${known.length < reviewed.length ? ` for the ${known.length} with a known price` : ""}.` : " Cost unknown."),
  );
  for (const o of outcomes.filter((o) => o.status === "failed")) console.log(`  FAILED ${o.noteId}: ${o.error}`);
  console.log(`Logs: ${logs}`);
  if (count("failed") || count("not started")) process.exitCode = 1;
}

await main();
