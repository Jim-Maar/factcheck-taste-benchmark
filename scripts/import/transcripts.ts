import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smallestMp4, videoId } from "../../src/core/xVideo";
import { fetchRowsIn, target } from "./db";

/* Transcripts of the videos in X posts, for the newest notes of each rating.
 * For every video in a note's post, or in the post it quotes, ffmpeg pulls
 * the sound out of the video's smallest file, and Whisper on Groq writes down
 * what is said. cn-return-bot transcribes the videos of posts the same way.
 * Videos that already have a transcript are skipped, so the script can stop
 * and run again. Needs GROQ_API_KEY in .env and ffmpeg on the path. */

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-large-v3";
/** Groq bills by the hour of audio, so a long stream is cut here. */
const MAX_AUDIO_SECONDS = 30 * 60;
/** Speech needs no more than this. It keeps a 30 minute file near 7 MB,
 *  well under Groq's upload limit. */
const AUDIO_SAMPLE_RATE = "16000";
const AUDIO_BITRATE = "32k";
const PARALLEL_VIDEOS = 4;
const RATED_STATUSES = ["helpful", "not_helpful"] as const;
const DEFAULT_RETRY_SECONDS = 10;
/** ffmpeg says this when X no longer serves the file, for example because the post is deleted. */
const GONE_FILE_PATTERN = /HTTP error 40[34]|40[34] (Forbidden|Not Found)/;
/** ffmpeg says this when the video has no sound at all. */
const NO_SOUND_PATTERN = /does not contain any stream|Output file is empty|matches no streams/;

interface Video {
  id: string;
  url: string;
}

interface PostMedia {
  media: Parameters<typeof videoId>[0][] | null;
  referenced: { media?: Parameters<typeof videoId>[0][] } | null;
}

type AudioResult = "ok" | "gone" | "no_sound";

async function latestPostIds(perStatus: number): Promise<string[]> {
  const ids = new Set<string>();
  for (const status of RATED_STATUSES) {
    const { data, error } = await target.from("x_notes").select("tweet_id").eq("status", status).order("written", { ascending: false }).limit(perStatus);
    if (error) throw error;
    for (const row of data) ids.add(row.tweet_id as string);
  }
  return [...ids];
}

/** The videos of these posts and of the posts they quote, each once. */
async function videosOf(tweetIds: string[]): Promise<Video[]> {
  const posts = await fetchRowsIn<PostMedia>(target, "x_posts", "media, referenced", "tweet_id", tweetIds);
  const videos = new Map<string, Video>();
  for (const post of posts) {
    for (const media of [...(post.media ?? []), ...(post.referenced?.media ?? [])]) {
      const id = videoId(media);
      const url = smallestMp4(media);
      if (id && url) videos.set(id, { id, url });
    }
  }
  return [...videos.values()];
}

async function transcribedIds(videoIds: string[]): Promise<Set<string>> {
  const rows = await fetchRowsIn<{ video_id: string }>(target, "x_video_transcripts", "video_id", "video_id", videoIds);
  return new Set(rows.map((row) => row.video_id));
}

async function extractAudio(url: string, audioPath: string): Promise<AudioResult> {
  const ffmpeg = Bun.spawn(
    ["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", url, "-t", String(MAX_AUDIO_SECONDS), "-vn", "-ac", "1", "-ar", AUDIO_SAMPLE_RATE, "-b:a", AUDIO_BITRATE, audioPath],
    { stdout: "ignore", stderr: "pipe" },
  );
  const stderr = await new Response(ffmpeg.stderr).text();
  if ((await ffmpeg.exited) === 0) return "ok";
  if (GONE_FILE_PATTERN.test(stderr)) return "gone";
  if (NO_SOUND_PATTERN.test(stderr)) return "no_sound";
  throw new Error(`ffmpeg failed on ${url}: ${stderr.trim()}`);
}

async function transcribe(audioPath: string): Promise<{ text: string; language: string | null; duration: number | null }> {
  for (;;) {
    const form = new FormData();
    form.append("file", Bun.file(audioPath));
    form.append("model", WHISPER_MODEL);
    form.append("response_format", "verbose_json");
    const response = await fetch(GROQ_TRANSCRIPTION_URL, { method: "POST", headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` }, body: form });
    if (response.status === 429) {
      const waitSeconds = Number(response.headers.get("retry-after")) || DEFAULT_RETRY_SECONDS;
      console.log(`[transcripts] Groq's rate limit, waiting ${waitSeconds}s`);
      await Bun.sleep(waitSeconds * 1000);
      continue;
    }
    if (!response.ok) throw new Error(`Groq answered ${response.status}: ${await response.text()}`);
    const result = (await response.json()) as { text: string; language?: string; duration?: number };
    return { text: result.text.trim(), language: result.language ?? null, duration: result.duration ?? null };
  }
}

async function saveTranscript(id: string, transcript: { text: string; language: string | null; duration: number | null }): Promise<void> {
  const { error } = await target.from("x_video_transcripts").upsert({
    video_id: id,
    transcript: transcript.text,
    language: transcript.language,
    duration_seconds: transcript.duration,
    model: WHISPER_MODEL,
  });
  if (error) throw error;
}

/** Transcribes one video. Says false when X no longer has its file. */
async function transcribeVideo(video: Video): Promise<boolean> {
  const audioPath = join(tmpdir(), `x-video-${video.id}.mp3`);
  try {
    const audio = await extractAudio(video.url, audioPath);
    if (audio === "gone") return false;
    const transcript = audio === "no_sound" ? { text: "", language: null, duration: null } : await transcribe(audioPath);
    await saveTranscript(video.id, transcript);
    return true;
  } finally {
    await rm(audioPath, { force: true });
  }
}

export async function importTranscripts(perStatus: number): Promise<void> {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing from .env");
  const tweetIds = await latestPostIds(perStatus);
  const videos = await videosOf(tweetIds);
  const done = await transcribedIds(videos.map((video) => video.id));
  const queue = videos.filter((video) => !done.has(video.id));
  console.log(`[transcripts] ${tweetIds.length} posts, ${videos.length} videos, ${queue.length} still to transcribe`);
  let finished = 0;
  let gone = 0;
  const worker = async () => {
    for (let video = queue.shift(); video; video = queue.shift()) {
      if (!(await transcribeVideo(video))) gone++;
      finished++;
      console.log(`[transcripts] ${finished} done, ${gone} of them no longer on X`);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_VIDEOS }, worker));
}
