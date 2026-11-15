import { target } from "../import/db";

/* Runs a model over a set of X notes, one fresh harness session per note, so
 * each review is the model's own judgement of that note alone and its cost is
 * known exactly. Each session gets reviewer.md as its instructions and saves
 * its review with `review.ts save`, under the model's id. This script then
 * checks the review was saved and records on it what the session used.
 * Run from the repository root:
 *
 *   bun scripts/ai/run.ts <codex|claude> <model> <note id>...        these notes
 *   bun scripts/ai/run.ts <codex|claude> <model> --like <other model> the notes another model reviewed
 *   bun scripts/ai/run.ts <codex|claude> <model> --latest <count>     the newest notes on posts still on X
 *
 * With --like and --latest, notes the model has already reviewed are left
 * out; name a note's id to review it again. --parallel <n> runs n sessions at
 * once (default 2).
 *
 * Tokens are counted as OpenAI counts them: input includes the cached input.
 * Claude Code reports its own cost in dollars. Codex reports only tokens, so
 * its cost comes from scripts/ai/prices.json, and stays empty for a model
 * without prices there (or when Codex runs on a ChatGPT plan, which isn't
 * billed per token: leave its prices out). */

const USAGE = "Usage: bun scripts/ai/run.ts <codex|claude> <model> (<note id>... | --like <model> | --latest <count>) [--parallel <n>]";
const HARNESSES = ["codex", "claude"] as const;
type Harness = (typeof HARNESSES)[number];

interface Usage {
  /** The session's last message, to say why a review is missing. */
  lastMessage: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

interface Outcome {
  noteId: string;
  usage: Usage | null;
  error?: string;
}

/** USD per million tokens. */
type Prices = Record<string, { input?: number | null; cached_input?: number | null; output?: number | null }>;

const prompt = (noteId: string, model: string) =>
  `Read scripts/ai/reviewer.md: it is your instructions. Review only the X note ${noteId}, and save the review with the model id ${model}.`;

async function runCodex(model: string, noteId: string, prices: Prices): Promise<Usage> {
  const proc = Bun.spawn(
    ["codex", "exec", "-m", model, "-s", "workspace-write", "-c", "sandbox_workspace_write.network_access=true", "--ephemeral", "--json", prompt(noteId, model)],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`codex exited with ${proc.exitCode}: ${err.trim().split("\n").at(-1)}`);
  const usage = { lastMessage: "", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null as number | null };
  for (const line of out.split("\n")) {
    if (!line.startsWith("{")) continue;
    const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string }; usage?: { input_tokens?: number; cached_input_tokens?: number; output_tokens?: number } };
    if (event.type === "item.completed" && event.item?.type === "agent_message") usage.lastMessage = event.item.text ?? "";
    if (event.type !== "turn.completed" || !event.usage) continue;
    usage.inputTokens += event.usage.input_tokens ?? 0;
    usage.cachedInputTokens += event.usage.cached_input_tokens ?? 0;
    usage.outputTokens += event.usage.output_tokens ?? 0;
  }
  const price = prices[model];
  if (price && typeof price.input === "number" && typeof price.cached_input === "number" && typeof price.output === "number") {
    usage.costUsd =
      ((usage.inputTokens - usage.cachedInputTokens) * price.input + usage.cachedInputTokens * price.cached_input + usage.outputTokens * price.output) / 1e6;
  }
  return usage;
}

async function runClaude(model: string, noteId: string): Promise<Usage> {
  const proc = Bun.spawn(
    [
      "claude", "-p", prompt(noteId, model), "--model", model, "--output-format", "json", "--permission-mode", "acceptEdits",
      "--allowedTools", "Bash(bun scripts/ai/review.ts:*)", "Bash(bun scripts/ai/frames.ts:*)", "Bash(curl:*)", "Read", "Write", "WebFetch", "WebSearch",
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) !== 0) throw new Error(`claude exited with ${proc.exitCode}: ${(err || out).trim().split("\n").at(-1)}`);
  const result = JSON.parse(out) as {
    result?: string;
    total_cost_usd?: number;
    usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number };
  };
  const u = result.usage ?? {};
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    lastMessage: result.result ?? "",
    inputTokens: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0),
    cachedInputTokens: cached,
    outputTokens: u.output_tokens ?? 0,
    costUsd: result.total_cost_usd ?? null,
  };
}

async function reviewNote(harness: Harness, model: string, noteId: string, prices: Prices): Promise<Outcome> {
  const started = new Date();
  let usage: Usage;
  try {
    usage = harness === "codex" ? await runCodex(model, noteId, prices) : await runClaude(model, noteId);
  } catch (error) {
    return { noteId, usage: null, error: (error as Error).message };
  }
  const { data, error } = await target
    .from("ai_reviews")
    .update({ harness, input_tokens: usage.inputTokens, cached_input_tokens: usage.cachedInputTokens, output_tokens: usage.outputTokens, cost_usd: usage.costUsd })
    .match({ source: "x", note_id: noteId, model })
    .gte("created_at", started.toISOString())
    .select("note_id");
  if (error) throw error;
  if (!data.length) return { noteId, usage, error: `the session ended without saving a review. Its last message: ${usage.lastMessage.trim() || "(none)"}` };
  return { noteId, usage };
}

async function reviewedBy(model: string): Promise<Set<string>> {
  const { data, error } = await target.from("ai_reviews").select("note_id").eq("source", "x").eq("model", model);
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

async function main() {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const at = args.indexOf(name);
    if (at === -1) return undefined;
    const [, value] = args.splice(at, 2);
    if (!value) throw new Error(USAGE);
    return value;
  };
  const parallel = Number(option("--parallel") ?? 2);
  const like = option("--like");
  const latest = option("--latest");
  const [harness, model, ...ids] = args;
  if (!HARNESSES.includes(harness as Harness) || !model || (!ids.length && !like && !latest)) throw new Error(USAGE);
  // Without ffmpeg a session can't see more of a video than its preview image (frames.ts), and its reviews would differ from another machine's.
  if (!Bun.which("ffmpeg") || !Bun.which("ffprobe")) throw new Error("Install ffmpeg first: the reviewer needs it to look at the videos of posts.");

  const done = await reviewedBy(model);
  const noteIds = like ? [...(await reviewedBy(like))].filter((id) => !done.has(id)) : latest ? await latestNotes(Number(latest), done) : ids;
  if (!noteIds.length) return console.log("No notes to review.");
  const prices = (await Bun.file(new URL("prices.json", import.meta.url)).json()) as Prices;
  console.log(`Reviewing ${noteIds.length} notes with ${model} on ${harness}, ${parallel} at a time.`);

  const outcomes: Outcome[] = [];
  let next = 0;
  const worker = async () => {
    while (next < noteIds.length) {
      const outcome = await reviewNote(harness as Harness, model, noteIds[next++]!, prices);
      outcomes.push(outcome);
      const u = outcome.usage;
      const used = u ? `${u.inputTokens} in (${u.cachedInputTokens} cached), ${u.outputTokens} out, ${u.costUsd === null ? "cost unknown" : `$${u.costUsd.toFixed(4)}`}` : "";
      console.log(`[${outcomes.length}/${noteIds.length}] ${outcome.noteId} ${outcome.error ? `FAILED: ${outcome.error}` : "saved"}${used ? `; ${used}` : ""}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));

  const saved = outcomes.filter((o) => !o.error);
  const costs = saved.map((o) => o.usage?.costUsd);
  const known = costs.filter((c): c is number => typeof c === "number");
  console.log(
    `\n${saved.length} of ${outcomes.length} saved.` +
      (known.length ? ` Cost $${known.reduce((a, b) => a + b, 0).toFixed(4)}${known.length < saved.length ? ` for the ${known.length} with a known price` : ""}.` : " Cost unknown."),
  );
  if (saved.length < outcomes.length) process.exitCode = 1;
}

await main();
