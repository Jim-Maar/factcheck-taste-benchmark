import { target } from "../import/db";
import { hasColumn, labelList, labelNames, noteView, parseReview, saveReview, transcript } from "./note";
import { liveSource, type PostSource } from "./thread";

/* Reads X notes and saves reviews of them, by hand. scripts/ai/run.ts, which
 * runs the AI reviewer, doesn't let its sessions run this: it shows each
 * session the note itself (note.ts) and saves the review it writes. Run from
 * the repository root, so Bun loads .env:
 *
 *   bun scripts/ai/review.ts latest <count>     the newest notes, by when they were written
 *   bun scripts/ai/review.ts show <note id>     the post and the note, as a reader of the post meets them
 *   bun scripts/ai/review.ts labels             the labels a review may use, with their definitions
 *   bun scripts/ai/review.ts save <note id> <model> < review.json
 *
 * `show` fetches the thread above the post and the posts it quotes, nested,
 * from X's embed endpoint, since the stored post holds one level at most and
 * no parent for most replies. When the endpoint doesn't serve the post, it
 * shows the stored post and says so. It leaves out how X rated the note, the raters'
 * reasons and the other notes on the post, so the review is the reviewer's
 * own judgement. A video that has a transcript (scripts/import/transcripts.ts)
 * shows what is said in it, and every video shows the command that saves
 * frames from it (frames.ts), since its preview image is one moment of it.
 * run.ts saves those frames for its sessions instead.
 *
 * The review is JSON: { "explanation": "...", "reasoning": "...", "labels": ["..."], "recommendation": "taste_failure" | "fine", "needs_note": "yes" | "no" }.
 * Saving again with the same model replaces that model's review of the note;
 * other models' reviews stay. The site shows a saved review at once.
 * scripts/ai/run.ts runs a model over many notes and records what it cost. */

const USAGE = "Usage: bun scripts/ai/review.ts latest <count> | show <note id> | labels | save <note id> <model> < review.json";

/** Posts from X's embed endpoint, with the stored transcripts of their videos. */
const reviewSource: PostSource = { ...liveSource, transcript };

async function latest(count: number) {
  const { data, error } = await target.from("x_notes").select("note_id, written").order("written", { ascending: false }).limit(count);
  if (error) throw error;
  for (const row of data) console.log(`${row.note_id}  ${row.written}`);
}

async function save(noteId: string, model: string) {
  const review = parseReview(JSON.parse(await Bun.stdin.text()), await labelNames());
  const needsNote = await hasColumn("needs_note");
  if (!needsNote) console.warn("taste.ai_reviews has no needs_note column yet (migration 19): the answer is not saved.");
  await saveReview({ source: "x", note_id: noteId, ...review, model, created_at: new Date().toISOString() }, needsNote);
  console.log(`Saved the review of ${noteId}.`);
}

const [command, first, second] = process.argv.slice(2);
if (command === "latest" && first) await latest(Number(first));
else if (command === "show" && first) console.log((await noteView(first, reviewSource)).text);
else if (command === "labels") console.log(labelList(await labelNames()));
else if (command === "save" && first && second) await save(first, second);
else throw new Error(USAGE);
