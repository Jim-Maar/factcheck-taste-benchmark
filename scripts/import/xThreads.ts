import { target, upsertRows } from "./db";
import { embeddedPost, fetchSyndicatedTweet, RateLimited, type EmbeddedPost } from "./xPosts";

/* The threads above the X posts, so a card can show what a post replies to.
 * For every post that is still on X and has no thread yet, it walks up the
 * replies through X's embed endpoint, and also stores the post it quotes with
 * its author. A post is done once. A fetch that fails for a passing reason
 * leaves the post for the next run. It only writes the thread column, and the
 * quoted post when X gives one, so nothing stored is lost. */

const MAX_THREAD_POSTS = 6;
const FETCH_CONCURRENCY = 4;
const WRITE_BATCH_SIZE = 50;
const PROGRESS_EVERY = 100;
const RATE_LIMIT_PAUSE_MS = 60_000;
const MAX_RATE_LIMIT_PAUSES = 10;
const PAGE = 1000;

interface ThreadRow {
  tweet_id: string;
  thread: { posts: EmbeddedPost[]; complete: boolean };
  referenced?: EmbeddedPost;
  referenced_kind?: "quoted";
}

/** The posts on X whose thread has not been fetched yet. */
async function postsWithoutThread(): Promise<string[]> {
  const ids: string[] = [];
  let last = "";
  for (;;) {
    const { data, error } = await target
      .from("x_posts")
      .select("tweet_id")
      .eq("available", true)
      .is("thread", null)
      .gt("tweet_id", last)
      .order("tweet_id")
      .limit(PAGE);
    if (error) throw new Error(`Reading x_posts failed: ${error.message}`);
    ids.push(...data.map((row) => row.tweet_id as string));
    if (data.length < PAGE) return ids;
    last = ids.at(-1)!;
  }
}

const gonePost = (id: string): EmbeddedPost => ({ id, available: false, name: null, handle: null, postedAt: null, text: null, media: [], quoted: null });

/** The thread above one post, oldest first, and what the post quotes. Null
 *  when a fetch failed for a reason that may pass, or the post is gone. */
async function fetchThread(tweetId: string): Promise<ThreadRow | null> {
  const tweet = await fetchSyndicatedTweet(tweetId);
  if (!tweet || tweet === "gone") return null;
  const above: EmbeddedPost[] = [];
  let parentId = tweet.in_reply_to_status_id_str;
  while (parentId && above.length < MAX_THREAD_POSTS) {
    const parent = await fetchSyndicatedTweet(parentId);
    if (!parent) return null;
    if (parent === "gone") {
      above.push(gonePost(parentId));
      parentId = undefined;
      break;
    }
    above.push(embeddedPost(parent));
    parentId = parent.in_reply_to_status_id_str;
  }
  const row: ThreadRow = { tweet_id: tweetId, thread: { posts: above.reverse(), complete: !parentId } };
  if (tweet.quoted_tweet) {
    row.referenced = embeddedPost(tweet.quoted_tweet);
    row.referenced_kind = "quoted";
  }
  return row;
}

export async function importXThreads(): Promise<void> {
  const tweetIds = await postsWithoutThread();
  console.log(`[threads] ${tweetIds.length} posts without a thread`);
  let next = 0;
  let done = 0;
  let failed = 0;
  let pauses = 0;
  let pending: ThreadRow[] = [];
  // Rows with and without a quoted post go in separate writes. In one write
  // every row would carry the same columns, and a row without a quote would
  // clear the quoted post stored before.
  const flush = async () => {
    const batch = pending;
    pending = [];
    await upsertRows("x_posts", batch.filter((row) => row.referenced), "tweet_id");
    await upsertRows("x_posts", batch.filter((row) => !row.referenced), "tweet_id");
  };
  const worker = async () => {
    while (next < tweetIds.length && pauses <= MAX_RATE_LIMIT_PAUSES) {
      const tweetId = tweetIds[next++]!;
      try {
        const row = await fetchThread(tweetId);
        if (!row) {
          failed++;
          continue;
        }
        pending.push(row);
      } catch (error) {
        if (!(error instanceof RateLimited)) {
          failed++;
          continue;
        }
        pauses++;
        tweetIds.push(tweetId); // Try this post again after the pause.
        console.log(`[threads] rate limited, pausing ${RATE_LIMIT_PAUSE_MS / 1000}s (pause ${pauses} of ${MAX_RATE_LIMIT_PAUSES})`);
        await Bun.sleep(RATE_LIMIT_PAUSE_MS);
        continue;
      }
      done++;
      if (pending.length >= WRITE_BATCH_SIZE) await flush();
      if (done % PROGRESS_EVERY === 0) console.log(`[threads] ${done} done, ${failed} failed`);
    }
  };
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker));
  await flush();
  console.log(`[threads] finished: ${done} done, ${failed} failed and left for the next run`);
  if (pauses > MAX_RATE_LIMIT_PAUSES) throw new Error("X kept rate-limiting the embed endpoint. Run `threads` again later to continue.");
}
