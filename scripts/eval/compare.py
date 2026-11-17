"""Compares the notewriters in a results folder of the notewriter eval. It makes
two plots:

- <out_dir>/models-medium.png: one bar per model run at medium effort, best
  first, in three panels. The panels show the accuracy on all posts, on the
  posts that need a note, and on the posts that need none.
- <out_dir>/<model>-efforts.png: for one model, the same three accuracies as
  lines over its effort levels.

Run from the repository root:

    uv run --with matplotlib scripts/eval/compare.py <eval.csv> <results dir> <out dir> [<model for the effort plot>]

The model for the effort plot defaults to claude-sonnet-5-5. Each results file
holds one run, named by the model and effort in its lines. Only the first
answer per post counts. A run that has not answered every post stops the
script, since its accuracy would not be comparable.
"""

import csv
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import matplotlib.pyplot as plt

EFFORTS = ["low", "medium", "high", "xhigh", "max"]
DEFAULT_EFFORT_MODEL = "claude-sonnet-5-5"
BAR_EFFORT = "medium"
# Wilson score interval at 95%.
Z = 1.96
# Colors of the reference palette: categorical slots 1 to 3, and ink and grid
# on its light chart surface.
SERIES = ["#2a78d6", "#eb6834", "#1baf7a"]
SURFACE = "#fcfcfb"
INK = "#1f1f1e"
MUTED = "#6b6a63"
GRID = "#e4e3de"


@dataclass
class Score:
    right: int
    of: int

    @property
    def share(self) -> float:
        return self.right / self.of

    def interval(self) -> tuple[float, float]:
        """How far the 95% Wilson interval reaches below and above the share."""
        p, n = self.share, self.of
        centre = (p + Z * Z / (2 * n)) / (1 + Z * Z / n)
        half = Z * ((p * (1 - p) / n + Z * Z / (4 * n * n)) ** 0.5) / (1 + Z * Z / n)
        return p - (centre - half), (centre + half) - p


@dataclass
class Run:
    model: str
    effort: str
    overall: Score
    needs_note: Score
    needs_no_note: Score


# The three accuracies, as (attribute of Run, title).
MEASURES = [
    ("overall", "All posts"),
    ("needs_note", "Posts that need a note"),
    ("needs_no_note", "Posts that need no note"),
]


def model_name(model: str) -> str:
    """claude-opus-5-5 reads Opus 5.5, gpt-6.1-terra reads GPT-6.1 Terra, as on the site."""
    claude = re.fullmatch(r"claude-([a-z]+)-(\d+)-(\d+)", model)
    if claude:
        return f"{claude[1].capitalize()} {claude[2]}.{claude[3]}"
    return re.sub(r"-([a-z])", lambda m: f" {m[1].upper()}", re.sub(r"^gpt-", "GPT-", model))


def load_run(path: Path, labels: dict[str, str]) -> Run:
    answers: dict[str, dict] = {}
    for line in path.read_text().splitlines():
        if line.strip():
            answer = json.loads(line)
            answers.setdefault(answer["tweet_id"], answer)
    missing = labels.keys() - answers.keys()
    if missing:
        sys.exit(f"{path} has no answer for {len(missing)} of the {len(labels)} posts.")
    first = next(iter(answers.values()))

    def score(label: str | None) -> Score:
        posts = [tweet_id for tweet_id, post_label in labels.items() if label in (None, post_label)]
        return Score(sum(answers[tweet_id]["decision"] == labels[tweet_id] for tweet_id in posts), len(posts))

    return Run(first["model"], first["effort"], score(None), score("write_note"), score("no_note"))


def style(axis: plt.Axes) -> None:
    axis.set_facecolor(SURFACE)
    axis.set_ylim(0, 1)
    axis.yaxis.set_major_formatter(lambda value, _: f"{value:.0%}")
    axis.grid(axis="y", color=GRID, linewidth=0.8)
    axis.set_axisbelow(True)
    for side in ("top", "right", "left"):
        axis.spines[side].set_visible(False)
    axis.spines["bottom"].set_color(MUTED)
    axis.tick_params(colors=MUTED, length=0)
    axis.axhline(0.5, color=MUTED, linewidth=1, linestyle=(0, (4, 3)))


def plot_models(runs: list[Run], output: Path) -> None:
    """One panel per accuracy, one bar per model, best first."""
    figure, axes = plt.subplots(1, len(MEASURES), figsize=(4.2 * len(MEASURES), 5.2), facecolor=SURFACE)
    for axis, (measure, title) in zip(axes, MEASURES):
        ranked = sorted(runs, key=lambda run: getattr(run, measure).share, reverse=True)
        scores = [getattr(run, measure) for run in ranked]
        positions = range(len(ranked))
        errors = list(zip(*(score.interval() for score in scores)))
        axis.bar(positions, [score.share for score in scores], width=0.7, color=SERIES[0], yerr=errors, ecolor=MUTED, capsize=3, error_kw={"linewidth": 1})
        for position, score, (_, above) in zip(positions, scores, zip(*errors)):
            axis.text(position, score.share + above + 0.025, f"{score.share:.0%}", ha="center", fontsize=9, color=INK)
        axis.set_xticks(list(positions), [model_name(run.model) for run in ranked], rotation=35, ha="right", fontsize=9, color=INK)
        style(axis)
        axis.set_title(f"{title} ({scores[0].of})", fontsize=11, color=INK)
    figure.suptitle("Notewriter eval at medium effort: share of posts where the model decided right", fontsize=12, color=INK)
    figure.text(0.5, 0.01, "Whiskers: 95% interval. Dashed line: 50%, what deciding by coin flip gets.", ha="center", fontsize=8, color=MUTED)
    figure.tight_layout(rect=(0, 0.03, 1, 1))
    figure.savefig(output, dpi=150)
    print(f"Saved {output}: {len(runs)} models")


def plot_efforts(runs: list[Run], model: str, output: Path) -> None:
    """The three accuracies of one model as lines over its effort levels."""
    runs = sorted(runs, key=lambda run: EFFORTS.index(run.effort))
    figure, axis = plt.subplots(figsize=(7, 5), facecolor=SURFACE)
    positions = range(len(runs))
    for color, (measure, title) in zip(SERIES, MEASURES):
        scores = [getattr(run, measure) for run in runs]
        axis.plot(positions, [score.share for score in scores], color=color, linewidth=2, marker="o", markersize=7, markeredgecolor=SURFACE, markeredgewidth=2, label=title)
    axis.set_xticks(list(positions), [run.effort for run in runs], color=INK)
    axis.set_xlabel("Effort", color=MUTED)
    style(axis)
    axis.legend(loc="lower left", frameon=False, fontsize=9, labelcolor=INK)
    axis.set_title(f"{model_name(model)} as notewriter: share of posts decided right, by effort", fontsize=11, color=INK)
    figure.tight_layout()
    figure.savefig(output, dpi=150)
    print(f"Saved {output}: {', '.join(run.effort for run in runs)}")


def main() -> None:
    if len(sys.argv) not in (4, 5):
        sys.exit(__doc__)
    csv_path, results_dir, out_dir = sys.argv[1:4]
    effort_model = sys.argv[4] if len(sys.argv) == 5 else DEFAULT_EFFORT_MODEL
    labels = {row["tweet_id"]: row["label"] for row in csv.DictReader(open(csv_path, newline=""))}
    runs = [load_run(path, labels) for path in sorted(Path(results_dir).glob("*.jsonl"))]
    plot_models([run for run in runs if run.effort == BAR_EFFORT], Path(out_dir) / "models-medium.png")
    plot_efforts([run for run in runs if run.model == effort_model], effort_model, Path(out_dir) / f"{effort_model}-efforts.png")


if __name__ == "__main__":
    main()
