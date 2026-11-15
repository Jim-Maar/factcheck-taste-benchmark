import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { videoId } from "../../src/core/xVideo";
import { clock, extractFrames, hasFfmpeg, VideoGone } from "./frames";
import type { PostSource } from "./thread";

/* A post's media, saved into a session's folder before the session starts,
 * so the reviewer opens local files and needs neither the network nor any
 * tool of this repository to see them. Photos and videos' preview images are
 * downloaded; each video also gets frames across it (frames.ts). Used by
 * run.ts and check.ts. */

/** How long one download may take. */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** A failure to save a post's media that may pass, so the session is tried
 *  again later rather than run with less than another session saw. */
export class MediaUnavailable extends Error {}

const token = (n: number) => `<<media:${n}>>`;
const TOKEN_PATTERN = /<<media:(\d+)>>/g;

/** Wraps a source so its media are saved under workDir. Render the post with
 *  `source`, then pass the lines to `finish`, which downloads the images and
 *  puts their local paths into the lines. Images go into `folder`. */
export function localMedia(base: PostSource, workDir: string, folder = "images"): { source: PostSource; finish(lines: string[]): Promise<string[]> } {
  const urls: string[] = [];
  const source: PostSource = {
    ...base,
    mediaLocation(url) {
      if (!url.startsWith("https://")) return url;
      let n = urls.indexOf(url);
      if (n === -1) n = urls.push(url) - 1;
      return token(n);
    },
    async videoFrames(file) {
      if (!hasFfmpeg()) return ["That is its preview image. ffmpeg isn't installed on this machine, so no other frames of the video could be saved: judge it from the preview image, and say in the reasoning that you saw only that."];
      const dir = join(workDir, "frames", videoId({ type: "video", variants: [{ url: file, content_type: "video/mp4" }] }) ?? Bun.hash(file).toString(16));
      try {
        const frames = await extractFrames(file, null, dir);
        return [
          `That is its preview image. ${frames.saved.length} frames across the ${clock(Math.floor(frames.duration))} video, each with its time in it:`,
          ...frames.saved.map(({ time, path }) => `  ${clock(time)}  ./${relative(workDir, path)}`),
        ];
      } catch (error) {
        if (error instanceof VideoGone) return ["That is its preview image. X no longer serves the video's file, so no other frames of it could be saved."];
        throw new MediaUnavailable(`Saving frames of ${file} failed: ${(error as Error).message}`);
      }
    },
  };

  async function finish(lines: string[]): Promise<string[]> {
    const local: string[] = [];
    if (urls.length) await mkdir(join(workDir, folder), { recursive: true });
    for (const [n, url] of urls.entries()) {
      const extension = url.match(/\.(jpe?g|png|gif|webp)(?:\?|$)/i)?.[1]?.toLowerCase() ?? "jpg";
      const path = `${folder}/${n + 1}.${extension}`;
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      } catch (error) {
        throw new MediaUnavailable(`Downloading ${url} failed: ${(error as Error).message}`);
      }
      if (response.status === 404 || response.status === 403 || response.status === 410) {
        local.push("(X no longer serves this image)");
        continue;
      }
      if (!response.ok) throw new MediaUnavailable(`Downloading ${url} failed: HTTP ${response.status}`);
      await Bun.write(join(workDir, path), await response.arrayBuffer());
      local.push(`./${path}`);
    }
    return lines.map((line) => line.replace(TOKEN_PATTERN, (_, n) => local[Number(n)]!));
  }

  return { source, finish };
}
