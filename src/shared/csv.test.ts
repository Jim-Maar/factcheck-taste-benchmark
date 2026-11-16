import { describe, expect, test } from "bun:test";
import { parseCsv } from "./csv";

describe("parseCsv", () => {
  test("reads quoted fields with commas, line breaks and doubled quotes", () => {
    const text = 'id,text\r\n1,"a, b"\n2,"two\nlines and ""quotes"""\n';
    expect(parseCsv(text)).toEqual([
      { id: "1", text: "a, b" },
      { id: "2", text: 'two\nlines and "quotes"' },
    ]);
  });

  test("keeps a last row without a line break and drops rows of the wrong length", () => {
    expect(parseCsv("a,b\n1\n2,3")).toEqual([{ a: "2", b: "3" }]);
  });
});
