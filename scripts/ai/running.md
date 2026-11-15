# Running the AI reviewers

How to check the harnesses and run models over a set of notes. `run.ts` and `check.ts` explain their options in their header comments.

Each review runs in its own empty temp folder (`harness.ts`), with no repo, no `.env` and no user config. `run.ts` prepares the note and saves the answer. Every prompt, transcript and command is logged under `~/taste-runs/`.

## Once per machine

```bash
# ffmpeg, for the frames of videos
sudo apt install -y ffmpeg && ffmpeg -version | head -1

# A subscription token for Claude sessions (interactive; prints a token).
# Keep it out of the repo, and export it in the shell that runs the jobs.
# Without it, sessions fall back to ANTHROPIC_API_KEY, which bills the API.
claude setup-token
export CLAUDE_CODE_OAUTH_TOKEN='<paste token>'
```

Codex uses its existing login (`codex login`).

The database needs migration 18 (`prompt_version`). The judge's needs-a-note answer is stored only once the `needs_note` column exists (`019_ai_needs_note.sql`). Until then it is kept only in the logs.

## Before every run

```bash
# 1. Commit. run.ts refuses to make real reviews while the files that shape
#    the prompt (PROMPT_FILES in run.ts) have uncommitted changes, and records
#    this commit on each review as its prompt version.
git log -1 --format=%h

# 2. Harness checks: clean context, the visibility cases in checks.md, live
#    web search, and the forbidden-lookup audit. Run once per model and harness.
bun scripts/ai/check.ts claude claude-fable-5-2
bun scripts/ai/check.ts codex  gpt-6-luna

# 3. A dry run on a note with a video: everything but the database write.
bun scripts/ai/run.ts claude claude-fable-5-2 --dry-run 2097349696402428402
bun scripts/ai/run.ts codex  gpt-6-luna      --dry-run 2097349696402428402

# 4. Look at what the sessions saw and did.
ls -td ~/taste-runs/* | head -2
```

In step 4, open the newest run folders. The prompt should hold the label definitions and the video's frames, and the transcript should show web searches. The audit section that `run.ts` prints at the end should have no hits.

## The run

```bash
mkdir -p ~/taste-runs
nohup bun scripts/ai/run.ts claude claude-fable-5-2 --set shared-100 --parallel 2 > ~/taste-runs/fable.out 2>&1 &
nohup bun scripts/ai/run.ts codex  gpt-6-luna      --set shared-100 --parallel 2 > ~/taste-runs/luna.out  2>&1 &
```

Add one line per model. Sets live in `sets/`:

- `shared-100`: the 100 notes the labellers judge.
- `strat-1000`: a stratified random sample, half helpful and half not helpful.
- `label-next-60`: 60 notes from `strat-1000` for the next labelling round.

With `--set`, a run skips the notes the model has already reviewed with the current prompt, so the same command resumes a run that stopped. Each session has a timeout (`--timeout`, 15 minutes). A failed note is retried with backoff (`--retries`). After repeated quota errors, the run stops starting new notes: run the same command again later. A replaced review is kept in `sets/superseded.jsonl`.

Afterwards, check the audit section at the end of each `.out` file and rerun any flagged notes. Then compare the models on one prompt version:

```bash
bun scripts/ai/compare.ts --prompt <version> --set shared-100 --prevalence
```
