export type Verdict = "fine" | "taste_failure" | "somewhat" | "unsure";
export type Accuracy = "correct" | "unconvincing" | "partly" | "wrong" | "unsure";
export type NeedsNote = "yes" | "no" | "unsure";
export type ReferenceKind = "quoted" | "replied_to" | "retweeted";
interface SourceMedia {
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
  variants?: { url: string; content_type: string; bit_rate?: number }[];
}
export interface SourcePost {
  tweet_id?: string;
  id?: string;
  text?: string | null;
  author_handle?: string | null;
  handle?: string | null;
  posted_at?: string | null;
  postedAt?: string | null;
  referenced_kind?: ReferenceKind | null;
  referenced?: SourcePost | null;
  quoted?: SourcePost | null;
  media?: SourceMedia[];
  thread?: { posts: SourcePost[] } | null;
}
interface SourceNote {
  note_id: string;
  tweet_id: string;
  note_text: string;
  written: string | null;
  author_id: string;
  status: "helpful" | "not_helpful" | "needs_ratings";
  helpful_ratings: number;
  somewhat_helpful_ratings: number;
  not_helpful_ratings: number;
  helpful_tags: Record<string, number>;
  not_helpful_tags: Record<string, number>;
  dump_date: string;
}
export interface SourceRecord {
  note: SourceNote;
  post: SourcePost | null;
  verdict: Verdict;
  accuracy: Accuracy | null;
  needs_note: NeedsNote | null;
}
export interface Transcript { video_id: string; transcript: string }
interface Tweet {
  id: string;
  text: string | null;
  author_handle: string | null;
  posted_at: string | null;
  referenced_tweet_id: string | null;
  referenced_kind: ReferenceKind | null;
  media: { type: "image" | "video" | "animated_gif"; url: string | null; preview_url: string | null; transcript: string | null }[];
}

/** Pure mapping: keep explicit references; never guess a reply parent from thread order. */
export function buildBenchmark(records: SourceRecord[], transcripts: Transcript[]) {
  const speech = new Map(transcripts.map(t => [t.video_id, t.transcript]));
  const tweets = new Map<string, Tweet>();
  const originals = new Map<string, SourcePost>();
  for (const { note, post } of records) {
    if (!post) throw new Error(`Missing post for note ${note.note_id}`);
    originals.set(note.tweet_id, post);
  }
  function addTweet(source: SourcePost): Tweet {
    const id = source.tweet_id ?? source.id;
    if (!id || typeof id !== "string") throw new Error("Missing string tweet ID");
    const existing = tweets.get(id);
    if (existing) return existing;
    const p = originals.get(id) ?? source;
    const ref = p.referenced ?? p.quoted;
    const tweet: Tweet = {
      id, text: p.text ?? null, author_handle: p.author_handle ?? p.handle ?? null,
      posted_at: p.posted_at ?? p.postedAt ?? null,
      referenced_tweet_id: ref?.id ?? ref?.tweet_id ?? null,
      referenced_kind: p.referenced_kind ?? (p.quoted ? "quoted" : null),
      media: (p.media ?? []).map(m => {
        const mp4 = (m.variants ?? []).filter(v => v.content_type === "video/mp4").sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0];
        const videoId = (m.variants ?? []).map(v => v.url.match(/(?:amplify_video|ext_tw_video)\/(\d+)\//)?.[1]).find(Boolean);
        return {
          type: m.type === "photo" ? "image" : m.type,
          url: m.type === "photo" ? m.url ?? null : mp4?.url ?? null,
          preview_url: m.preview_image_url ?? null,
          transcript: videoId ? speech.get(videoId) ?? null : null,
        };
      }),
    };
    tweets.set(id, tweet);
    if (ref && tweet.referenced_tweet_id) addTweet(ref);
    for (const earlier of p.thread?.posts ?? []) if (earlier.id || earlier.tweet_id) addTweet(earlier);
    return tweet;
  }
  const ids = new Set<string>();
  const notes = records.map(r => {
    const n = r.note;
    if (typeof n.note_id !== "string" || ids.has(n.note_id)) throw new Error("Duplicate or non-string note ID");
    ids.add(n.note_id);
    if (!["fine", "taste_failure", "somewhat", "unsure"].includes(r.verdict)) throw new Error("Unknown verdict");
    return {
      id: n.note_id, text: n.note_text, written_at: n.written,
      generation_writer_account_id: n.author_id, taste_verdict: r.verdict,
      accuracy: r.accuracy, needs_note: r.needs_note, tweet: addTweet(r.post!),
      x_ratings: {
        status: n.status, helpful_count: n.helpful_ratings, somewhat_helpful_count: n.somewhat_helpful_ratings,
        not_helpful_count: n.not_helpful_ratings, helpful_reasons: n.helpful_tags, not_helpful_reasons: n.not_helpful_tags,
      },
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const count = (values: string[]) => Object.fromEntries([...new Set(values)].sort().map(v => [v, values.filter(x => x === v).length]));
  return {
    notes, tweets: [...tweets.values()].sort((a, b) => a.id.localeCompare(b.id)),
    stats: {
      notes: notes.length, tweets: tweets.size, verdicts: count(notes.map(n => n.taste_verdict)),
      withAccuracy: notes.filter(n => n.accuracy !== null).length,
      withNeedsNote: notes.filter(n => n.needs_note !== null).length,
      withReference: notes.filter(n => n.tweet.referenced_tweet_id !== null).length,
      referenceKinds: count(notes.map(n => n.tweet.referenced_kind ?? "null")),
      ratingSnapshotDates: [...new Set(records.map(r => r.note.dump_date))].sort(),
    },
  };
}
