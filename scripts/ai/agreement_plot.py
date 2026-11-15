"""How often a judge model gives the same answers as the labellers, as the
standard figures of a classification paper: a confusion matrix for "Taste
failure, and no note needed?" (the eval set's question), one for "Taste
failure?", one for "Needs a community note?", and precision and recall for
each label with 95% Wilson intervals. Only notes a labeller answered count.
Notes the labellers called Somewhat a taste failure are left out. Both the
labellers and the judge may answer Unsure. The scores count the
judge's Unsure as right, and say how often the judge used it.
Run from the repository root:

    uv run --with matplotlib --with "psycopg[binary]" --with python-dotenv \
        scripts/ai/agreement_plot.py <model> <prompt version> <output.png> [<note ids file>]

The optional file lists note ids, one per line. Then only those notes count.

The prompt version is the commit run.ts records on each review, so reviews
made with an older prompt stay out.
"""

import math
import os
import sys
from collections import Counter

import matplotlib.pyplot as plt
import numpy as np
import psycopg
from dotenv import load_dotenv

Z_95 = 1.96
ANSWERS = ["No", "Yes", "Unsure"]
# A Somewhat verdict is left out of the evaluation: the judge is scored only
# against clear answers.
HAND_VERDICT_ANSWER = {"taste_failure": "Yes", "fine": "No", "unsure": "Unsure"}
JUDGE_RECOMMENDATION_ANSWER = {"taste_failure": "Yes", "fine": "No", "unsure": "Unsure"}
NEEDS_NOTE_ANSWER = {"yes": "Yes", "no": "No", "unsure": "Unsure"}


def wilson_interval(hits: int, total: int) -> tuple[float, float]:
    """The 95% Wilson score interval for a proportion."""
    if total == 0:
        return (0.0, 0.0)
    share = hits / total
    denominator = 1 + Z_95**2 / total
    centre = (share + Z_95**2 / (2 * total)) / denominator
    half_width = Z_95 * math.sqrt(share * (1 - share) / total + Z_95**2 / (4 * total**2)) / denominator
    return (max(0.0, centre - half_width), min(1.0, centre + half_width))


def cohens_kappa(pairs: list[tuple[bool, bool]]) -> float:
    """Agreement between two raters beyond what chance would give."""
    total = len(pairs)
    observed = sum(a == b for a, b in pairs) / total
    first_yes = sum(a for a, _ in pairs) / total
    second_yes = sum(b for _, b in pairs) / total
    expected = first_yes * second_yes + (1 - first_yes) * (1 - second_yes)
    return 0.0 if expected == 1 else (observed - expected) / (1 - expected)


def load(model: str, prompt_version: str, note_ids: list[str] | None) -> list[dict]:
    """One row per note a labeller answered and the model reviewed."""
    load_dotenv()
    query = """
        with hand as (
          select note_id from taste.verdicts where source = 'x'
          union select note_id from taste.needs_note where source = 'x'
          union select note_id from taste.note_labels where source = 'x')
        select h.note_id, v.verdict, q.answer as needs_note,
               coalesce((select array_agg(l.name) from taste.note_labels nl join taste.labels l on l.id = nl.label_id
                          where nl.source = 'x' and nl.note_id = h.note_id), '{}') as labels,
               a.recommendation, a.needs_note as ai_needs_note, a.labels as ai_labels
          from hand h
          join taste.ai_reviews a on a.source = 'x' and a.note_id = h.note_id and a.model = %s and a.prompt_version = %s
          left join taste.verdicts v on v.source = 'x' and v.note_id = h.note_id
          left join taste.needs_note q on q.source = 'x' and q.note_id = h.note_id
         where %s::text[] is null or h.note_id = any(%s::text[])
    """
    with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
        cursor = connection.execute(query, (model, prompt_version, note_ids, note_ids))
        columns = [column.name for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def eval_set_answer(taste_failure: str, needs_note: str) -> str:
    """Whether a note belongs in the eval set's no-note group: a taste failure
    on a post that needs no community note. Unsure when either answer is."""
    if "Unsure" in (taste_failure, needs_note):
        return "Unsure"
    return "Yes" if taste_failure == "Yes" and needs_note == "No" else "No"


def confusion_panel(axis, pairs: list[tuple[str, str]], title: str) -> None:
    """A confusion matrix: rows are the labellers' No and Yes, columns the
    judge's. Notes the labellers were unsure of are left out. The judge's
    Unsure gets a column only when the judge used it; then the title counts
    it as right, and gives the agreement on the notes the judge decided."""
    scored = [(human, judge) for human, judge in pairs if human != "Unsure"]
    judge_unsure = sum(judge == "Unsure" for _, judge in pairs)
    rows = ANSWERS[:2]
    columns = ANSWERS if judge_unsure else rows
    matrix = np.zeros((len(rows), len(columns)), dtype=int)
    for human, judge in scored:
        matrix[rows.index(human), columns.index(judge)] += 1
    axis.imshow(matrix, cmap="Blues", vmin=0)
    for row in range(len(rows)):
        for column in range(len(columns)):
            count = matrix[row, column]
            axis.text(column, row, str(count), ha="center", va="center", color="white" if count > matrix.max() / 2 else "black", fontsize=14)
    axis.set_xticks(range(len(columns)), columns)
    axis.set_yticks(range(len(rows)), rows)
    axis.set_xlabel("Judge")
    axis.set_ylabel("Labellers")
    if not scored:
        axis.set_title(f"{title}\nno note has both answers yet")
        return
    decided = [(human == "Yes", judge == "Yes") for human, judge in scored if judge != "Unsure"]
    agreed = sum(a == b for a, b in decided)
    decided_text = f"{agreed}/{len(decided)} = {agreed / len(decided):.0%}, κ = {cohens_kappa(decided):.2f}" if decided else "none"
    both_yes = sum(a and b for a, b in decided)
    hand_yes, judge_yes = sum(a for a, _ in decided), sum(b for _, b in decided)
    recall_precision = f"recall {both_yes}/{hand_yes}, precision {both_yes}/{judge_yes}"
    if not judge_unsure:
        axis.set_title(f"{title}\naccuracy {decided_text}\n{recall_precision}")
        return
    unsure_counted_right = sum(judge in (human, "Unsure") for human, judge in scored)
    axis.set_title(
        f"{title}\nUnsure counted right: {unsure_counted_right}/{len(scored)} = {unsure_counted_right / len(scored):.0%}\n"
        f"judge decided: {decided_text}\njudge Unsure on {judge_unsure} of {len(pairs)} notes ({judge_unsure / len(pairs):.0%})"
    )


def label_panel(axis, rows: list[dict]) -> None:
    """Precision and recall per label, with 95% Wilson intervals and k/n."""
    human_counts = Counter(name for row in rows for name in row["labels"])
    judge_counts = Counter(name for row in rows for name in row["ai_labels"])
    both_counts = Counter(name for row in rows for name in set(row["labels"]) & set(row["ai_labels"]))
    names = sorted(set(human_counts) | set(judge_counts), key=lambda name: (-human_counts[name], name))
    bar_height = 0.38
    positions = np.arange(len(names))
    for offset, metric, denominators in [(-bar_height / 2, "Recall", human_counts), (bar_height / 2, "Precision", judge_counts)]:
        shares, lower, upper, texts = [], [], [], []
        for name in names:
            hits, total = both_counts[name], denominators[name]
            low, high = wilson_interval(hits, total)
            share = hits / total if total else 0.0
            shares.append(share)
            lower.append(share - low)
            upper.append(high - share)
            texts.append(f"{hits}/{total}")
        axis.barh(positions + offset, shares, height=bar_height, xerr=[lower, upper], capsize=3, label=metric)
        for y, share, high, text in zip(positions + offset, shares, upper, texts):
            axis.text(min(share + high, 1.0) + 0.02, y, text, va="center", fontsize=8)
    axis.set_yticks(positions, names)
    axis.invert_yaxis()
    axis.set_xlim(0, 1.25)
    axis.set_xticks([0, 0.25, 0.5, 0.75, 1.0])
    axis.set_xlabel("Share (95% Wilson interval)")
    axis.set_title("Labels: recall = judge also gave it / labellers gave it\nprecision = labellers also gave it / judge gave it")
    axis.legend(loc="lower right")


def main() -> None:
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    model, prompt_version, output = sys.argv[1:4]
    note_ids = open(sys.argv[4]).read().split() if len(sys.argv) == 5 else None
    rows = load(model, prompt_version, note_ids)
    if not rows:
        sys.exit(f"No reviews by {model} with prompt {prompt_version} on hand-labelled notes")
    taste_pairs = [
        (HAND_VERDICT_ANSWER[row["verdict"]], JUDGE_RECOMMENDATION_ANSWER[row["recommendation"]])
        for row in rows
        if row["verdict"] in HAND_VERDICT_ANSWER
    ]
    needs_note_pairs = [
        (NEEDS_NOTE_ANSWER[row["needs_note"]], NEEDS_NOTE_ANSWER[row["ai_needs_note"]])
        for row in rows
        if row["needs_note"] in NEEDS_NOTE_ANSWER and row["ai_needs_note"] in NEEDS_NOTE_ANSWER
    ]
    eval_set_pairs = [
        (eval_set_answer(HAND_VERDICT_ANSWER[row["verdict"]], NEEDS_NOTE_ANSWER[row["needs_note"]]),
         eval_set_answer(JUDGE_RECOMMENDATION_ANSWER[row["recommendation"]], NEEDS_NOTE_ANSWER[row["ai_needs_note"]]))
        for row in rows
        if row["verdict"] in HAND_VERDICT_ANSWER and row["needs_note"] in NEEDS_NOTE_ANSWER and row["ai_needs_note"] in NEEDS_NOTE_ANSWER
    ]
    figure, axes = plt.subplots(1, 4, figsize=(24, 6.3), gridspec_kw={"width_ratios": [1, 1, 1, 1.6]})
    confusion_panel(axes[0], eval_set_pairs, "Taste failure, and no note needed?")
    confusion_panel(axes[1], taste_pairs, "Taste failure?")
    confusion_panel(axes[2], needs_note_pairs, "Needs a community note?")
    label_panel(axes[3], rows)
    figure.suptitle(f"{model} (prompt {prompt_version}) vs. labellers on {len(rows)} hand-labelled X notes")
    figure.tight_layout()
    figure.savefig(output, dpi=150)
    print(f"Saved {output}: {len(taste_pairs)} verdicts, {len(needs_note_pairs)} needs-a-note answers")


if __name__ == "__main__":
    main()
