import { target } from "../import/db";

/* The tool an AI reviewer uses to read X notes and save its review of each.
 * scripts/ai/reviewer.md is the reviewer's instructions. Run from the
 * repository root, so Bun loads .env:
 *
 *   bun scripts/ai/review.ts latest <count>     the newest notes, by when they were written
 *   bun scripts/ai/review.ts show <note id>     the post and the note, as a reader of the post meets them
 *   bun scripts/ai/review.ts labels             the labels a review may use
 *   bun scripts/ai/review.ts save <note id> <model> < review.json
 *
 * `show` leaves out how X rated the note, the raters' reasons and the other
 * notes on the post, so the review is the reviewer's own judgement.
 *
 * The review is JSON: { "explanation": "...", "reasoning": "...", "labels": ["..."], "recommendation": "taste_failure" | "fine" }.
 * Saving again replaces the note's review. The site shows a saved review at once. */

const USAGE = "Usage: bun scripts/ai/review.ts latest <count> | show <note id> | labels | save <note id> <model> < review.json";
const RECOMMENDATIONS = ["taste_failure", "fine"];
/** A review sits beside a note of a few hundred characters, and must not take
 *  longer to read than the note. */
const MAX_EXPLANATION_CHARS = 300;
const MAX_REASONING_CHARS = 300;

interface XMedia {
  type: string;
  url?: string;
  preview_image_url?: string;
}

const mediaLines = (media: XMedia[] | null | undefined) => (media ?? []).map((m) => `  ${m.type}: ${m.url ?? m.preview_image_url ?? "(no url)"}`);

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
  const postLines = !post?.available
    ? ["The post is deleted or no longer public on X."]
    : [
        `${[post.author_name, post.author_handle && `@${post.author_handle}`].filter(Boolean).join(" ") || "Unknown author"}, ${post.posted_at}:`,
        post.text,
        ...mediaLines(post.media),
        ...(post.referenced ? [`It ${post.referenced_kind === "replied_to" ? "replies to" : post.referenced_kind ?? "references"} this post:`, post.referenced.text ?? "(no text)", ...mediaLines(post.referenced.media)] : []),
      ];
  console.log(["POST", ...postLines, "", `NOTE, written ${note.written}`, note.note_text].join("\n"));
}

/** The names of the labels people put on notes on the site. */
async function labelNames(): Promise<string[]> {
  const { data, error } = await target.from("labels").select("name").order("name");
  if (error) throw error;
  return data.map((row) => row.name as string);
}

async function save(noteId: string, model: string) {
  const review = JSON.parse(await Bun.stdin.text()) as { explanation?: string; reasoning?: string; labels?: string[]; recommendation?: string };
  const explanation = review.explanation?.trim() ?? "";
  const reasoning = review.reasoning?.trim() ?? "";
  if (!reasoning || !Array.isArray(review.labels) || !RECOMMENDATIONS.includes(review.recommendation ?? "")) {
    throw new Error(`The review needs a reasoning, a list of labels (empty when none applies) and a recommendation of ${RECOMMENDATIONS.join(" or ")}`);
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
