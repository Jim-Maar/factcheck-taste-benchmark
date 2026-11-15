"""How a notewriter did on the notewriter eval: a confusion matrix of its
decisions against the labels, with accuracy, and the share of posts it got
right on each side. Run from the repository root:

    uv run --with matplotlib scripts/eval/report.py <eval.csv> <results.jsonl> <output.png> [<title>]

Only results for posts in the CSV count, one per post (the first).
"""

import csv
import json
import sys

import matplotlib.pyplot as plt
import numpy as np

LABELS = ["no_note", "write_note"]
TICKS = ["No note", "Write a note"]


def load(csv_path: str, results_path: str) -> list[tuple[str, str]]:
    """(label, decision) for every post of the eval the notewriter answered."""
    labels = {row["tweet_id"]: row["label"] for row in csv.DictReader(open(csv_path, newline=""))}
    decisions: dict[str, str] = {}
    for line in open(results_path):
        result = json.loads(line)
        if result["tweet_id"] in labels:
            decisions.setdefault(result["tweet_id"], result["decision"])
    return [(labels[tweet_id], decision) for tweet_id, decision in decisions.items()]


def main() -> None:
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    csv_path, results_path, output = sys.argv[1:4]
    title = sys.argv[4] if len(sys.argv) == 5 else "Write a community note?"
    pairs = load(csv_path, results_path)
    matrix = np.zeros((2, 2), dtype=int)
    for label, decision in pairs:
        matrix[LABELS.index(label), LABELS.index(decision)] += 1
    correct = int(np.trace(matrix))
    figure, axis = plt.subplots(figsize=(5.5, 5.5))
    axis.imshow(matrix, cmap="Blues", vmin=0)
    for row in range(2):
        for column in range(2):
            count = matrix[row, column]
            axis.text(column, row, str(count), ha="center", va="center", color="white" if count > matrix.max() / 2 else "black", fontsize=14)
    axis.set_xticks([0, 1], TICKS)
    axis.set_yticks([0, 1], TICKS)
    axis.set_xlabel("Notewriter")
    axis.set_ylabel("Eval label")
    no_note_right, no_note_total = matrix[0, 0], matrix[0].sum()
    write_right, write_total = matrix[1, 1], matrix[1].sum()
    axis.set_title(
        f"{title}\naccuracy {correct}/{len(pairs)} = {correct / len(pairs):.0%}\n"
        f"held back on {no_note_right}/{no_note_total} no-note posts, wrote on {write_right}/{write_total} posts needing a note"
    , fontsize=10)
    figure.tight_layout()
    figure.savefig(output, dpi=150)
    print(f"Saved {output}: {len(pairs)} posts, {correct} right")


if __name__ == "__main__":
    main()
