/* X gives every video an id, which is part of each of its file addresses, for
 * example https://video.twimg.com/amplify_video/2059228176774262784/vid/...
 * A transcript is stored under that id, so the same video finds its
 * transcript in the post, in a post that quotes it and in a thread. A gif has
 * no sound, so it has no id here. This file has no imports, so the scripts
 * can use it too. */

const VIDEO_ID_PATTERN = /video\.twimg\.com\/(?:amplify_video|ext_tw_video)\/(\d+)\//;

interface VideoMedia {
  type: string;
  variants?: { url: string; bit_rate?: number; content_type: string }[];
}

/** The video's id, or null for a photo, a gif or a video without files. */
export function videoId(media: VideoMedia): string | null {
  if (media.type !== "video") return null;
  for (const variant of media.variants ?? []) {
    const match = variant.url.match(VIDEO_ID_PATTERN);
    if (match) return match[1]!;
  }
  return null;
}

const mp4sSmallestFirst = (media: VideoMedia) =>
  (media.variants ?? []).filter((v) => v.content_type === "video/mp4").sort((a, b) => (a.bit_rate ?? 0) - (b.bit_rate ?? 0));

/** The video's smallest MP4 file, which is enough to hear it. */
export function smallestMp4(media: VideoMedia): string | null {
  return mp4sSmallestFirst(media)[0]?.url ?? null;
}

/** The video's largest MP4 file, in which text on the screen can be read. */
export function largestMp4(media: VideoMedia): string | null {
  return mp4sSmallestFirst(media).at(-1)?.url ?? null;
}
