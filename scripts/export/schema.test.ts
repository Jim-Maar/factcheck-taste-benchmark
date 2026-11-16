import { describe, expect, test } from "bun:test";
import { buildBenchmark, type SourceRecord } from "./schema";

const fixture = (): SourceRecord => ({
  note: {
    note_id: "2118832498809720890", tweet_id: "2118816986348294159", note_text: "A correction",
    written: "2026-11-06T22:00:00Z", author_id: "writer", status: "helpful",
    helpful_ratings: 4, somewhat_helpful_ratings: 1, not_helpful_ratings: 2,
    helpful_tags: {}, not_helpful_tags: {}, dump_date: "2026-11-13",
  },
  post: { tweet_id: "2118816986348294159", text: "Post", referenced_kind: "replied_to" },
  verdict: "fine", accuracy: null, needs_note: null,
});

describe("benchmark mapping", () => {
  test("keeps exact IDs, written_at and unknown parent ID without removed fields", () => {
    const result = buildBenchmark([fixture()], []);
    const row = result.notes[0]!;
    expect(Object.keys(row).sort()).toEqual(["id", "text", "written_at", "generation_writer_account_id", "taste_verdict", "accuracy", "needs_note", "tweet", "x_ratings"].sort());
    expect(row.id).toBe("2118832498809720890");
    expect(row.written_at).toBe("2026-11-06T22:00:00Z");
    expect(row.tweet.referenced_kind).toBe("replied_to");
    expect(row.tweet.referenced_tweet_id).toBeNull();
  });
  test("resolves nested quotes, avoids cycles and joins transcript to best MP4", () => {
    const row = fixture();
    const quote = { id: "quote", text: "Quoted" };
    row.post!.referenced = quote;
    row.post!.referenced_kind = "quoted";
    row.post!.thread = { posts: [row.post!] };
    row.post!.media = [{ type: "video", variants: [
      { url: "https://video.twimg.com/amplify_video/123/low.mp4", content_type: "video/mp4", bit_rate: 1 },
      { url: "https://video.twimg.com/amplify_video/123/high.mp4", content_type: "video/mp4", bit_rate: 2 },
    ] }];
    const result = buildBenchmark([row], [{ video_id: "123", transcript: "Speech" }]);
    expect(result.tweets).toHaveLength(2);
    expect(result.notes[0]!.tweet.media[0]).toEqual({ type: "video", url: "https://video.twimg.com/amplify_video/123/high.mp4", preview_url: null, transcript: "Speech" });
    expect(result.notes[0]!.tweet.referenced_tweet_id).toBe("quote");
  });
  test("prefers original rows over embedded copies", () => {
    const first = fixture(), second = fixture();
    first.post!.referenced = { id: "other", text: "Embedded copy" };
    second.note = { ...second.note, note_id: "another-note", tweet_id: "other" };
    second.post = { tweet_id: "other", text: "Original row" };
    const result = buildBenchmark([first, second], []);
    expect(result.tweets.find(t => t.id === "other")!.text).toBe("Original row");
  });
  test("rejects missing posts and duplicate note IDs", () => {
    expect(() => buildBenchmark([{ ...fixture(), post: null }], [])).toThrow("Missing post");
    expect(() => buildBenchmark([fixture(), fixture()], [])).toThrow("Duplicate");
  });
});
