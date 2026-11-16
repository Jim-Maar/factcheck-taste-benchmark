/** A CSV file as rows of named fields, after RFC 4180: a quoted field may hold
 *  commas, line breaks and doubled quotes. The first row names the fields. A
 *  row with a different number of fields than the first is dropped. */
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") endField();
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRecord();
    } else field += char;
  }
  if (field || record.length) endRecord();
  const [header, ...rows] = records;
  if (!header) return [];
  return rows.filter((row) => row.length === header.length).map((row) => Object.fromEntries(header.map((name, i) => [name, row[i]!])));
}
