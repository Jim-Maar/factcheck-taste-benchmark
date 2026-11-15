import { createContext, useContext, useState } from "react";
import type { XEmbeddedPost, XMedia, XNote } from "@cn/core/taste";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { PlayIcon } from "@cn/ui/icons";
import { getBestMediaUrl } from "@cn/shared/bestMediaUrl";
import { LinkifiedText } from "@cn/shared/LinkifiedText";
import { videoId } from "@cn/core/xVideo";

type Post = XNote["post"];

const REFERENCED_LABEL = { quoted: "Quoted post", replied_to: "Replying to", retweeted: "Reposted" } as const;

const postUrl = (id: string) => `https://x.com/i/status/${id}`;

const linkClass = "text-link hover:underline break-all";

const MEDIA_LABEL: Record<string, string> = { photo: "Photo", animated_gif: "GIF", video: "Video" };

/** One photo, or one video's still frame, which opens the full image or the
 *  video file. X's image host refuses an image request that names another
 *  site as its referrer, so the image sends none. A post deleted on X takes
 *  its images with it, and such a tile says so instead of showing a broken
 *  picture, so the grid keeps its shape. A lone image keeps its own shape up
 *  to a height limit. In a grid every tile fills its cell. */
function MediaTile({ item, url, lone, className }: { item: XMedia; url: string; lone: boolean; className?: string }) {
  const [failed, setFailed] = useState(false);
  const still = item.type === "photo" ? url : item.preview_image_url;
  const label = MEDIA_LABEL[item.type] ?? "Video";
  return (
    <a href={url} target="_blank" rel="noreferrer" className={cn("relative block min-h-0 overflow-hidden bg-surface-muted", className)}>
      {still && !failed ? (
        <img
          src={still}
          alt={label}
          loading="lazy"
          referrerPolicy="no-referrer"
          className={cn("w-full object-cover", lone ? "max-h-[32rem]" : "h-full")}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="flex h-full min-h-24 items-center justify-center text-xs text-fg-muted">{failed ? `${label} no longer available` : label}</span>
      )}
      {still && !failed && item.type === "animated_gif" && (
        <span className="absolute bottom-2 left-2 rounded-control bg-black/70 px-1.5 py-0.5 text-xs font-semibold text-white">GIF</span>
      )}
      {still && !failed && item.type === "video" && (
        <span className="absolute inset-0 m-auto flex h-12 w-12 items-center justify-center rounded-full bg-black/60 text-white">
          <PlayIcon size={26} aria-hidden />
        </span>
      )}
    </a>
  );
}

/** The transcripts of the videos on the card, by video id. */
const TranscriptsContext = createContext<NonNullable<Post["transcripts"]>>({});

/** A video's transcript behind a toggle. A video without speech says so. */
function Transcript({ text, number }: { text: string; number: number | null }) {
  const [open, setOpen] = useState(false);
  const name = number === null ? "transcript" : `transcript of video ${number}`;
  return (
    <div>
      <Button variant="link" className="text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? `Hide the ${name}` : `Show the ${name}`}
      </Button>
      {open && <p className="mt-1.5 whitespace-pre-wrap rounded-card bg-surface-muted p-3 text-sm text-fg-secondary">{text || "The video has no speech."}</p>}
    </div>
  );
}

/** A post's photos and videos as X lays them out: one at its own shape, and
 *  two to four in a 16:9 frame, side by side, with the first of three taking
 *  the whole left half. */
function Media({ media }: { media: XMedia[] }) {
  const allTranscripts = useContext(TranscriptsContext);
  const shown = media.flatMap((item) => {
    const url = getBestMediaUrl(item);
    return url ? [{ item, url }] : [];
  }).slice(0, 4);
  if (shown.length === 0) return null;
  const lone = shown.length === 1;
  const videoCount = shown.filter(({ item }) => item.type === "video").length;
  const transcripts = shown.flatMap(({ item }, i) => {
    const id = videoId(item);
    const transcript = id ? allTranscripts[id] : undefined;
    return transcript ? [{ id: id!, text: transcript.text, number: videoCount > 1 ? i + 1 : null }] : [];
  });
  return (
    <>
      <div className={cn("overflow-hidden rounded-card border border-line", !lone && "grid aspect-video grid-cols-2 gap-0.5", shown.length > 2 ? "grid-rows-2" : "grid-rows-1")}>
        {shown.map(({ item, url }, i) => (
          <MediaTile key={url} item={item} url={url} lone={lone} className={cn(shown.length === 3 && i === 0 && "row-span-2")} />
        ))}
      </div>
      {transcripts.map(({ id, text, number }) => <Transcript key={id} text={text} number={number} />)}
    </>
  );
}

const formatDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

/** Who wrote a post and when, on one line. */
function Byline({ name, handle, postedAt, className }: { name?: string | null; handle?: string | null; postedAt?: string | null; className?: string }) {
  const date = formatDate(postedAt);
  if (!name && !handle && !date) return null;
  return (
    <span className={cn("min-w-0 text-sm", className)}>
      {name && <span className="font-semibold text-fg">{name} </span>}
      {handle && <span className="text-fg-muted">@{handle}</span>}
      {date && <span className="text-fg-muted"> · {date}</span>}
    </span>
  );
}

/** A post inside another, in a recessed box: the post it quotes, or the one
 *  it replies to when the thread has not been fetched. */
function EmbeddedPost({ post, label }: { post: XEmbeddedPost; label?: string }) {
  if (!post.text && (post.media?.length ?? 0) === 0) return null;
  return (
    <div className="space-y-1.5 rounded-card border border-line p-3">
      {label && <div className="text-xs font-semibold text-fg-muted">{label}</div>}
      <Byline name={post.name} handle={post.handle} postedAt={post.postedAt} className="block" />
      {post.text && <LinkifiedText className="text-sm text-fg-secondary whitespace-pre-wrap" linkClassName={linkClass} text={post.text} />}
      <Media media={post.media ?? []} />
    </div>
  );
}

/** One post of the thread above, on a rail that runs down to the next one,
 *  the way X draws a thread. */
function ThreadPost({ post }: { post: XEmbeddedPost }) {
  return (
    <li className="space-y-1.5 border-l-2 border-line pb-4 pl-3">
      {post.available === false ? (
        <p className="text-sm text-fg-muted">This post is no longer on X.</p>
      ) : (
        <>
          <Byline name={post.name} handle={post.handle} postedAt={post.postedAt} className="block" />
          {post.text && <LinkifiedText className="text-sm text-fg-secondary whitespace-pre-wrap" linkClassName={linkClass} text={post.text} />}
          <Media media={post.media ?? []} />
          {post.quoted && <EmbeddedPost post={post.quoted} />}
        </>
      )}
    </li>
  );
}

/** The posts above this one, behind a toggle, oldest first. */
function Thread({ thread, postId }: { thread: NonNullable<Post["thread"]>; postId: string }) {
  const [open, setOpen] = useState(false);
  const count = thread.posts.length;
  if (count === 0) return null;
  return (
    <div>
      <Button variant="link" className="text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide the thread" : `Show ${count === 1 ? "the post" : `the ${count} posts`} it replies to`}
      </Button>
      {open && (
        <ol className="mt-3">
          {!thread.complete && (
            <li className="border-l-2 border-dashed border-line pb-4 pl-3 text-xs text-fg-muted">
              The thread starts further up.{" "}
              <a href={postUrl(postId)} target="_blank" rel="noreferrer" className="text-link hover:underline">
                See it on X ↗
              </a>
            </li>
          )}
          {thread.posts.map((post, i) => <ThreadPost key={post.id ?? i} post={post} />)}
        </ol>
      )}
    </div>
  );
}

/** The X post a note is on, the way X shows it: who wrote it and when, its
 *  text and media, the post it quotes inside it, and the thread it replies
 *  to behind a toggle. It plays the part the quoted passage plays on the
 *  website's note cards. */
export function XPostCard({ post }: { post: Post }) {
  if (!post.available) {
    return (
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-card border border-line bg-surface-muted p-3 text-sm text-fg-muted">
        {post.available === false ? "X no longer has this post." : "The post has not been fetched yet."}
        <a href={postUrl(post.id)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-link hover:underline">
          View on X ↗
        </a>
      </div>
    );
  }
  const referenced = post.referenced;
  // With the thread at hand, the post it replies to is the thread's last one.
  const showReferenced = referenced && !(referenced.kind === "replied_to" && (post.thread?.posts.length ?? 0) > 0);
  return (
    <TranscriptsContext.Provider value={post.transcripts ?? {}}>
    <div className="space-y-3 rounded-card border border-line p-3 [overflow-wrap:anywhere]">
      {post.thread && <Thread thread={post.thread} postId={post.id} />}
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Byline name={post.name} handle={post.handle} postedAt={post.postedAt} />
          <a href={postUrl(post.id)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-link hover:underline">
            View on X ↗
          </a>
        </div>
        {post.text && <LinkifiedText className="text-base text-fg whitespace-pre-wrap" linkClassName={linkClass} text={post.text} />}
        <Media media={post.media} />
        {showReferenced && <EmbeddedPost post={referenced} label={REFERENCED_LABEL[referenced.kind ?? "quoted"]} />}
      </div>
    </div>
    </TranscriptsContext.Provider>
  );
}
