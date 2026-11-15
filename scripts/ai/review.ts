import { target } from "../import/db";
import type { XMedia } from "../import/xPosts";
import { fetchLivePost, indent, liveSource, mediaLines, renderPost, type PostSource } from "./thread";

/* The tool an AI reviewer uses to read X notes and save its review of each.
 * scripts/ai/reviewer.md is the reviewer's instructions. Run from the
 * repository root, so Bun loads .env:
 *
 *   bun scripts/ai/review.ts latest <count>     the newest notes, by when they were written
 *   bun scripts/ai/review.ts show <note id>     the post and the note, as a reader of the post meets them
 *   bun scripts/ai/review.ts labels             the labels a review may use
 *   bun scripts/ai/review.ts save <note id> <model> < review.json
 *
 * `show` fetches the thread above the post and the posts it quotes, nested,
 * from X's embed endpoint, since the stored post holds one level at most and
 * no parent for most replies. It leaves out how X rated the note, the raters'
 * reasons and the other notes on the post, so the review is the reviewer's
 * own judgement. A video that has a transcript (scripts/import/transcripts.ts)
 * shows what is said in it, and every video shows the command that saves
 * frames from it (frames.ts), since its preview image is one moment of it.
 *
 * The review is JSON: { "explanation": "...", "reasoning": "...", "labels": ["..."], "recommendation": "taste_failure" | "fine", "needs_note": "yes" | "no" }.
 * Saving again with the same model replaces that model's review of the note;
 * other models' reviews stay. The site shows a saved review at once.
 * scripts/ai/run.ts runs a model over many notes and records what it cost. */

const USAGE = "Usage: bun scripts/ai/review.ts latest <count> | show <note id> | labels | save <note id> <model> < review.json";
const RECOMMENDATIONS = ["taste_failure", "fine"];
const NEEDS_NOTE_ANSWERS = ["yes", "no"];
/** A review sits beside a note of a few hundred characters, and must not take
 *  longer to read than the note. */
const MAX_EXPLANATION_CHARS = 300;
const MAX_REASONING_CHARS = 300;

/** Posts from X's embed endpoint, with the stored transcripts of their videos. */
const reviewSource: PostSource = {
  ...liveSource,
  async transcript(videoId) {
    const { data, error } = await target.from("x_video_transcripts").select("transcript").eq("video_id", videoId).maybeSingle();
    if (error) throw error;
    return data?.transcript ?? null;
  },
};

async function latest(count: number) {
  const { data, error } = await target.from("x_notes").select("note_id, written").order("written", { ascending: false }).limit(count);
  if (error) throw error;
  for (const row of data) console.log(`${row.note_id}  ${row.written}`);
}

async function show(noteId: string) {
  const { data: note, error } = await target.from("x_notes").select("tweet_id, note_text, written").eq("note_id", noteId).single();
  if (error) throw error;
  const { data: post, error: postError } = await target.from("x_posts").select("*").eq("tweet_id", note.tweet_id).maybeSingle();
  if (postError) throw postError;
  const noteLines = ["", `NOTE, written ${note.written}`, note.note_text];
  if (!post?.available) return console.log(["POST", "The post is deleted or no longer public on X.", ...noteLines].join("\n"));

  const live = await fetchLivePost(note.tweet_id);
  if (!live) {
    // X no longer serves the post, so its thread and quotes can't be followed: show what was stored.
    const stored = [
      `${[post.author_name, post.author_handle && `@${post.author_handle}`].filter(Boolean).join(" ") || "Unknown author"}, ${post.posted_at}:`,
      post.text,
      ...(await mediaLines(reviewSource, (post.media ?? []) as XMedia[])),
      ...(post.referenced ? [`It ${post.referenced_kind === "replied_to" ? "replies to" : post.referenced_kind === "quoted" ? "quotes" : "references"} this post:`, ...indent([post.referenced.text ?? "(no text)", ...(await mediaLines(reviewSource, (post.referenced.media ?? []) as XMedia[]))])] : []),
      ...(post.referenced_kind === "replied_to" && !post.referenced ? ["It replies to a post that couldn't be loaded."] : []),
    ];
    return console.log(["POST", ...stored, ...noteLines].join("\n"));
  }

  console.log([...(await renderPost(reviewSource, live)), ...noteLines].join("\n"));
}

/** The names of the labels people put on notes on the site. */
async function labelNames(): Promise<string[]> {
  const { data, error } = await target.from("labels").select("name").order("name");
  if (error) throw error;
  return data.map((row) => row.name as string);
}

async function save(noteId: string, model: string) {
  const review = JSON.parse(await Bun.stdin.text()) as { explanation?: string; reasoning?: string; labels?: string[]; recommendation?: string; needs_note?: string };
  const explanation = review.explanation?.trim() ?? "";
  const reasoning = review.reasoning?.trim() ?? "";
  if (!reasoning || !Array.isArray(review.labels) || !RECOMMENDATIONS.includes(review.recommendation ?? "") || !NEEDS_NOTE_ANSWERS.includes(review.needs_note ?? "")) {
    throw new Error(
      `The review needs a reasoning, a list of labels (empty when none applies), a recommendation of ${RECOMMENDATIONS.join(" or ")} and a needs_note of ${NEEDS_NOTE_ANSWERS.join(" or ")}`,
    );
  }
  if (explanation.length > MAX_EXPLANATION_CHARS || reasoning.length > MAX_REASONING_CHARS) {
    throw new Error(
      `Too long: the explanation has ${explanation.length} characters of at most ${MAX_EXPLANATION_CHARS}, the reasoning ${reasoning.length} of at most ${MAX_REASONING_CHARS}`,
    );
  }
  const known = await labelNames();
  const labels = [...new Set(review.labels.map((name) => known.find((label) => label.toLowerCase() === name.trim().toLowerCase()) ?? name))];
  const unknown = labels.filter((name) => !known.includes(name));
  if (unknown.length) throw new Error(`No such label: ${unknown.join(", ")}. The labels are: ${known.join(", ")}`);
  const { error } = await target.from("ai_reviews").upsert({
    source: "x",
    note_id: noteId,
    explanation,
    recommendation: review.recommendation,
    needs_note: review.needs_note,
    reasoning,
    labels,
    model,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
  console.log(`Saved the review of ${noteId}.`);
}

const [command, first, second] = process.argv.slice(2);
if (command === "latest" && first) await latest(Number(first));
else if (command === "show" && first) await show(first);
else if (command === "labels") console.log((await labelNames()).join("\n"));
else if (command === "save" && first && second) await save(first, second);
else throw new Error(USAGE);
