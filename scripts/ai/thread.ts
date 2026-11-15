import { largestMp4, videoId } from "../../src/core/xVideo";
import { displayText, fetchSyndicatedTweet, RateLimited, SYNDICATION_URL, syndicationToken, toXMedia, type SyndicationTweet, type XMedia } from "../import/xPosts";

/* A post as a reader of it meets it on X: the thread above it, oldest first,
 * and what it quotes, and what that quotes, indented under it. Posts come
 * from X's embed endpoint, or from saved copies for the checks in checks.ts. */

/** How far a post's context is followed. */
export const MAX_THREAD_POSTS = 6;
const MAX_QUOTE_DEPTH = 3;

export interface PostSource {
  /** One post, or null when it is gone or couldn't be loaded. */
  post(tweetId: string): Promise<SyndicationTweet | null>;
  /** Where the reviewer can open a photo or a video's preview image. */
  mediaLocation(url: string): string;
  /** What is said in a video, "" when it has no speech, or null when it has
   *  no transcript. Left out where transcripts aren't at hand. */
  transcript?(videoId: string): Promise<string | null>;
  /** What the reviewer is told about seeing more of a video than its preview
   *  image, given its largest file. Without it, the frames.ts command. */
  videoFrames?(file: string): Promise<string[]>;
}

/** X's embed endpoint failed for a reason that may pass (an error, a rate
 *  limit), so a post's context can't be shown in full right now. */
export class EmbedUnavailable extends Error {}

/** One post from X's embed endpoint, or null when X says it is gone. Any
 *  other failure throws EmbedUnavailable, so a reviewer is never shown less
 *  of a post's context than another reviewer was. scripts/ai/run.ts uses
 *  this. */
export async function fetchLivePostStrict(tweetId: string): Promise<SyndicationTweet | null> {
  let tweet: Awaited<ReturnType<typeof fetchSyndicatedTweet>>;
  try {
    tweet = await fetchSyndicatedTweet(tweetId);
  } catch (error) {
    throw new EmbedUnavailable(`X's embed endpoint ${error instanceof RateLimited ? "rate-limited us" : `failed: ${(error as Error).message}`} (post ${tweetId})`);
  }
  if (tweet === null) throw new EmbedUnavailable(`X's embed endpoint failed for post ${tweetId}`);
  return tweet === "gone" ? null : tweet;
}

/** One post from X's embed endpoint, or null when it is gone or the fetch failed. */
export async function fetchLivePost(tweetId: string): Promise<SyndicationTweet | null> {
  try {
    const response = await fetch(`${SYNDICATION_URL}?id=${tweetId}&token=${syndicationToken(tweetId)}`);
    if (!response.ok) return null;
    const tweet = (await response.json()) as SyndicationTweet;
    return tweet.__typename === "TweetTombstone" || !tweet.text ? null : tweet;
  } catch {
    return null;
  }
}

export const liveSource: PostSource = { post: fetchLivePost, mediaLocation: (url) => url };

export const indent = (lines: string[]) => lines.map((line) => `    ${line}`);

const byline = (tweet: SyndicationTweet) =>
  `${[tweet.user?.name, tweet.user?.screen_name && `@${tweet.user.screen_name}`].filter(Boolean).join(" ") || "Unknown author"}, ${tweet.created_at ?? "unknown date"}`;

/** A post's photos and videos, each video with the command for more of its
 *  frames (frames.ts) and its transcript when it has one. */
export async function mediaLines(source: PostSource, media: XMedia[]): Promise<string[]> {
  const lines: string[] = [];
  for (const item of media) {
    lines.push(`  ${item.type}: ${source.mediaLocation(item.url ?? item.preview_image_url ?? "(no url)")}`);
    const id = videoId(item);
    const file = id && largestMp4(item);
    if (file && source.videoFrames) lines.push(...indent(await source.videoFrames(file)));
    else if (file) lines.push(...indent([`That is its preview image. For frames from the rest of the video: bun scripts/ai/frames.ts ${file}`]));
    const transcript = id && source.transcript ? await source.transcript(id) : null;
    if (transcript !== null) lines.push(...indent([transcript ? `What is said in the video: ${transcript}` : "The video has no speech."]));
  }
  return lines;
}

/** A post with what it quotes, and what that quotes, indented under it. The
 *  embed gives a quoted post without its own quote, so each one is fetched. */
async function postLines(source: PostSource, tweet: SyndicationTweet, quoteDepth = 0): Promise<string[]> {
  const media = await mediaLines(source, (tweet.mediaDetails ?? []).map(toXMedia));
  const lines = [`${byline(tweet)}:`, ...displayText(tweet).split("\n"), ...media];
  const quoted = tweet.quoted_tweet;
  if (!quoted) return lines;
  if (quoteDepth >= MAX_QUOTE_DEPTH) return [...lines, "It quotes another post, not shown."];
  const full = (quoted.id_str && (await source.post(quoted.id_str))) || quoted;
  return [...lines, "It quotes this post:", ...indent(await postLines(source, full, quoteDepth + 1))];
}

/** The posts above this one in its thread, oldest first. */
async function threadAbove(source: PostSource, tweet: SyndicationTweet): Promise<{ lines: string[]; complete: boolean }> {
  const above: string[][] = [];
  let parentId = tweet.in_reply_to_status_id_str;
  while (parentId && above.length < MAX_THREAD_POSTS) {
    const parent = await source.post(parentId);
    if (!parent) {
      above.push([`(A post that is deleted or no longer public, id ${parentId}.)`]);
      parentId = undefined;
      break;
    }
    above.push(await postLines(source, parent));
    parentId = parent.in_reply_to_status_id_str;
  }
  return { lines: above.reverse().flatMap((lines) => [...lines, ""]), complete: !parentId };
}

/** The thread above the post, then the post with its quotes. */
export async function renderPost(source: PostSource, tweet: SyndicationTweet): Promise<string[]> {
  const thread = await threadAbove(source, tweet);
  const header = thread.complete ? "THE THREAD IT REPLIES TO, oldest first" : `THE THREAD IT REPLIES TO, its last ${MAX_THREAD_POSTS} posts, oldest first`;
  return [...(thread.lines.length ? [header, "", ...thread.lines] : []), "POST", ...(await postLines(source, tweet))];
}
