import type { SupabaseClient } from "@supabase/supabase-js";
import { sourceClient, target, upsertRows } from "./db";

/* The posts the X notes are on. X's public data has no post text, so the
 * import first takes every post cn-return-bot already stored, and then asks
 * X's embed endpoint for the rest: the free address that X's own embedded
 * posts load from. A post is fetched once. `available` stays null when a
 * fetch fails for a passing reason, so the next run tries it again. */

const SOURCE_CHUNK_SIZE = 150;
const FETCH_CONCURRENCY = 4;
const WRITE_BATCH_SIZE = 50;
const PROGRESS_EVERY = 250;
const RATE_LIMIT_PAUSE_MS = 60_000;
const MAX_RATE_LIMIT_PAUSES = 10;
export const SYNDICATION_URL = "https://cdn.syndication.twimg.com/tweet-result";

interface XMedia {
  type: string;
  url?: string;
  preview_image_url?: string;
  variants?: { url: string; bit_rate?: number; content_type: string }[];
}

interface PostRow {
  tweet_id: string;
  available: boolean;
  author_name?: string | null;
  author_handle?: string | null;
  text?: string | null;
  posted_at?: string | null;
  media?: XMedia[];
  referenced?: { text: string | null; media: XMedia[] } | null;
  referenced_kind?: string | null;
  fetched_at: string;
}

/** The posts of the copied notes that no fetch has settled yet. */
async function postsToFetch(): Promise<string[]> {
  const noteTweets = new Set<string>();
  const settled = new Set<string>();
  const PAGE = 1000;
  for (const [table, column, into, onlySettled] of [
    ["x_notes", "tweet_id", noteTweets, false],
    ["x_posts", "tweet_id", settled, true],
  ] as const) {
    let last = "";
    for (;;) {
      let query = target.from(table).select(column).gt(column, last).order(column).limit(PAGE);
      if (onlySettled) query = query.not("available", "is", null);
      const { data, error } = await query;
      if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
      for (const row of data as Record<string, string>[]) into.add(row[column]!);
      if (data.length < PAGE) break;
      last = (data.at(-1) as Record<string, string>)[column]!;
    }
  }
  return [...noteTweets].filter((id) => !settled.has(id));
}

type StoredTweet = {
  tweet_id: string;
  text: string | null;
  author_name: string | null;
  author_handle: string | null;
  posted_at: string | null;
  media: XMedia[] | null;
  referenced_tweet_data: { text?: string; media?: XMedia[] } | null;
  referenced_tweets: { type: string }[] | null;
};

const storedToRow = (tweet: StoredTweet, fetchedAt: string): PostRow => ({
  tweet_id: tweet.tweet_id,
  available: true,
  author_name: tweet.author_name,
  author_handle: tweet.author_handle,
  text: tweet.text,
  posted_at: tweet.posted_at,
  media: tweet.media ?? [],
  referenced: tweet.referenced_tweet_data && { text: tweet.referenced_tweet_data.text ?? null, media: tweet.referenced_tweet_data.media ?? [] },
  referenced_kind: tweet.referenced_tweets?.[0]?.type ?? null,
  fetched_at: fetchedAt,
});

/** The posts cn-return-bot already stored with their text. */
async function copyStoredPosts(source: SupabaseClient, tweetIds: string[]): Promise<Set<string>> {
  const copied = new Set<string>();
  const fetchedAt = new Date().toISOString();
  for (let start = 0; start < tweetIds.length; start += SOURCE_CHUNK_SIZE) {
    const chunk = tweetIds.slice(start, start + SOURCE_CHUNK_SIZE);
    const { data, error } = await source
      .from("tweets")
      .select("tweet_id, text, author_name, author_handle, posted_at, media, referenced_tweet_data, referenced_tweets")
      .in("tweet_id", chunk)
      .not("text", "is", null);
    if (error) throw new Error(`Reading tweets failed: ${error.message}`);
    const rows = (data as StoredTweet[]).map((tweet) => storedToRow(tweet, fetchedAt));
    await upsertRows("x_posts", rows, "tweet_id");
    for (const row of rows) copied.add(row.tweet_id);
  }
  return copied;
}

/** The token X's embed widget sends with a request, as react-tweet computes it. */
export const syndicationToken = (id: string) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");

export type SyndicationMedia = {
  type: string;
  media_url_https: string;
  video_info?: { variants: { url: string; bitrate?: number; content_type: string }[] };
};

export type SyndicationTweet = {
  __typename?: string;
  id_str?: string;
  text?: string;
  created_at?: string;
  display_text_range?: [number, number];
  user?: { name?: string; screen_name?: string };
  entities?: { urls?: { url: string; expanded_url: string }[]; media?: { url: string }[] };
  mediaDetails?: SyndicationMedia[];
  quoted_tweet?: SyndicationTweet;
  in_reply_to_status_id_str?: string;
};

/** A photo, video or gif in the X API's shape, which the cards read. */
export function toXMedia(media: SyndicationMedia): XMedia {
  if (media.type === "photo") return { type: "photo", url: media.media_url_https };
  return {
    type: media.type,
    preview_image_url: media.media_url_https,
    variants: (media.video_info?.variants ?? []).map((v) => ({ url: v.url, bit_rate: v.bitrate, content_type: v.content_type })),
  };
}

const HTML_ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** The text as X shows it: without the trailing link to the post's own
 *  media, with short links expanded and HTML entities decoded. */
export function displayText(tweet: SyndicationTweet): string {
  // X counts the range in UTF-16 code units, as JavaScript strings do.
  const full = tweet.text ?? "";
  const [start, end] = tweet.display_text_range ?? [0, full.length];
  let text = full.slice(start, end);
  for (const link of tweet.entities?.urls ?? []) text = text.replaceAll(link.url, link.expanded_url);
  return text.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

function syndicationToRow(tweetId: string, tweet: SyndicationTweet, fetchedAt: string): PostRow {
  if (tweet.__typename === "TweetTombstone" || !tweet.text) return { tweet_id: tweetId, available: false, fetched_at: fetchedAt };
  const quoted = tweet.quoted_tweet;
  return {
    tweet_id: tweetId,
    available: true,
    author_name: tweet.user?.name ?? null,
    author_handle: tweet.user?.screen_name ?? null,
    text: displayText(tweet),
    posted_at: tweet.created_at ?? null,
    media: (tweet.mediaDetails ?? []).map(toXMedia),
    referenced: quoted ? { text: displayText(quoted), media: (quoted.mediaDetails ?? []).map(toXMedia) } : null,
    referenced_kind: quoted ? "quoted" : tweet.in_reply_to_status_id_str ? "replied_to" : null,
    fetched_at: fetchedAt,
  };
}

class RateLimited extends Error {}

/** One post from the embed endpoint. Null when the fetch failed for a reason
 *  that may pass, so the post is tried again on the next run. */
async function fetchSyndicated(tweetId: string): Promise<PostRow | null> {
  const fetchedAt = new Date().toISOString();
  const response = await fetch(`${SYNDICATION_URL}?id=${tweetId}&token=${syndicationToken(tweetId)}`);
  if (response.status === 429) throw new RateLimited();
  if (response.status === 404) return { tweet_id: tweetId, available: false, fetched_at: fetchedAt };
  if (!response.ok) return null;
  const body = await response.text();
  if (body.trim() === "" || body.trim() === "{}") return { tweet_id: tweetId, available: false, fetched_at: fetchedAt };
  return syndicationToRow(tweetId, JSON.parse(body) as SyndicationTweet, fetchedAt);
}

/** Fetches the posts a few at a time and writes them in batches. On a rate
 *  limit every worker pauses, and after too many pauses the run stops; the
 *  next run picks up where this one left off. */
async function fetchSyndicatedPosts(tweetIds: string[]): Promise<void> {
  let next = 0;
  let done = 0;
  let unavailable = 0;
  let failed = 0;
  let pauses = 0;
  let pending: PostRow[] = [];
  const flush = async () => {
    const batch = pending;
    pending = [];
    if (batch.length > 0) await upsertRows("x_posts", batch, "tweet_id");
  };
  const worker = async () => {
    while (next < tweetIds.length && pauses <= MAX_RATE_LIMIT_PAUSES) {
      const tweetId = tweetIds[next++]!;
      try {
        const row = await fetchSyndicated(tweetId);
        if (row) pending.push(row);
        if (row && !row.available) unavailable++;
        if (!row) failed++;
      } catch (error) {
        if (!(error instanceof RateLimited)) {
          failed++;
          continue;
        }
        pauses++;
        console.log(`[posts] rate limited, pausing ${RATE_LIMIT_PAUSE_MS / 1000}s (pause ${pauses} of ${MAX_RATE_LIMIT_PAUSES})`);
        await Bun.sleep(RATE_LIMIT_PAUSE_MS);
        continue;
      }
      done++;
      if (pending.length >= WRITE_BATCH_SIZE) await flush();
      if (done % PROGRESS_EVERY === 0) console.log(`[posts] ${done} of ${tweetIds.length} fetched, ${unavailable} unavailable, ${failed} failed`);
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  await flush();
  console.log(`[posts] finished: ${done} fetched, ${unavailable} unavailable, ${failed} failed and left for the next run`);
  if (pauses > MAX_RATE_LIMIT_PAUSES) throw new Error("X kept rate-limiting the embed endpoint. Run `posts` again later to continue.");
}

export async function importXPosts(): Promise<void> {
  const tweetIds = await postsToFetch();
  console.log(`[posts] ${tweetIds.length} posts to settle`);
  const copied = await copyStoredPosts(await sourceClient(), tweetIds);
  console.log(`[posts] ${copied.size} copied from cn-return-bot's tweets table`);
  await fetchSyndicatedPosts(tweetIds.filter((id) => !copied.has(id)));
}
