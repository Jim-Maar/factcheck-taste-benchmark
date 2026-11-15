import { join } from "node:path";
import type { SyndicationTweet } from "../import/xPosts";
import {
  auditActions, DEFAULT_EFFORT, HARNESSES, newSession, readAnswer, runSession, sessionActions, type Harness, type Prices,
} from "./harness";
import { renderPost, type PostSource } from "./thread";
import { localMedia } from "./workspace";

/* Runs the checks of checks.md on a model and harness, through the same
 * isolated session as run.ts (harness.ts), and grades them. One session
 * answers every probe:
 *
 *   - the cases of scripts/ai/checks/: can it see text in an image, a
 *     video's preview, the thread a post replies to, quotes inside quotes;
 *   - web search: does it find a news article from the last few days, which
 *     no model knows from training;
 *   - clean context: what it says it was given besides the prompt, which
 *     must name nothing of the user's or this repository's.
 *
 *   bun scripts/ai/check.ts <codex|claude> <model> [--effort <level>] [--logs <dir>]
 *
 * Nothing here touches the database. The session's prompt and transcript
 * are kept in the log folder (default ~/taste-runs/<time>-check-<model>). */

const USAGE = "Usage: bun scripts/ai/check.ts <codex|claude> <model> [--effort <level>] [--logs <dir>]";
const CHECKS_DIR = join(import.meta.dir, "checks");
const ANSWER_FILE = "answers.json";
/** How recent the article web search finds must be. */
const FRESH_DAYS = 7;
/** What a clean context must not mention: the user's instructions and tools, this repository. */
const LEAK_PATTERN = /\bRTK\b|rust token killer|hackathon|MEMORY\.md|ajweeks|factcheck-taste|supabase|\.claude-personal|taste-benchmark/i;

interface Case {
  name: string;
  tweet_id: string;
  question: string;
  expect: string[];
}

function savedSource(name: string): PostSource {
  return {
    async post(tweetId) {
      const file = Bun.file(join(CHECKS_DIR, name, "posts", `${tweetId}.json`));
      return (await file.exists()) ? ((await file.json()) as SyndicationTweet) : null;
    },
    mediaLocation: (url) => url,
  };
}

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args.splice(at, 2)[1];
};
const effort = option("--effort") ?? DEFAULT_EFFORT;
const logsOption = option("--logs");
const [harness, model] = args;
if (!HARNESSES.includes(harness as Harness) || !model) throw new Error(USAGE);

const today = new Date().toISOString().slice(0, 10);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logs = logsOption ?? join(process.env.HOME ?? "/tmp", "taste-runs", `${stamp}-check-${model.replace(/[^\w.-]/g, "_")}`);
const cases = (await Bun.file(join(CHECKS_DIR, "cases.json")).json()) as Case[];
const session = await newSession();
const sections: string[] = [];
for (const c of cases) {
  const media = localMedia(savedSource(c.name), session.workDir, `images/${c.name}`);
  const post = await media.source.post(c.tweet_id);
  if (!post) throw new Error(`The post of ${c.name} isn't saved. Run \`bun scripts/ai/checks.ts snapshot ${c.name} ${c.tweet_id}\`.`);
  const lines = await media.finish(await renderPost(media.source, post));
  sections.push(`### Case \`${c.name}\`\n\n${lines.join("\n")}\n\nQUESTION: ${c.question}`);
}

const prompt = `# Checks for an AI reviewer

You are checking that you can do what a reviewer of posts on X needs to: read every part of a post, search the web, and say what context you were given. Today is ${today}.

The images of the posts are saved in your current folder; the text gives each one's path. Open them. Don't open the posts on X or through X's embed endpoints, and don't read files outside your current folder.

## 1. The posts

For each case below, answer its question in one short sentence, from what you saw. If you couldn't see what the question asks about, say so rather than guessing.

${sections.join("\n\n")}

## 2. Web search

Search the web for one news article published in the last three days (on or before ${today}). Report its title, its URL and the date it was published, as YYYY-MM-DD. Use your web search tool; don't answer from memory.

## 3. Your context

List everything you were given besides this prompt: system instructions, instruction files (such as CLAUDE.md or AGENTS.md), memory, skills, hooks, MCP servers, plugins, environment details (working folder, platform, git status), and every tool you can call. Also list the files in your current folder. Be complete and literal; if a category is empty, say so.

## Your answer

Write your answers as JSON to ./${ANSWER_FILE}:

{ "<case name>": "<answer>", ..., "web_search": { "title": "...", "url": "...", "date": "YYYY-MM-DD" }, "context": "<section 3, as one string>" }
`;

console.log(`Checking ${model} on ${harness}, effort ${effort}. Logs: ${logs}`);
const prices = (await Bun.file(join(import.meta.dir, "prices.json")).json()) as Prices;
const logBase = join(logs, "check");
let failed = 0;
const result = (pass: boolean, name: string, detail: string) => {
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}\n      ${detail.replace(/\n/g, "\n      ")}`);
};
try {
  const usage = await runSession({ harness: harness as Harness, model, effort, prompt, session, logBase, timeoutMs: 15 * 60_000, prices });
  const answers = (await readAnswer(session, ANSWER_FILE, usage.lastMessage)).value as Record<string, unknown>;
  const actions = sessionActions(await Bun.file(`${logBase}.transcript.jsonl`).text());

  for (const c of cases) {
    const answer = typeof answers[c.name] === "string" ? (answers[c.name] as string).trim() : "";
    const missing = c.expect.filter((pattern) => !new RegExp(pattern, "i").test(answer));
    result(answer !== "" && !missing.length, c.name, `answer: ${answer || "(none)"}${missing.length ? `\nexpected to match: ${c.expect.join(", ")}` : ""}`);
  }

  const search = (answers.web_search ?? {}) as { title?: string; url?: string; date?: string };
  const searched = actions.filter((a) => /search/i.test(a));
  const age = search.date ? (Date.parse(today) - Date.parse(search.date)) / 86_400_000 : NaN;
  const page = search.url?.startsWith("http") ? await fetch(search.url, { signal: AbortSignal.timeout(30_000), redirect: "follow" }).then((r) => r.status, () => 0) : 0;
  result(
    // A site that doesn't answer our own fetch (some block scripts) doesn't
    // fail the check; an address that is missing (4xx) does, as a made-up URL.
    searched.length > 0 && age >= -1 && age <= FRESH_DAYS && !(page >= 400 && page < 500),
    "web-search",
    `${searched.length} web search calls; article: ${search.title ?? "(none)"} ${search.url ?? ""} dated ${search.date ?? "(none)"} (${Number.isNaN(age) ? "no date" : `${Math.round(age)} days old`}, URL answers HTTP ${page || "nothing; not counted against it"})` +
      (searched[0] ? `\nfirst search: ${searched[0].slice(0, 200)}` : ""),
  );

  const context = typeof answers.context === "string" ? answers.context : JSON.stringify(answers.context ?? "");
  const leak = context.match(LEAK_PATTERN);
  result(!leak && context.length > 0, "clean-context", `${leak ? `mentions "${leak[0]}". ` : ""}What it says it was given:\n${context}`);

  const audit = auditActions(actions);
  result(!audit.length, "no-forbidden-lookups", audit.length ? audit.join("\n") : `${actions.length} actions, none forbidden`);
  console.log(`\n${cases.length + 3 - failed} of ${cases.length + 3} passed. ${usage.costUsd === null ? "Cost unknown" : `Cost $${usage.costUsd.toFixed(4)}`}. Logs: ${logs}`);
} finally {
  await session.remove();
}
if (failed) process.exitCode = 1;
