import { target } from "../import/db";

/* The tool an AI reviewer uses to read X notes and save its review of each.
 * Run from the repository root, so Bun loads .env:
 *
 *   bun scripts/ai/review.ts latest <count>     the newest notes, by when they were written
 *   bun scripts/ai/review.ts show <note id>     everything the site shows about one note
 *   bun scripts/ai/review.ts save <note id> <model> < review.json
 *
 * The review is JSON: { "explanation": "...", "recommendation": "taste_failure" | "fine", "reasoning": "..." }.
 * Saving again replaces the note's review. The site shows a saved review at once. */

const USAGE = "Usage: bun scripts/ai/review.ts latest <count> | show <note id> | save <note id> <model> < review.json";
const RECOMMENDATIONS = ["taste_failure", "fine"];

interface XMedia {
  type: string;
  url?: string;
  preview_image_url?: string;
}

const mediaLines = (media: XMedia[] | null | undefined) => (media ?? []).map((m) => `  ${m.type}: ${m.url ?? m.preview_image_url ?? "(no url)"}`);

const reasonLine = (tags: Record<string, number>) =>
  Object.entries(tags)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => `${tag} ${count}`)
    .join(", ") || "none";

async function latest(count: number) {
  const { data, error } = await target.from("x_notes").select("note_id, written").order("written", { ascending: false }).limit(count);
  if (error) throw error;
  for (const row of data) console.log(`${row.note_id}  ${row.written}`);
}

async function show(noteId: string) {
  const { data: note, error } = await target.from("x_notes").select("*, x_notewriters(name)").eq("note_id", noteId).single();
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
  const otherNotes = (note.other_notes as { text: string; status: string; isAi: boolean }[]).map((other) => `- [${other.status}, ${other.isAi ? "AI notewriter" : "person"}] ${other.text}`);
  console.log(
    [
      `POST https://x.com/i/status/${note.tweet_id}`,
      ...postLines,
      "",
      `NOTE ${noteId} by ${note.x_notewriters.name}, written ${note.written}`,
      note.note_text,
      "",
      `Status on X: ${note.status}`,
      `Ratings: ${note.helpful_ratings} helpful, ${note.somewhat_helpful_ratings} somewhat helpful, ${note.not_helpful_ratings} not helpful`,
      `Helpful reasons: ${reasonLine(note.helpful_tags)}`,
      `Not-helpful reasons: ${reasonLine(note.not_helpful_tags)}`,
      `Writer's answers: ${[note.classification, ...note.writer_reasons].filter(Boolean).join(", ")}`,
      "",
      otherNotes.length ? "OTHER NOTES ON THE POST" : "No other notes on the post.",
      ...otherNotes,
    ].join("\n"),
  );
}

async function save(noteId: string, model: string) {
  const review = JSON.parse(await Bun.stdin.text()) as { explanation?: string; recommendation?: string; reasoning?: string };
  if (!review.explanation?.trim() || !review.reasoning?.trim() || !RECOMMENDATIONS.includes(review.recommendation ?? "")) {
    throw new Error(`The review needs a non-empty explanation and reasoning, and a recommendation of ${RECOMMENDATIONS.join(" or ")}`);
  }
  const { error } = await target.from("ai_reviews").upsert({
    source: "x",
    note_id: noteId,
    explanation: review.explanation.trim(),
    recommendation: review.recommendation,
    reasoning: review.reasoning.trim(),
    model,
    created_at: new Date().toISOString(),
  });
  if (error) throw error;
  console.log(`Saved the review of ${noteId}.`);
}

const [command, first, second] = process.argv.slice(2);
if (command === "latest" && first) await latest(Number(first));
else if (command === "show" && first) await show(first);
else if (command === "save" && first && second) await save(first, second);
else throw new Error(USAGE);
