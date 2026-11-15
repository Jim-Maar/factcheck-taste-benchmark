# Checks for an AI reviewer

Before an AI reviewer reviews notes on a new model or harness, these checks show whether it can do what a reviewer needs, in the same clean, isolated session `run.ts` gives it (`harness.ts`):

- **See the post**: text in an image, a video's preview, the thread a post replies to, and quotes inside quotes (the cases under `scripts/ai/checks/`).
- **Search the web**: find a news article from the last few days, which no model knows from training. The check passes only when the transcript shows web search calls, the article is at most a week old and its URL answers. For Codex this tests live search (`web_search="live"`); cached search would fail it.
- **Start clean**: say everything it was given besides the prompt. It must name none of the user's instructions, memory, hooks, plugins or MCP servers, and nothing of this repository (its path, `.env`, the database).
- **Look nothing up it mustn't**: its tool calls, shell commands and searches are searched for X, X's embed endpoint, Community Notes sites and the repository.

Run them, with no database access needed:

    bun scripts/ai/check.ts <codex|claude> <model> [--effort <level>]

It prints PASS or FAIL per check and what the session answered, and keeps the prompt and the full transcript under `~/taste-runs/`. Read the clean-context answer yourself too: the pattern only catches known leaks.

## Instructions for the reviewer, by hand

To check a harness `check.ts` doesn't drive, give a fresh session this section as its instructions.

You are checking that you can read every part of a post. Each case is a post, the posts around it, and one question about them.

1. Run `bun scripts/ai/checks.ts list` for the cases.
2. For each case, run `bun scripts/ai/checks.ts show <case>`. You may open the post's images.
3. Answer the question in one short sentence, from what you saw. If you couldn't see what the question asks about, say so rather than guessing.
4. Search the web for one news article published in the last three days, and give its title, URL and date.
5. Write your answers to the cases as JSON, `{ "<case>": "<answer>", ... }`, to a file and run `bun scripts/ai/checks.ts grade < <file>`. Report what it prints, and the article.

Don't open the posts on X, and don't read `scripts/ai/checks/cases.json` or the files under `scripts/ai/checks/` except through `show`: they hold the expected answers.
