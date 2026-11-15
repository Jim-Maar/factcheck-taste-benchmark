"""Runs the judge on notes rated not helpful, newest first, until the eval
set's no-note group has enough notes. A note is in the group when it is a
taste failure on a post that needs no community note. Where a labeller
answered both questions with Yes or No, their answers decide. Otherwise the
judge's review with the given prompt version decides. Run from the
repository root:

    uv run --with "psycopg[binary]" --with python-dotenv scripts/ai/collect_no_note.py \\
        <model> <prompt version> <group size to reach> [--effort <level>]

The prompt version must be the one run.ts records now; the script stops if
run.ts reports another. The session login comes from the environment, as for
run.ts. Each batch is sized to what is still missing, at the share of
reviewed notes that end up in the group, and is reviewed by run.ts.
"""

import math
import os
import re
import subprocess
import sys

import psycopg
from dotenv import load_dotenv

MAX_BATCH = 8
PARALLEL_SESSIONS = 4
# The share of reviewed notes the judge puts in the group, before the run has
# measured its own: Fable put 16 of the 34 newest unhelpful notes there.
FIRST_GUESS_GROUP_SHARE = 16 / 34

HAND_DECIDED = """
    exists (select 1 from taste.verdicts v join taste.needs_note q on q.source = v.source and q.note_id = v.note_id
             where v.source = 'x' and v.note_id = n.note_id and v.verdict in ('taste_failure', 'fine') and q.answer in ('yes', 'no'))
"""
HAND_IN_GROUP = """
    exists (select 1 from taste.verdicts v join taste.needs_note q on q.source = v.source and q.note_id = v.note_id
             where v.source = 'x' and v.note_id = n.note_id and v.verdict = 'taste_failure' and q.answer = 'no')
"""
JUDGE_IN_GROUP = """
    exists (select 1 from taste.ai_reviews a
             where a.source = 'x' and a.note_id = n.note_id and a.model = %(model)s and a.prompt_version = %(version)s
               and a.recommendation = 'taste_failure' and a.needs_note = 'no')
"""
GROUP = f"""
    select n.note_id from taste.x_notes n
     where n.status = 'not_helpful' and (({HAND_DECIDED} and {HAND_IN_GROUP}) or (not {HAND_DECIDED} and {JUDGE_IN_GROUP}))
     order by n.written desc
"""
CANDIDATES = f"""
    select n.note_id from taste.x_notes n join taste.x_posts p on p.tweet_id = n.tweet_id
     where n.status = 'not_helpful' and p.available and not {HAND_DECIDED}
       and not exists (select 1 from taste.ai_reviews a where a.source = 'x' and a.note_id = n.note_id and a.model = %(model)s and a.prompt_version = %(version)s)
       and not (n.note_id = any(%(tried)s::text[]))
     order by n.written desc
     limit %(limit)s
"""


def group(connection, params) -> list[str]:
    return [row[0] for row in connection.execute(GROUP, params).fetchall()]


def review(model: str, version: str, effort: str, note_ids: list[str]) -> float:
    """Reviews the notes with run.ts and returns the cost it reports."""
    command = ["bun", "scripts/ai/run.ts", "claude", model, "--effort", effort, "--parallel", str(PARALLEL_SESSIONS), *note_ids]
    result = subprocess.run(command, capture_output=True, text=True)
    output = result.stdout + result.stderr
    print(output.strip().splitlines()[-2] if output.strip() else "(run.ts printed nothing)", flush=True)
    reported = re.search(r"prompt (\w+),", output)
    if result.returncode != 0 or not reported:
        sys.exit(f"run.ts failed:\n{output}")
    if reported.group(1) != version:
        sys.exit(f"run.ts reviews with prompt {reported.group(1)}, not {version}")
    saved = re.search(r"(\d+) of \d+ saved", output)
    if not saved or saved.group(1) == "0":
        sys.exit(f"run.ts saved no review, so the run stops:\n{output}")
    cost = re.search(r"Cost \$([\d.]+)", output)
    return float(cost.group(1)) if cost else 0.0


def main() -> None:
    effort = "high"
    arguments = sys.argv[1:]
    if "--effort" in arguments:
        index = arguments.index("--effort")
        effort = arguments[index + 1]
        del arguments[index : index + 2]
    if len(arguments) != 3:
        sys.exit(__doc__)
    model, version, target = arguments[0], arguments[1], int(arguments[2])
    load_dotenv(".env")
    tried: list[str] = []
    reviewed = joined = 0
    total_cost = 0.0
    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as connection:
        params = {"model": model, "version": version, "tried": tried}
        members = group(connection, params)
        print(f"The group has {len(members)} of {target} notes.", flush=True)
        while len(members) < target:
            share = joined / reviewed if reviewed else FIRST_GUESS_GROUP_SHARE
            batch_size = min(MAX_BATCH, max(1, math.ceil((target - len(members)) / max(share, 0.1))))
            batch = [row[0] for row in connection.execute(CANDIDATES, {**params, "tried": tried, "limit": batch_size}).fetchall()]
            if not batch:
                sys.exit("No notes rated not helpful are left to review.")
            tried.extend(batch)
            total_cost += review(model, version, effort, batch)
            before = len(members)
            members = group(connection, params)
            reviewed += len(batch)
            joined += len(members) - before
            print(f"Reviewed {reviewed} notes, {joined} joined the group, which has {len(members)} of {target}. Cost so far ${total_cost:.2f}.", flush=True)
    print(f"Done: the group has {len(members)} notes.")


if __name__ == "__main__":
    main()
