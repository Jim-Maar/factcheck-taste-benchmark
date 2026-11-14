/* Reading X's public data files. Each is a zip that holds one tab-separated
 * file with a header line. The fields hold no quotes and no line breaks, so a
 * line is a row and a tab separates fields. `unzip -p` streams the file, so a
 * ratings file of several gigabytes never sits in memory. */

/** Every line of the file inside a zip, header first. */
export async function* zipLines(zipPath: string): AsyncGenerator<string> {
  const unzip = Bun.spawn(["unzip", "-p", zipPath], { stdout: "pipe", stderr: "pipe" });
  const decoder = new TextDecoder();
  let rest = "";
  let finished = false;
  try {
    for await (const chunk of unzip.stdout) {
      const text = rest + decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");
      rest = lines.pop()!;
      yield* lines;
    }
    rest += decoder.decode();
    if (rest.length > 0) yield rest;
    const exitCode = await unzip.exited;
    if (exitCode !== 0) throw new Error(`unzip ${zipPath} failed: ${await new Response(unzip.stderr).text()}`);
    finished = true;
  } finally {
    // A reader that stops early, such as zipHeader, leaves unzip running.
    if (!finished) unzip.kill();
  }
}

/** A copy of a string that shares no memory with the text it was cut from.
 *  Bun's engine often makes a cut-out string, such as a field of a line,
 *  point into the whole chunk of the file it came from. One kept note id then
 *  keeps a whole chunk alive. Over a file of gigabytes that grew the X import
 *  past 4 GB, and the out-of-memory killer ended it. So everything the import
 *  keeps goes through this copy. */
export const detached = (text: string): string => Buffer.from(text, "utf8").toString("utf8");

/** How much memory the process holds, for the progress lines. */
export const residentMemory = (): string => `${Math.round(process.memoryUsage().rss / 1_000_000)} MB`;

/** The first field of a line, which is the note id in every file. Reading
 *  only this lets a pass skip the rows it does not need without splitting
 *  them. */
export const firstField = (line: string) => line.slice(0, line.indexOf("\t"));

/** A row's fields by column name. */
export type Row = (column: string) => string;

/** The data rows of a file, each readable by column name. `keep` sees the raw
 *  line first, so a pass can drop rows before they are split. */
export async function* zipRows(zipPath: string, keep: (line: string) => boolean = () => true): AsyncGenerator<Row> {
  let index: Map<string, number> | null = null;
  for await (const line of zipLines(zipPath)) {
    if (line.length === 0) continue;
    if (index === null) {
      index = new Map(line.split("\t").map((column, i) => [column, i]));
      continue;
    }
    if (!keep(line)) continue;
    const fields = line.split("\t");
    const columns = index;
    yield (column) => {
      const i = columns.get(column);
      if (i === undefined) throw new Error(`${zipPath} has no column ${column}`);
      return fields[i] ?? "";
    };
  }
}

/** The column names of a file. */
export async function zipHeader(zipPath: string): Promise<string[]> {
  for await (const line of zipLines(zipPath)) return line.split("\t");
  return [];
}
