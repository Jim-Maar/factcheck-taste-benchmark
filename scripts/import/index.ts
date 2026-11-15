import { importCommonNotes } from "./commonNotes";
import { importXNotes } from "./xNotes";
import { importXPosts } from "./xPosts";
import { importTranscripts } from "./transcripts";
import { importXThreads } from "./xThreads";

/* The import. Run from the repository root, so Bun loads .env:
 *
 *   bun scripts/import/index.ts commonnotes
 *   bun scripts/import/index.ts x <dump folder> <dump date YYYY-MM-DD>
 *   bun scripts/import/index.ts posts
 *   bun scripts/import/index.ts threads
 *   bun scripts/import/index.ts all <dump folder> <dump date YYYY-MM-DD>
 *   bun scripts/import/index.ts transcripts <count>
 *
 * Every part can run again at any time. It updates the copied notes and never
 * touches verdicts or labels. `transcripts` transcribes the videos under the
 * newest <count> helpful and <count> not helpful notes. It costs money, so
 * `all` leaves it out. */

const USAGE = "Usage: bun scripts/import/index.ts commonnotes | x <dump folder> <YYYY-MM-DD> | posts | threads | all <dump folder> <YYYY-MM-DD> | transcripts <count>";

function dumpArgs(args: string[]): [string, string] {
  const [dumpDir, dumpDate] = args;
  if (!dumpDir || !dumpDate || !/^\d{4}-\d{2}-\d{2}$/.test(dumpDate)) throw new Error(USAGE);
  return [dumpDir, dumpDate];
}

async function timed(label: string, run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  await run();
  console.log(`[${label}] done in ${Math.round((Date.now() - started) / 1000)}s`);
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "commonnotes":
    await timed("commonnotes", importCommonNotes);
    break;
  case "x":
    await timed("x", () => importXNotes(...dumpArgs(args)));
    break;
  case "posts":
    await timed("posts", importXPosts);
    break;
  case "threads":
    await timed("threads", importXThreads);
    break;
  case "all":
    await timed("commonnotes", importCommonNotes);
    await timed("x", () => importXNotes(...dumpArgs(args)));
    await timed("posts", importXPosts);
    await timed("threads", importXThreads);
    break;
  case "transcripts": {
    const perStatus = Number(args[0]);
    if (!Number.isInteger(perStatus) || perStatus <= 0) throw new Error(USAGE);
    await timed("transcripts", () => importTranscripts(perStatus));
    break;
  }
  default:
    throw new Error(USAGE);
}
