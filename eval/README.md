# Notewriter eval

`notewriter-eval.csv` holds 200 posts on X. For each, an AI notewriter has to decide whether to write a community note. 100 posts need a note (label `write_note`) and 100 don't (label `no_note`). The `no_note` posts are hard: on each one an AI notewriter did write a note, and the note was rated not helpful.

## How the posts were chosen

- **`write_note`**: the 100 newest posts still on X that have an AI-written note rated helpful on X. Newest means the highest post id, since X's post ids grow with time. One row per post, with its newest such note as the reference note.
- **`no_note`**: posts with an AI-written note rated not helpful, newest first, that the AI judge, Claude Fable 5.2 at high effort (prompt 403e204), calls a taste failure on a post that needs no community note at all. A taste failure is a note a sensible reader of the post would not want there, even if every fact in it is right. Posts with any note rated helpful, in our data or among the other notes X lists for them, are left out, since such a post did need a note. The 100 newest posts that pass are kept.
- Notes our labellers answered by hand are left out on both sides.

Against the labellers, on 26 hand-labelled notes rated not helpful, Fable got this question right 22 times (85%). Of the 16 notes it put in the no-note group, 13 belonged there. So roughly 1 in 5 `no_note` labels may be wrong. Reading the examples where a notewriter writes a note anyway shows a few posts that arguably do need one. The labellers can check these notes on the site under the review set `no-note-100`.

## Columns

| Column | What it holds |
| --- | --- |
| `tweet_id`, `post_url` | The post. |
| `label` | `write_note` or `no_note`: what a good notewriter does. |
| `author_name`, `author_handle`, `post_text` | The post as stored when it was imported. |
| `referenced_kind`, `referenced_text` | The post it quotes or replies to, if any. |
| `thread_text` | The thread above the post, as stored. |
| `media_urls` | The images and video preview images of the post and the post it quotes. |
| `video_transcripts` | What is said in its videos (Whisper on Groq), one paragraph per video. Whisper writes things like "you you you" or "Thanks for watching!" for videos without speech. |
| `note_id`, `note_text`, `note_status`, `note_written` | The reference note: helpful for `write_note`, not helpful for `no_note`. A notewriter under test must not see it. |
| `judge_reasoning`, `judge_labels` | For `no_note` posts, why the judge called the note a taste failure, and the labels it gave. |

## Scoring

Score each post by whether the notewriter's decision matches `label`. Report the share right on each side as well as overall, since a notewriter that always writes a note gets 50%.

## Results

| Notewriter | Accuracy | Right on `no_note` | Right on `write_note` | Cost |
| --- | --- | --- | --- | --- |
| Claude Fable 5.2, medium effort | 141/200 (70%) | 74/100 | 67/100 | $81 |
| Claude Opus 5.5, medium effort | 129/200 (64%) | 67/100 | 62/100 | $33 |
| Claude Sonnet 5.5, medium effort | 116/200 (58%) | 59/100 | 57/100 | $8 |
| Claude Haiku 5.5, medium effort | 103/200 (52%) | 37/100 | 66/100 | $5 |
| Claude Sonnet 5.5, low effort | 113/200 (56%) | 69/100 | 44/100 | $5 |
| Claude Sonnet 5.5, high effort | 117/200 (58%) | 49/100 | 68/100 | $17 |
| Claude Sonnet 5.5, xhigh effort | 116/200 (58%) | 44/100 | 72/100 | $40 |

Fable 5.2 is also the judge that picked the `no_note` posts, at high effort, so its score on that side partly measures agreement with itself.

More effort makes Sonnet write more notes (75 at low effort, 128 at xhigh), but its accuracy hardly changes. One xhigh session got an X "trending" summary page back from a web search, on a post that needs no note, where it rightly wrote none.

`results/` has every decision of each model, with the note it wrote and its reasoning, and a plot of each. The site's Notewriter eval tab (https://jim-maar.github.io/factcheck-taste-benchmark/?tab=eval) shows every post with each model's answer, and picks up a new results file once it is on main. Each post got a fresh Claude Code session with web search, in an empty folder, with X and Community Notes sites blocked. It saw the post as a reader meets it: the thread above it, its quotes, its images and frames from its videos, and the transcripts. It never saw a note. The prompt, the runner and the script that builds this CSV are in `scripts/eval/` on the eval-set branch (pull request #1).
