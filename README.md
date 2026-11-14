# factcheck-taste-benchmark

A website for exploring AI-written fact-check notes and marking taste failures. It has two tabs: Community Notes on X written by AI notewriters (rated helpful or rated not helpful), and all notes from commonnotes.net. The interface is built from the commonnotes.net code in the cn-return-bot repository.

Site: https://jim-maar.github.io/factcheck-taste-benchmark/ (shared password). Every push to `main` deploys it.

## How the pieces fit

| Folder | What it is |
| --- | --- |
| `src/core`, `src/ui`, `src/features` | The layers copied from commonnotes.net, imported as `@cn/core`, `@cn/ui` and `@cn/features`: data access, the design system, and the note pieces. |
| `src/web` | The site: the two tabs, their cards and their filter fields. |
| `supabase/migrations` | The `taste` schema, which lives in the Supabase project `epistemics-playground`. Apply a new file with `psql "$DATABASE_URL" -1 -f <file>`. |
| `scripts/import` | The import of the notes. |
| `scripts/ai` | The tool a Claude agent uses to read an X note and save its AI review (`latest`, `show`, `save`). The cards show a saved review at once. |

The env file is `~/dev/env/factcheck-taste-benchmark/env`, linked as `.env` into each checkout.

## Build and run the site

You need [Bun](https://bun.sh). The site reads the database through two public variables, `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (copy `.env.example` to `.env` and fill it in, or link the shared env file above).

```bash
bun install
bun run dev      # dev server at http://localhost:5173/
bun run build    # production build into dist/
bun run check    # typecheck, lint and tests
```

For a build served under a sub-path, as on GitHub Pages, set `BASE_PATH`: `BASE_PATH=/factcheck-taste-benchmark/ bun run build`. The deploy workflow (`.github/workflows/pages.yml`) does this on every push to `main`, taking the two variables from the repository's Actions variables.

Building the data behind the site (the notes in the database) is a separate step: see the import below.

## The import

It copies the notes into the database and never touches verdicts or labels, so it can run again at any time. Run it from the repository root, under a memory cap, because the VPS has little memory to spare:

```bash
cap() { systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 "$@"; }
cap bun scripts/import/index.ts commonnotes                 # about 20 seconds
cap bun scripts/import/index.ts x <dump folder> <YYYY-MM-DD> # about 15 minutes, peaks near 500 MB
cap bun scripts/import/index.ts posts                       # about 20 minutes for 24,000 posts
```

- `commonnotes` copies every commonnotes.net note with its claim, post, creator and sources from cn-return-bot's production database.
- `x` reads X's public Community Notes data from a folder of its zip files (notes, noteStatusHistory and ratings, from `https://ton.twimg.com/birdwatch-public-data/<YYYY/MM/DD>/...`). It keeps the notes of the AI notewriters listed in cn-return-bot's `datasets/big_eval/ai_author_ids.txt` that are rated helpful or not helpful, with their ratings, the raters' reasons and the other notes on the same post.
- `posts` fills in the text of each post. It first copies the posts cn-return-bot already stored, then asks X's free embed endpoint (the address embedded posts load from, no key) for the rest. A post X no longer has is marked unavailable.
