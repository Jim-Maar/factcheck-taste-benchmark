import { SQL } from "bun";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { buildBenchmark, type SourceRecord, type Transcript } from "./schema";

/** Run from repo root: bun scripts/export/benchmark.ts. Bun loads DATABASE_URL from .env. */
async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env");
  const db = new SQL(process.env.DATABASE_URL, { max: 1, connectionTimeout: 20 });
  let snapshot: { records: SourceRecord[]; transcripts: Transcript[]; at: string };
  try {
    snapshot = await db.begin(async tx => {
      await tx.unsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      await tx.unsafe("SET LOCAL statement_timeout = 60000");
      const times = await tx.unsafe<{ at: string }[]>("SELECT transaction_timestamp()::text AS at");
      const at = times[0]?.at;
      const rows = await tx.unsafe<{ record: SourceRecord }[]>(`
        SELECT jsonb_build_object(
          'note', to_jsonb(n), 'post', to_jsonb(p), 'verdict', v.verdict,
          'accuracy', a.accuracy, 'needs_note', q.answer
        ) AS record
        FROM taste.verdicts v
        JOIN taste.x_notes n ON n.note_id = v.note_id
        LEFT JOIN taste.x_posts p ON p.tweet_id = n.tweet_id
        LEFT JOIN taste.accuracy a ON a.source = v.source AND a.note_id = v.note_id
        LEFT JOIN taste.needs_note q ON q.source = v.source AND q.note_id = v.note_id
        WHERE v.source = 'x' ORDER BY v.note_id
      `);
      const transcripts = await tx.unsafe<Transcript[]>("SELECT video_id, transcript FROM taste.x_video_transcripts");
      if (!at) throw new Error("Missing snapshot timestamp");
      return { records: rows.map(r => r.record), transcripts, at };
    });
  } finally {
    await db.close();
  }
  const data = buildBenchmark(snapshot.records, snapshot.transcripts);
  const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  const files = {
    "notes.jsonl": jsonl(data.notes),
    "tweets.jsonl": jsonl(data.tweets),
    "manifest.json": JSON.stringify({ schema_version: "0.4", created_at: new Date().toISOString(), source_snapshot: snapshot.at, ...data.stats }, null, 2) + "\n",
  };
  const folder = join(import.meta.dir, "../../benchmark");
  await mkdir(folder, { recursive: true });
  // Prepare all files before publishing; manifest is replaced last.
  try {
    for (const [name, text] of Object.entries(files)) await Bun.write(join(folder, name + ".tmp"), text);
    for (const name of Object.keys(files)) await rename(join(folder, name + ".tmp"), join(folder, name));
  } finally {
    for (const name of Object.keys(files)) await rm(join(folder, name + ".tmp"), { force: true });
  }
  console.log(JSON.stringify(data.stats, null, 2));
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    // Connection errors may contain connection details; never print raw DB errors.
    const code = (error as { code?: string }).code;
    console.error(`Benchmark export failed${code ? ` (${code})` : ""}. Check DATABASE_URL, database access and schema.`);
    process.exitCode = 1;
  });
}
