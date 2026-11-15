import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { SyndicationTweet } from "../import/xPosts";
import { fetchLivePost, renderPost, type PostSource } from "./thread";

/* Checks that an AI reviewer, on a given model and harness, can see what a
 * reader of a post sees: text inside an image, a video's preview, the thread
 * a post replies to and quotes nested in quotes. Each case asks a question
 * whose answer is only in that context. scripts/ai/checks.md is what the
 * reviewer is told. Run from the repository root:
 *
 *   bun scripts/ai/checks.ts list                  the cases and their questions
 *   bun scripts/ai/checks.ts show <case>           the post, as `review.ts show` prints one, and the question
 *   bun scripts/ai/checks.ts grade < answers.json  { "<case>": "<answer>", ... }, marked against the expected answers
 *   bun scripts/ai/checks.ts snapshot <case> <tweet id>
 *
 * The posts are saved under scripts/ai/checks/<case>/, so a post deleted on X
 * doesn't change its case. Their images are not: `show` prints X's links to
 * them, as `review.ts show` does, so the check covers the reviewer fetching
 * an image. `snapshot` saves a case's posts, for a new case or again, and
 * checks that its images load. Nothing here touches the database. */

const USAGE = "Usage: bun scripts/ai/checks.ts list | show <case> | grade < answers.json | snapshot <case> <tweet id>";
const CHECKS_DIR = join(import.meta.dir, "checks");

interface Case {
  name: string;
  tweet_id: string;
  question: string;
  /** Patterns, case-insensitive, that a right answer matches every one of. */
  expect: string[];
}

const cases = async () => (await Bun.file(join(CHECKS_DIR, "cases.json")).json()) as Case[];

async function findCase(name: string): Promise<Case> {
  const found = (await cases()).find((c) => c.name === name);
  if (!found) throw new Error(`No case named ${name}. Run \`bun scripts/ai/checks.ts list\` for the cases.`);
  return found;
}

/** The posts saved for a case. */
function savedSource(name: string): PostSource {
  const dir = join(CHECKS_DIR, name);
  return {
    async post(tweetId) {
      const file = Bun.file(join(dir, "posts", `${tweetId}.json`));
      return (await file.exists()) ? ((await file.json()) as SyndicationTweet) : null;
    },
    mediaLocation: (url) => url,
  };
}

async function list() {
  for (const c of await cases()) console.log(`${c.name}\n  ${c.question}`);
}

async function show(name: string) {
  const c = await findCase(name);
  const source = savedSource(name);
  const post = await source.post(c.tweet_id);
  if (!post) throw new Error(`The post of ${name} isn't saved. Run \`bun scripts/ai/checks.ts snapshot ${name} ${c.tweet_id}\`.`);
  console.log([...(await renderPost(source, post)), "", "QUESTION", c.question].join("\n"));
}

async function grade() {
  const answers = JSON.parse(await Bun.stdin.text()) as Record<string, string>;
  let passed = 0;
  const all = await cases();
  for (const c of all) {
    const answer = answers[c.name]?.trim() ?? "";
    const missing = c.expect.filter((pattern) => !new RegExp(pattern, "i").test(answer));
    const pass = answer !== "" && missing.length === 0;
    if (pass) passed++;
    console.log(`${pass ? "PASS" : "FAIL"}  ${c.name}`);
    console.log(`      answer: ${answer || "(none)"}`);
    if (!pass) console.log(`      expected to match: ${c.expect.join(", ")}${missing.length && answer ? ` (missing ${missing.join(", ")})` : ""}`);
  }
  console.log(`\n${passed} of ${all.length} passed`);
  if (passed < all.length) process.exitCode = 1;
}

/** Saves a post and every post its rendering reads, and checks its images load. */
async function snapshot(name: string, tweetId: string) {
  const dir = join(CHECKS_DIR, name);
  await mkdir(join(dir, "posts"), { recursive: true });
  const media = new Set<string>();
  const recording: PostSource = {
    async post(id) {
      const post = await fetchLivePost(id);
      if (post) await Bun.write(join(dir, "posts", `${id}.json`), JSON.stringify(post, null, 2));
      return post;
    },
    mediaLocation: (url) => (media.add(url), url),
  };
  const post = await recording.post(tweetId);
  if (!post) throw new Error(`X doesn't serve ${tweetId}`);
  await renderPost(recording, post);
  for (const url of media) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetching ${url} failed: ${response.status}`);
  }
  console.log(`Saved ${name}: ${(await Array.fromAsync(new Bun.Glob("*.json").scan(join(dir, "posts")))).length} posts, ${media.size} images.`);
}

const [command, first, second] = process.argv.slice(2);
if (command === "list") await list();
else if (command === "show" && first) await show(first);
else if (command === "grade") await grade();
else if (command === "snapshot" && first && second) await snapshot(first, second);
else throw new Error(USAGE);
