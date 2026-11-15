import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { videoId } from "../../src/core/xVideo";

/* More of a video than its preview image: frames from it, saved as images an
 * AI reviewer can open. `review.ts show` prints this command under each
 * video. ffmpeg reads the frames straight from X's file, so nothing is stored
 * and nothing here touches the database. Needs ffmpeg and ffprobe on the
 * path. Run from the repository root:
 *
 *   bun scripts/ai/frames.ts <video address>          frames at even steps across the whole video
 *   bun scripts/ai/frames.ts <video address> <time>   frames close together around one moment, as 1:42
 *
 * The reviewer chooses nothing else. The video's length sets how many frames
 * there are, and a closer look covers the stretch one frame of the whole
 * video stands for, so the two together leave no gap. */

const USAGE = "Usage: bun scripts/ai/frames.ts <video address> [time in the video, as 1:42]";
/** Only X's own video files, so the tool can't be pointed at anything else. */
const VIDEO_HOST = "https://video.twimg.com/";
/** Across the whole video there is a frame for every 5 seconds, within these bounds. */
const SECONDS_PER_FRAME = 5;
const MIN_FRAMES = 4;
const MAX_FRAMES = 12;
/** Frames closer together than this show the same thing. */
const CLOSEST_FRAMES_SECONDS = 0.5;
/** The longer side of a saved frame: enough to read text on the screen. */
const MAX_FRAME_SIDE = 1280;
/** A frame of a 1080p video takes ffmpeg about 75 MB on one thread, and twice
 *  that on its usual threads. Two at once keep a session near 150 MB, for the
 *  VPS, where several sessions run side by side. */
const PARALLEL_FRAMES = 2;
/** The frames are read within the minutes of one review, and each video
 *  leaves about 1 MB, so those of earlier reviews are deleted. */
const KEEP_FRAMES_MS = 60 * 60 * 1000;
const FRAMES_DIR = join(tmpdir(), "x-video-frames");
/** ffmpeg says this when X no longer serves the file, for example because the post is deleted. */
const GONE_FILE_PATTERN = /HTTP error 40[34]|40[34] (Forbidden|Not Found)/;

async function run(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  if ((await proc.exited) === 0) return out;
  if (GONE_FILE_PATTERN.test(err)) throw new Error("X no longer serves this video.");
  throw new Error(`${command[0]} failed: ${err.trim()}`);
}

/** Deletes the frames of videos that no run has touched for an hour. */
async function deleteOldFrames() {
  for (const name of await readdir(FRAMES_DIR)) {
    const dir = join(FRAMES_DIR, name);
    // Another session may delete the same folder at the same moment.
    const modified = await stat(dir).then((s) => s.mtimeMs, () => null);
    if (modified !== null && Date.now() - modified > KEEP_FRAMES_MS) await rm(dir, { recursive: true, force: true });
  }
}

/** A time as the reviewer reads and writes it: 1:42, or 1:42.5 between seconds. */
function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${Number.isInteger(rest) ? String(rest).padStart(2, "0") : rest.toFixed(1).padStart(4, "0")}`;
}

/** The seconds of a time written as 1:42, 1:42.5 or 102, or null when it isn't one. */
function secondsOf(time: string): number | null {
  const match = time.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return match ? Number(match[1] ?? 0) * 60 + Number(match[2]) : null;
}

/** `count` times at even steps between two times, each in the middle of its step. */
const spread = (from: number, to: number, count: number) => Array.from({ length: count }, (_, i) => from + ((to - from) * (i + 0.5)) / count);

async function frames(url: string, at: number | null) {
  const duration = Number(await run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url]));
  if (!(duration > 0)) throw new Error("Couldn't read the video's length.");
  if (at !== null && at >= duration) throw new Error(`The video is only ${clock(Math.floor(duration))} long.`);

  // Never more than a frame a second, so a short video isn't shown twice over.
  const across = Math.max(1, Math.min(Math.floor(duration), MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(duration / SECONDS_PER_FRAME))));
  const step = duration / across;
  const from = at === null ? 0 : Math.max(0, at - step / 2);
  const to = at === null ? duration : Math.min(duration, at + step / 2);
  // Whole seconds across the video, so a time read from the list can be typed back; tenths in a closer look.
  const times =
    at === null
      ? spread(0, duration, across).map(Math.floor)
      : spread(from, to, Math.max(1, Math.min(MAX_FRAMES, Math.floor((to - from) / CLOSEST_FRAMES_SECONDS)))).map((time) => Math.round(time * 10) / 10);

  const dir = join(FRAMES_DIR, videoId({ type: "video", variants: [{ url, content_type: "video/mp4" }] }) ?? Bun.hash(url).toString(16));
  await mkdir(dir, { recursive: true });
  await deleteOldFrames();
  const scale = `scale='if(gt(iw,ih),min(${MAX_FRAME_SIDE},iw),-2)':'if(gt(iw,ih),-2,min(${MAX_FRAME_SIDE},ih))'`;
  const saved: { time: number; path: string }[] = [];
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < times.length; i = next++) {
      const time = times[i]!;
      const path = join(dir, `${clock(time).replace(":", "m")}s.jpg`);
      await run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-threads", "1", "-ss", String(time), "-i", url, "-frames:v", "1", "-vf", scale, "-q:v", "4", path]);
      // ffmpeg saves nothing, without failing, for a time past the video's last picture.
      if (await Bun.file(path).exists()) saved.push({ time, path });
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_FRAMES }, worker));
  if (!saved.length) throw new Error("The video has no picture there.");
  saved.sort((a, b) => a.time - b.time);

  const length = clock(Math.floor(duration));
  const where = at === null ? `across a ${length} video` : `from ${clock(Math.floor(from))} to ${clock(Math.ceil(to))} of a ${length} video`;
  console.log(`${saved.length} frames ${where}, each with its time in the video:`);
  for (const { time, path } of saved) console.log(`  ${clock(time)}  ${path}`);
  if (at === null && step > CLOSEST_FRAMES_SECONDS) {
    console.log(`\nTo look closer at one moment, add its time: bun scripts/ai/frames.ts ${url} ${clock(saved[Math.floor(saved.length / 2)]!.time)}`);
  }
}

const [url, time, ...rest] = process.argv.slice(2);
const at = time === undefined ? null : secondsOf(time);
if (!url?.startsWith(VIDEO_HOST) || rest.length || (time !== undefined && at === null)) throw new Error(USAGE);
if (!Bun.which("ffmpeg") || !Bun.which("ffprobe")) {
  throw new Error("ffmpeg isn't installed on this machine, so the video's frames can't be saved. Judge the video from its preview image, and say in the reasoning that you saw only that.");
}
await frames(url, at);
