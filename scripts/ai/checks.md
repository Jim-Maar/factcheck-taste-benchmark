# Checks for an AI reviewer

Before an AI reviewer reviews notes on a new model or harness, these checks show whether it can see what a reader of a post sees: text in an image, a video's preview, the thread a post replies to, and quotes inside quotes. Give a fresh session of the reviewer this file as its instructions, the same way it would get `reviewer.md`.

## Instructions for the reviewer

You are checking that you can read every part of a post. Each case is a post, the posts around it, and one question about them.

1. Run `bun scripts/ai/checks.ts list` for the cases.
2. For each case, run `bun scripts/ai/checks.ts show <case>`. You may open the post's images.
3. Answer the question in one short sentence, from what you saw. If you couldn't see what the question asks about, say so rather than guessing.
4. Write your answers as JSON, `{ "<case>": "<answer>", ... }`, to a file and run `bun scripts/ai/checks.ts grade < <file>`. Report what it prints.

Don't open the posts on X, and don't read `scripts/ai/checks/cases.json` or the files under `scripts/ai/checks/` except through `show`: they hold the expected answers.
