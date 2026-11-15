import { labelDefinition } from "../../src/core/labelDefinitions";
import { target } from "../import/db";
import type { XMedia } from "../import/xPosts";
import { indent, mediaLines, renderPost, type PostSource } from "./thread";

/* What review.ts and run.ts share: a note as its reviewer meets it, the
 * labels a review may use, and the checks a review must pass before it is
 * saved. Leaves out how X rated the note, the raters' reasons and the other
 * notes on the post, so the review is the reviewer's own judgement. */

export const RECOMMENDATIONS = ["taste_failure", "fine"] as const;
/** Whether the post needs a community note at all (migration 19). */
export const NEEDS_NOTE_ANSWERS = ["yes", "no"] as const;
/** A review sits beside a note of a few hundred characters, and must not take
 *  longer to read than the note. */
export const MAX_EXPLANATION_CHARS = 300;
export const MAX_REASONING_CHARS = 300;

export interface Review {
  explanation: string;
  reasoning: string;
  labels: string[];
  recommendation: (typeof RECOMMENDATIONS)[number];
  needs_note: (typeof NEEDS_NOTE_ANSWERS)[number];
}

/** What is said in a stored video, "" for no speech, null for no transcript. */
export async function transcript(videoId: string): Promise<string | null> {
  const { data, error } = await target.from("x_video_transcripts").select("transcript").eq("video_id", videoId).maybeSingle();
  if (error) throw error;
  return data?.transcript ?? null;
}

export type NoteView =
  | { kind: "deleted"; text: string }
  /** `stored` when X no longer serves the post and the stored copy, without
   *  its thread, is shown instead. */
  | { kind: "shown"; text: string; noteText: string; stored: boolean };

/** The post and the note, as a reader of the post meets them. The source's
 *  `post` decides what an embed failure does: return null to fall back to the
 *  stored post, or throw to fail. */
export async function noteView(noteId: string, source: PostSource): Promise<NoteView> {
  const { data: note, error } = await target.from("x_notes").select("tweet_id, note_text, written").eq("note_id", noteId).single();
  if (error) throw error;
  const { data: post, error: postError } = await target.from("x_posts").select("*").eq("tweet_id", note.tweet_id).maybeSingle();
  if (postError) throw postError;
  const noteLines = ["", `NOTE, written ${note.written}`, note.note_text];
  if (!post?.available) return { kind: "deleted", text: ["POST", "The post is deleted or no longer public on X.", ...noteLines].join("\n") };

  const live = await source.post(note.tweet_id);
  if (live) return { kind: "shown", text: [...(await renderPost(source, live)), ...noteLines].join("\n"), noteText: note.note_text, stored: false };

  // X no longer serves the post, so its thread and quotes can't be followed: show what was stored, and say so.
  const stored = [
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
    ...(post.referenced_kind === "replied_to" && !post.referenced ? ["It replies to a post that couldn't be loaded."] : []),
  ];
  return { kind: "shown", text: ["POST", ...stored, ...noteLines].join("\n"), noteText: note.note_text, stored: true };
}

/** The names of the labels people put on notes on the site. */
export async function labelNames(): Promise<string[]> {
  const { data, error } = await target.from("labels").select("name").order("name");
  if (error) throw error;
  return data.map((row) => row.name as string);
}

/** The labels with their definitions (src/core/labelDefinitions.ts), one a
 *  line, as the reviewer and the labellers read them. */
export const labelList = (names: string[]) =>
  names.map((name) => {
    const definition = labelDefinition(name);
    return definition ? `- \`${name}\`: ${definition}` : `- \`${name}\``;
  }).join("\n");

/** The review, checked, with its labels named as on the site, or an error
 *  saying what is wrong with it. */
export function parseReview(raw: unknown, known: string[]): Review {
  const review = (raw ?? {}) as { explanation?: unknown; reasoning?: unknown; labels?: unknown; recommendation?: unknown; needs_note?: unknown };
  const explanation = typeof review.explanation === "string" ? review.explanation.trim() : review.explanation == null ? "" : null;
  const reasoning = typeof review.reasoning === "string" ? review.reasoning.trim() : "";
  if (
    explanation === null ||
    !reasoning ||
    !Array.isArray(review.labels) ||
    !review.labels.every((label) => typeof label === "string") ||
    !RECOMMENDATIONS.includes(review.recommendation as Review["recommendation"]) ||
    !NEEDS_NOTE_ANSWERS.includes(review.needs_note as Review["needs_note"])
  ) {
    throw new Error(
      `The review needs a reasoning, a list of labels (empty when none applies), a recommendation of ${RECOMMENDATIONS.join(" or ")} and a needs_note of ${NEEDS_NOTE_ANSWERS.join(" or ")}`,
    );
  }
  if (explanation.length > MAX_EXPLANATION_CHARS || reasoning.length > MAX_REASONING_CHARS) {
    throw new Error(
      `Too long: the explanation has ${explanation.length} characters of at most ${MAX_EXPLANATION_CHARS}, the reasoning ${reasoning.length} of at most ${MAX_REASONING_CHARS}`,
    );
  }
  const labels = [...new Set((review.labels as string[]).map((name) => known.find((label) => label.toLowerCase() === name.trim().toLowerCase()) ?? name))];
  const unknown = labels.filter((name) => !known.includes(name));
  if (unknown.length) throw new Error(`No such label: ${unknown.join(", ")}. The labels are: ${known.join(", ")}`);
  return { explanation, reasoning, labels, recommendation: review.recommendation as Review["recommendation"], needs_note: review.needs_note as Review["needs_note"] };
}

/** Whether taste.ai_reviews has a column yet (prompt_version: migration 18, needs_note: 19). */
export async function hasColumn(column: string): Promise<boolean> {
  const { error } = await target.from("ai_reviews").select(column).limit(1);
  return !error;
}

/** Saves a review, replacing the model's earlier one of the note. Without
 *  the needs_note column (migration 19 not applied yet) the answer is left
 *  out, and saved nowhere but the run's logs. */
export async function saveReview(row: Record<string, unknown> & { needs_note?: string }, needsNoteColumn: boolean) {
  const { needs_note, ...rest } = row;
  const { error } = await target.from("ai_reviews").upsert(needsNoteColumn ? { ...rest, needs_note } : rest);
  if (error) throw new Error(`saving the review failed: ${error.message}`);
}
