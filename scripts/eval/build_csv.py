"""Builds the notewriter eval: posts where an AI notewriter should write a
community note, and posts where it should not. Run from the repository root:

    uv run --with "psycopg[binary]" --with python-dotenv scripts/eval/build_csv.py \\
        <judge model> <judge prompt version> <output.csv> [--positives <count>]

Positive examples (label write_note): the newest posts still on X that have
an AI-written note rated helpful on X, one row per post, with the newest such
note as the reference note.

Negative examples (label no_note): the no-note group that
scripts/ai/collect_no_note.py collects. The note on each is an AI-written
note rated not helpful, which the judge calls a taste failure on a post that
needs no community note at all. These are hard cases: an AI notewriter did
write a note there.

Both sides leave out notes a labeller answered by hand, and are the same
size: as many positives as there are negatives, unless --positives says
otherwise.
"""

import csv
import importlib.util
import os
import sys
from pathlib import Path

import psycopg
from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]
COLUMNS = [
    "tweet_id", "post_url", "label", "author_name", "author_handle", "post_text",
    "referenced_kind", "referenced_text", "thread_text", "media_urls", "video_transcripts",
    "note_id", "note_text", "note_status", "note_written", "judge_reasoning", "judge_labels",
]

spec = importlib.util.spec_from_file_location("collect_no_note", REPO / "scripts/ai/collect_no_note.py")
collect_no_note = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect_no_note)

HAND_LABELLED = collect_no_note.HAND_LABELLED

POSITIVES = f"""
    select note_id from (
      select distinct on (n.tweet_id) n.tweet_id, n.note_id
        from taste.x_notes n join taste.x_posts p on p.tweet_id = n.tweet_id
       where n.status = 'helpful' and p.available and not {HAND_LABELLED}
       order by n.tweet_id, n.written desc) newest_per_post
     order by tweet_id::numeric desc
     limit %(count)s
"""

ROWS = """
    select n.tweet_id, 'https://x.com/i/status/' || n.tweet_id as post_url,
           p.author_name, p.author_handle, p.text as post_text,
           p.referenced_kind, p.referenced->>'text' as referenced_text,
           (select string_agg(coalesce(t->>'name', '') || ': ' || coalesce(t->>'text', ''), E'\\n\\n')
              from jsonb_array_elements(p.thread->'posts') t) as thread_text,
           (select string_agg(m->>'url', ' ') from jsonb_array_elements(coalesce(p.media, '[]'::jsonb) || coalesce(p.referenced->'media', '[]'::jsonb)) m) as media_urls,
           taste.post_transcripts(jsonb_build_array(p.media, p.referenced, p.thread)) as transcripts,
           n.note_id, n.note_text, n.status as note_status, n.written as note_written,
           a.reasoning as judge_reasoning, array_to_string(a.labels, '; ') as judge_labels
      from taste.x_notes n
      join taste.x_posts p on p.tweet_id = n.tweet_id
      left join taste.ai_reviews a on a.source = 'x' and a.note_id = n.note_id and a.model = %(model)s and a.prompt_version = %(version)s
     where n.note_id = any(%(ids)s::text[])
"""


def transcripts_text(transcripts) -> str:
    """The stored transcripts (taste.post_transcripts: video id to its text and
    language) as one text, one paragraph per video."""
    if not transcripts:
        return ""
    return "\n\n".join(video["text"] or "(no speech)" for video in transcripts.values())


def main() -> None:
    arguments = sys.argv[1:]
    positives_count = None
    if "--positives" in arguments:
        index = arguments.index("--positives")
        positives_count = int(arguments[index + 1])
        del arguments[index : index + 2]
    if len(arguments) != 3:
        sys.exit(__doc__)
    model, version, output = arguments
    load_dotenv(REPO / ".env")
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        params = {"model": model, "version": version, "tried": []}
        negatives = collect_no_note.group(connection, params)
        positives = [row[0] for row in connection.execute(POSITIVES, {"count": positives_count if positives_count is not None else len(negatives)}).fetchall()]
        cursor = connection.execute(ROWS, {**params, "ids": negatives + positives})
        names = [column.name for column in cursor.description]
        rows = {row["note_id"]: row for row in (dict(zip(names, values)) for values in cursor.fetchall())}
    with open(output, "w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=COLUMNS)
        writer.writeheader()
        for label, note_ids in [("write_note", positives), ("no_note", negatives)]:
            for note_id in note_ids:
                row = rows[note_id]
                writer.writerow({
                    **{column: row.get(column) for column in COLUMNS if column in row},
                    "label": label,
                    "video_transcripts": transcripts_text(row["transcripts"]),
                    "note_written": row["note_written"].isoformat() if row["note_written"] else "",
                    "judge_reasoning": row["judge_reasoning"] if label == "no_note" else "",
                    "judge_labels": row["judge_labels"] if label == "no_note" else "",
                })
    print(f"Saved {output}: {len(positives)} write_note and {len(negatives)} no_note posts")


if __name__ == "__main__":
    main()
