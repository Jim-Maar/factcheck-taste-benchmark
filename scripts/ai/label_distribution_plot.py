"""Which labels the labellers gave to the notes they called taste failures
(Yes or Somewhat), as a bar chart: one bar per label, plus one for the taste
failures without any label. A note can have several labels, so the bars add
up to more than the number of notes. Run from the repository root:

    uv run --with matplotlib --with "psycopg[binary]" --with python-dotenv \
        scripts/ai/label_distribution_plot.py <output.png> [<note ids file>]

The optional file lists note ids, one per line. Then only those notes count.
"""

import os
import sys

import matplotlib.pyplot as plt
import numpy as np
import psycopg
from dotenv import load_dotenv

NO_LABEL = "(no label)"


def load(note_ids: list[str] | None) -> tuple[int, list[tuple[str, int]]]:
    """The number of hand-labelled taste failures, and for every label (also
    unused ones) on how many of them it was given."""
    load_dotenv()
    taste_failures = """
        select note_id from taste.verdicts
         where source = 'x' and verdict in ('taste_failure', 'somewhat')
           and (%(ids)s::text[] is null or note_id = any(%(ids)s::text[]))
    """
    counts = f"""
        with tf as ({taste_failures})
        select l.name, count(tf.note_id)
          from taste.labels l
          left join taste.note_labels nl on nl.label_id = l.id and nl.source = 'x'
          left join tf on tf.note_id = nl.note_id
         group by l.name
        union all
        select '{NO_LABEL}', count(*) from tf
         where not exists (select 1 from taste.note_labels nl where nl.source = 'x' and nl.note_id = tf.note_id)
    """
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        total = connection.execute(f"select count(*) from ({taste_failures}) t", {"ids": note_ids}).fetchone()[0]
        rows = connection.execute(counts, {"ids": note_ids}).fetchall()
    return total, rows


def main() -> None:
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    output = sys.argv[1]
    note_ids = open(sys.argv[2]).read().split() if len(sys.argv) == 3 else None
    total, rows = load(note_ids)
    if not total:
        sys.exit("No hand-labelled taste failures")
    labels = sorted((row for row in rows if row[0] != NO_LABEL), key=lambda row: (-row[1], row[0]))
    rows = labels + [row for row in rows if row[0] == NO_LABEL]
    names = [name for name, _ in rows]
    counts = [count for _, count in rows]
    positions = np.arange(len(rows))
    figure, axis = plt.subplots(figsize=(9, 0.45 * len(rows) + 1.6))
    axis.barh(positions, counts, color=["C0"] * len(labels) + ["C7"])
    for y, count in zip(positions, counts):
        axis.text(count + 0.1, y, f"{count} ({count / total:.0%})", va="center", fontsize=9)
    axis.set_yticks(positions, names)
    axis.invert_yaxis()
    axis.set_xlim(0, max(counts) * 1.25 + 0.5)
    axis.xaxis.get_major_locator().set_params(integer=True)
    axis.set_xlabel("Taste failures with this label")
    axis.set_title(f"Labels on the {total} notes the labellers called taste failures\n(a note can have several labels; percentages are of the {total} notes)")
    figure.tight_layout()
    figure.savefig(output, dpi=150)
    print(f"Saved {output}: {total} taste failures")


if __name__ == "__main__":
    main()
