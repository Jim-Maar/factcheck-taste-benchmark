# Potential X Community Note taste benchmark — data catalogue

This human-labelled export is a **potential benchmark** for judging the taste of
existing notes, not an established evaluation protocol or published result.
It is separate from the notewriter eval in `eval/`, which tests whether to write
a note. Splits and a fixed evaluation protocol have not been defined here.

## Files and unit of evaluation

- `notes.jsonl`: one JSON object per Community Note with a human taste verdict.
- `tweets.jsonl`: tweet lookup, keyed by `id`, including captured referenced posts.
- `manifest.json`: schema version, snapshot dates and coverage counts.

Multiple notes can concern the same `tweet.id`. Split by tweet ID to avoid
putting the same post in training and evaluation. No predefined splits exist.

## Note record (`notes.jsonl`)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | X Community Note ID; primary key. |
| `text` | string | Community Note text, including citation URLs. |
| `written_at` | timestamp or null | Note creation time from X, as an ISO 8601 string; distinct from `tweet.posted_at`. |
| `generation_writer_account_id` | string | Note-submitting account's public participant ID, not a model or prompt ID. |
| `taste_verdict` | string | Human taste judgment: `fine`, `taste_failure`, `somewhat`, `unsure`. |
| `accuracy` | string or null | Human factual judgment: `correct`, `unconvincing`, `partly`, `wrong`, `unsure`; null = unjudged. |
| `needs_note` | string or null | Whether the post needs any note: `yes`, `no`, `unsure`; null = unjudged. |
| `tweet` | object | Original post, with fields below. |
| `x_ratings` | object | X community ratings, separate from the human benchmark judgments. |

Taste concerns whether a sensible reader would want this note, even if its facts
are right. These are shared team annotations, not independent annotator votes.
For binary taste scoring, use only `fine` and `taste_failure`; report excluded
`somewhat` and `unsure` counts. Do not turn missing judgments into negatives.

## Tweet object (`tweet`, or a row of `tweets.jsonl`)

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Original X post ID. |
| `text` | string or null | Captured post text; media-only posts may lack text. |
| `author_handle` | string or null | Tweet author's handle; not the note writer. |
| `posted_at` | timestamp or null | Post creation time as an ISO 8601 string. |
| `referenced_tweet_id` | string or null | Explicitly captured referenced post ID; joins to `tweets.jsonl.id`. |
| `referenced_kind` | string or null | `quoted`, `replied_to`, `retweeted`, or unknown/unrecorded. |
| `media` | array | Attached media objects; empty array means no captured attachments. |

A known `replied_to` kind can have a null reference ID: relationship was recorded,
but explicit parent ID was not. Null does **not** prove there was no reference.
Nested quotes are resolved through repeated lookup, not nested tweet objects.
Some lookup tweets came from captured earlier context without a complete edge
back to the original tweet. This export does not reconstruct entire threads.

## Media object

| Field | Type | Meaning |
|---|---|---|
| `type` | string | `image`, `video`, or `animated_gif`. |
| `url` | string or null | Image URL or highest-bitrate available MP4 URL. |
| `preview_url` | string or null | Preview image URL when supplied. |
| `transcript` | string or null | Captured/generated video speech transcript; null = not available. |

Media binaries are not included. Remote links can disappear. Transcripts are
not verified captions and are not necessarily what the original writer saw.

## X ratings (`x_ratings`)

| Field | Type | Meaning |
|---|---|---|
| `status` | string | `helpful`, `not_helpful`, or `needs_ratings` at rating snapshot time. |
| `helpful_count` | integer | Number of helpful ratings. |
| `somewhat_helpful_count` | integer | Number of somewhat-helpful ratings. |
| `not_helpful_count` | integer | Number of not-helpful ratings. |
| `helpful_reasons` | object | Public positive reason code → count. |
| `not_helpful_reasons` | object | Public negative reason code → count. |

Reason counts can overlap because raters can select several reasons. X status
is not a simple majority vote and is not the benchmark's taste verdict.
Rating dates are recorded once in `manifest.json.ratingSnapshotDates`.

## Evaluation boundaries and limitations

Provide note text, tweet and relevant captured context/media to the evaluator.
Withhold human judgments and X ratings when evaluating independent judgment.
Original generator prompts, model identities and tool traces are unknown.
Captured context may differ from what was available at generation time.
No failure-category labels, generated descriptions or per-record metadata are
included. IDs are strings; do not convert them to floating-point numbers.
This is a selected, small human-judged subset of AI-written notes, not a random
sample of all X notes. The export grants no rights to third-party post/media
content; check applicable rights and platform terms before redistribution.
