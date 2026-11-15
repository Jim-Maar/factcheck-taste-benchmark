import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* The two databases the import talks to. The target is this project's taste
 * schema, written with its service key from the worktree's .env, which Bun
 * loads by itself. The source is cn-return-bot's production database, read
 * through its web API with the service key from cn-return-bot's env file. Its
 * values stay out of process.env, because both files use the same names. */

const UPSERT_CHUNK_SIZE = 500;
const SOURCE_PAGE_SIZE = 1000;
const SOURCE_IN_CHUNK_SIZE = 150;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing from .env`);
  return value;
}

/** Reads a KEY=VALUE env file into an object, without touching process.env. */
async function readEnvFile(path: string): Promise<Record<string, string>> {
  const text = await Bun.file(path).text();
  const entries = text
    .split("\n")
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map(([, key, value]) => [key!, value!.replace(/^["']|["']$/g, "")]);
  return Object.fromEntries(entries);
}

export const target = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_KEY"), {
  db: { schema: "taste" },
  auth: { persistSession: false },
});

export async function sourceClient(): Promise<SupabaseClient> {
  const env = await readEnvFile(requireEnv("CN_SOURCE_ENV"));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error("The cn-return-bot env file lacks SUPABASE_URL or SUPABASE_SERVICE_KEY");
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

/** Writes rows into a taste table in chunks. A row whose key exists is
 *  updated with the given columns only, so columns left out keep their value.
 *  With `ignoreDuplicates` an existing row is left alone. A new row takes the
 *  column's default for a column it leaves out, even when other rows of the
 *  same chunk have that column. */
export async function upsertRows(table: string, rows: object[], onConflict: string, ignoreDuplicates = false): Promise<void> {
  for (let start = 0; start < rows.length; start += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + UPSERT_CHUNK_SIZE);
    const { error } = await target.from(table).upsert(chunk, { onConflict, ignoreDuplicates, defaultToNull: false });
    if (error) throw new Error(`Writing ${table} failed: ${error.message}`);
  }
}

/** Every row of a table, read in pages ordered by `keyColumn`. Each page
 *  starts after the last key of the one before, so no page skips or repeats
 *  a row (keyset paging, as in cn-return-bot's src/everything-core/paging.ts).
 *  `notNull` names a column whose empty rows are left out. */
export async function fetchAllRows<T extends Record<string, unknown>>(client: SupabaseClient, table: string, columns: string, keyColumn: string, notNull?: string): Promise<T[]> {
  const rows: T[] = [];
  let lastKey: unknown = null;
  for (;;) {
    let query = client.from(table).select(columns).order(keyColumn).limit(SOURCE_PAGE_SIZE);
    if (notNull) query = query.not(notNull, "is", null);
    if (lastKey !== null) query = query.gt(keyColumn, lastKey);
    const { data, error } = await query;
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    const page = data as unknown as T[];
    rows.push(...page);
    if (page.length < SOURCE_PAGE_SIZE) return rows;
    lastKey = page.at(-1)![keyColumn];
  }
}

/** The rows of a table whose `column` is one of `values`, read in chunks
 *  small enough for a web address, from cn-return-bot's database or this one. */
export async function fetchRowsIn<T>(client: SupabaseClient | typeof target, table: string, columns: string, column: string, values: string[]): Promise<T[]> {
  const rows: T[] = [];
  for (let start = 0; start < values.length; start += SOURCE_IN_CHUNK_SIZE) {
    const { data, error } = await client.from(table).select(columns).in(column, values.slice(start, start + SOURCE_IN_CHUNK_SIZE));
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    rows.push(...(data as unknown as T[]));
  }
  return rows;
}
