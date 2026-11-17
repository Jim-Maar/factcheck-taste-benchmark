import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

/* One harness session with a clean context: the prompt and nothing else.
 * Used by run.ts (reviews) and check.ts (the checks of checks.md).
 *
 * Each session gets a new empty folder outside the repository, holding only
 * what the caller puts there (the post's images and frames), and writes its
 * answer as a file there. The process gets no variables from this
 * repository's .env (no database key): only PATH, the harness's own
 * credentials, and a HOME that is an empty folder.
 *
 * Claude Code runs with an empty config folder of its own (CLAUDE_CONFIG_DIR:
 * no user CLAUDE.md, settings, memory, hooks, plugins or login), in safe mode
 * (no CLAUDE.md, skills, plugins, hooks or MCP servers), with no setting
 * sources, hooks off, its built-in plugins off, no MCP servers, no slash
 * commands, and only Read, Write, WebSearch and WebFetch: the files tools
 * allowed in the folder only, WebFetch refused for X and Community Notes
 * sites. Its config folder holds no login, so it signs in with
 * CLAUDE_CODE_OAUTH_TOKEN (a subscription token from `claude setup-token`)
 * or, failing that, ANTHROPIC_API_KEY (billed to the API). Only one is
 * passed, so it is clear which account pays.
 *
 * Codex runs without the user's config.toml or rules, without AGENTS.md or
 * skills, ephemeral, in the folder, with live web search, and with a
 * permission profile under which its shell sees only the system's minimal
 * paths and the folder (not the repository, not HOME), writes only the
 * folder and has no network: the session needs none, since search runs on
 * OpenAI's side and the media are already saved. It uses the user's
 * CODEX_HOME for its login only: a copy would rotate the login's refresh
 * token and log out the user's own Codex. Codex's own built-in multi-agent
 * tools stay; a sub-agent would run in the same sandbox. auditActions()
 * looks for forbidden lookups afterwards, since web search can't be
 * filtered by site.
 *
 * The prompt, the full transcript and stderr of each session are kept under
 * the run's log folder, outside the repository. */

export const HARNESSES = ["codex", "claude"] as const;
export type Harness = (typeof HARNESSES)[number];

/** Effort is pinned, so a run doesn't change with the user's settings. Both harnesses accept these. */
export const EFFORTS = ["low", "medium", "high", "xhigh"] as const;
export const DEFAULT_EFFORT = "medium";

/** Sites a Claude session may not fetch: the post itself, X's embed
 *  endpoint (which names the note shown on it) and Community Notes sites. */
const BLOCKED_DOMAINS = [
  "x.com", "twitter.com", "mobile.twitter.com", "mobile.x.com", "t.co", "cdn.syndication.twimg.com", "syndication.twitter.com",
  "publish.twitter.com", "platform.twitter.com", "api.twitter.com", "api.x.com", "nitter.net", "xcancel.com", "nitter.poast.org",
  "fxtwitter.com", "vxtwitter.com", "fixupx.com", "twstalker.com", "communitynotes.x.com", "birdwatch.twitter.com",
];

/** Claude Code's built-in plugins, which load even from an empty config folder. */
const BUILTIN_PLUGINS = ["cc-plugin-agents-md@builtin", "cc-plugin-telemetry@builtin", "cc-plugin-privacy@builtin", "cc-plugin-plugin-authoring@builtin"];

export interface Usage {
  /** The session's last message, to say why an answer is missing. */
  lastMessage: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** USD per million tokens. */
export type Prices = Record<string, { input?: number | null; cached_input?: number | null; output?: number | null }>;

/** The harness said the account is out of quota or rate-limited. */
export class QuotaError extends Error {}
/** The session ran longer than it may. */
export class TimeoutError extends Error {}

const QUOTA_PATTERN = /usage limit|rate.?limit|quota|\b429\b|too many requests|overloaded|credit balance|insufficient_quota|exceeded your/i;

export interface Session {
  /** The session's empty working folder, for the caller to put media in. */
  workDir: string;
  /** Deletes the session's folders. */
  remove(): Promise<void>;
}

/** A new empty folder for one session, outside the repository: the
 *  session's working folder, an empty HOME, a config folder and a TMPDIR. */
export async function newSession(): Promise<Session> {
  const root = await mkdtemp(join(tmpdir(), "taste-session-"));
  const workDir = join(root, "work");
  await Promise.all(["work", "home", "config", "tmp"].map((dir) => mkdir(join(root, dir))));
  return { workDir, remove: () => rm(root, { recursive: true, force: true }) };
}

export interface RunOptions {
  harness: Harness;
  model: string;
  effort: string;
  prompt: string;
  session: Session;
  /** Where the prompt, transcript and stderr go: `<logBase>.prompt.md` and so on. */
  logBase: string;
  timeoutMs: number;
  prices: Prices;
}

/* The native installer puts a small launcher on the PATH, which looks for the
 * real program under $HOME/.local/share/claude/versions. A session's HOME is
 * an empty folder, so the launcher finds nothing there and exits with 1. So
 * sessions start the newest installed version directly. Without the native
 * install, the claude on the PATH is the program itself. */
const CLAUDE_VERSIONS_DIR = join(homedir(), ".local/share/claude/versions");

function claudeBinary(): string {
  if (!existsSync(CLAUDE_VERSIONS_DIR)) return "claude";
  const newest = readdirSync(CLAUDE_VERSIONS_DIR).sort(Bun.semver.order).at(-1);
  if (!newest) throw new Error(`${CLAUDE_VERSIONS_DIR} holds no Claude Code version.`);
  return join(CLAUDE_VERSIONS_DIR, newest);
}

function claudeCommand(o: RunOptions): string[] {
  return [
    claudeBinary(), "-p",
    // --bare would be simpler, but it leaves the session only the Read tool (2.1.325).
    "--safe-mode", "--setting-sources", "",
    "--model", o.model,
    "--effort", o.effort,
    "--output-format", "stream-json", "--verbose",
    "--no-session-persistence",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
    "--settings", JSON.stringify({ disableAllHooks: true, enabledPlugins: Object.fromEntries(BUILTIN_PLUGINS.map((name) => [name, false])) }),
    "--disable-slash-commands",
    "--tools", "Read,Write,WebSearch,WebFetch",
    // acceptEdits, not dontAsk: dontAsk refuses Write even when an allow rule
    // covers the file. acceptEdits allows writes in the session folder, and in
    // print mode any request outside the rules (such as a read outside the
    // folder) is refused, since no one is there to approve it.
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read(./**)", "Write(./**)", "WebSearch", "WebFetch",
    "--disallowedTools", ...BLOCKED_DOMAINS.map((domain) => `WebFetch(domain:${domain})`),
  ];
}

function codexCommand(o: RunOptions): string[] {
  return [
    "codex", "exec",
    "--ignore-user-config", "--ignore-rules", "--ephemeral", "--skip-git-repo-check",
    "-C", o.session.workDir,
    "-m", o.model,
    "-c", `model_reasoning_effort="${o.effort}"`,
    "-c", 'web_search="live"',
    // A permission profile: the shell reads only the system's minimal paths and the folder, writes only the folder, and has no network.
    "-c", 'default_permissions="review"',
    // Codex runs its shell through its own binary, so the sandbox must be able to read Codex's install folder.
    "-c", `permissions.review.filesystem={":minimal"="read", ${JSON.stringify(codexInstallDir())}="read", ":project_roots"={"."="write"}}`,
    "-c", "permissions.review.network.enabled=false",
    "-c", 'approval_policy="never"',
    "-c", "skills.bundled.enabled=false",
    "-c", "skills.include_instructions=false",
    "-c", 'shell_environment_policy.inherit="core"',
    "-c", "project_doc_max_bytes=0",
    ...["hooks", "plugins", "apps", "memories", "browser_use", "in_app_browser", "computer_use", "image_generation", "multi_agent", "goals"].flatMap((f) => ["--disable", f]),
    "--json", "-",
  ];
}

/** The folder Codex is installed in (its npm package), which holds only its binaries. */
function codexInstallDir(): string {
  const bin = Bun.which("codex");
  if (!bin) throw new Error("codex isn't on the PATH.");
  return dirname(dirname(realpathSync(bin)));
}

/** The variables a session's process gets: none of this repository's .env. */
function sessionEnv(o: RunOptions): Record<string, string> {
  const root = join(o.session.workDir, "..");
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(root, "home"), LANG: process.env.LANG ?? "C.UTF-8", TMPDIR: join(root, "tmp") };
  if (o.harness === "claude") {
    const login = process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }
      : process.env.ANTHROPIC_API_KEY
        ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
        : null;
    if (!login) throw new Error("Set CLAUDE_CODE_OAUTH_TOKEN (run `claude setup-token`) or ANTHROPIC_API_KEY: Claude sessions run with an empty config folder, which holds no login.");
    Object.assign(env, login, { CLAUDE_CONFIG_DIR: join(root, "config"), DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" });
  } else {
    env.CODEX_HOME = process.env.CODEX_HOME ?? join(homedir(), ".codex");
  }
  return env;
}

/** Runs one session and returns what it used. Throws QuotaError, TimeoutError
 *  or Error when the session fails. */
export async function runSession(o: RunOptions): Promise<Usage> {
  const command = o.harness === "claude" ? claudeCommand(o) : codexCommand(o);
  await mkdir(join(o.logBase, ".."), { recursive: true });
  await Bun.write(`${o.logBase}.prompt.md`, o.prompt);
  await Bun.write(`${o.logBase}.command.txt`, command.map((arg) => (/^[\w./:=,-]+$/.test(arg) ? arg : `'${arg}'`)).join(" "));
  const proc = Bun.spawn(command, { cwd: o.session.workDir, env: sessionEnv(o), stdin: new Blob([o.prompt]), stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, o.timeoutMs);
  // Read as it comes, so a stopped session keeps what it wrote, and a child still holding the pipes can't keep the run waiting.
  const chunks = { out: [] as string[], err: [] as string[] };
  const drain = async (stream: ReadableStream<Uint8Array>, into: string[]) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) into.push(decoder.decode(chunk, { stream: true }));
  };
  const drained = Promise.all([drain(proc.stdout, chunks.out), drain(proc.stderr, chunks.err)]).catch(() => {});
  const code = await proc.exited;
  clearTimeout(timer);
  await Promise.race([drained, Bun.sleep(10_000)]);
  const [out, err] = [chunks.out.join(""), chunks.err.join("")];
  await Bun.write(`${o.logBase}.transcript.jsonl`, out);
  await Bun.write(`${o.logBase}.stderr.txt`, err);
  if (timedOut) throw new TimeoutError(`the session ran over ${Math.round(o.timeoutMs / 60000)} minutes and was stopped`);

  const events = out.split("\n").filter((line) => line.startsWith("{")).map((line) => {
    try {
      return JSON.parse(line) as Record<string, any>;
    } catch {
      return {};
    }
  });
  const { usage, errorText } = o.harness === "claude" ? claudeUsage(events) : codexUsage(events, o.model, o.prices);
  if (code !== 0 || errorText) {
    const why = (errorText || err.trim().split("\n").slice(-3).join(" ") || out.trim().split("\n").at(-1) || "").slice(0, 500);
    if (QUOTA_PATTERN.test(`${errorText} ${err}`)) throw new QuotaError(`${o.harness} hit a quota or rate limit: ${why}`);
    throw new Error(`${o.harness} exited with ${code}: ${why}`);
  }
  return usage;
}

function claudeUsage(events: Record<string, any>[]): { usage: Usage; errorText: string } {
  const result = events.findLast((e) => e.type === "result") ?? {};
  const u = result.usage ?? {};
  const cached = u.cache_read_input_tokens ?? 0;
  return {
    usage: {
      lastMessage: result.result ?? "",
      inputTokens: (u.input_tokens ?? 0) + cached + (u.cache_creation_input_tokens ?? 0),
      cachedInputTokens: cached,
      outputTokens: u.output_tokens ?? 0,
      costUsd: result.total_cost_usd ?? null,
    },
    errorText: result.is_error ? String(result.result ?? result.subtype ?? "error") : result.type ? "" : "the session ended without a result",
  };
}

function codexUsage(events: Record<string, any>[], model: string, prices: Prices): { usage: Usage; errorText: string } {
  const usage: Usage = { lastMessage: "", inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, costUsd: null };
  const errors: string[] = [];
  for (const event of events) {
    if (event.type === "item.completed" && event.item?.type === "agent_message") usage.lastMessage = event.item.text ?? "";
    if (event.type === "error") errors.push(String(event.message ?? ""));
    if (event.type === "turn.failed") errors.push(String(event.error?.message ?? "turn failed"));
    if (event.type !== "turn.completed" || !event.usage) continue;
    usage.inputTokens += event.usage.input_tokens ?? 0;
    usage.cachedInputTokens += event.usage.cached_input_tokens ?? 0;
    usage.outputTokens += event.usage.output_tokens ?? 0;
  }
  const completed = events.some((e) => e.type === "turn.completed");
  const price = prices[model];
  if (price && typeof price.input === "number" && typeof price.cached_input === "number" && typeof price.output === "number") {
    usage.costUsd = ((usage.inputTokens - usage.cachedInputTokens) * price.input + usage.cachedInputTokens * price.cached_input + usage.outputTokens * price.output) / 1e6;
  }
  // Codex reports passing errors (a reconnect) as events too; only a turn that never completed failed.
  return { usage, errorText: completed ? "" : errors.join("; ") || "the session ended without completing its turn" };
}

/** The JSON the session wrote to `file` in its folder or, failing that, the
 *  last JSON object in its last message. */
export async function readAnswer(session: Session, file: string, lastMessage: string): Promise<{ value: unknown; from: string }> {
  const answer = Bun.file(join(session.workDir, file));
  if (await answer.exists()) return { value: JSON.parse(await answer.text()), from: file };
  const match = lastMessage.match(/\{[\s\S]*\}/);
  if (match) return { value: JSON.parse(match[0]), from: "its last message" };
  throw new Error(`the session wrote no ${file}. Its last message: ${lastMessage.trim().slice(0, 300) || "(none)"}`);
}

/** What the model did in a session: its tool calls, shell commands and web
 *  searches, as text, leaving out what tools returned (a search result may
 *  well link to x.com without the model opening it). */
export function sessionActions(transcript: string): string[] {
  const actions: string[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event: Record<string, any>;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "assistant") {
      // Writing its answer looks nothing up, and the answer may well name what it was told not to do.
      for (const block of event.message?.content ?? []) if (block.type === "tool_use" && block.name !== "Write") actions.push(`${block.name} ${JSON.stringify(block.input)}`);
    }
    if (event.type === "item.started" || event.type === "item.completed") {
      const item = event.item ?? {};
      if (item.type === "agent_message" || item.type === "reasoning") continue;
      const { aggregated_output: _output, ...rest } = item;
      actions.push(`${item.type} ${JSON.stringify(rest)}`);
    }
  }
  return actions;
}

/** Lookups the prompt forbids: the post or the note on X, X's embed
 *  endpoint, Community Notes sites, and anything of this repository's. */
const FORBIDDEN_PATTERNS: [string, RegExp][] = [
  ["X's embed endpoint", /syndication/i],
  ["Community Notes", /birdwatch|communitynotes|community[ -]notes/i],
  ["a post on X", /(?:x|twitter|nitter|xcancel|fxtwitter|vxtwitter|fixupx)\.(?:com|net)\/(?:\w+\/status|i\/)/i],
  ["X itself", /https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\b/i],
  ["a .env file", /\.env\b/],
  ["the database", /supabase/i],
  // Only paths in the user's home folder or the repo: Codex looks for
  // AGENTS.md, .codex and the like in its own empty folder out of habit, and
  // finds nothing there. A real leak shows up as one of these paths.
  ["this repository", /factcheck-taste|taste-runs|superseded|(~|\/home\/[^/\s"']+)\/\.(claude|codex)/i],
];

/** The forbidden lookups among a session's actions, and searches that quote
 *  six or more words of the note in a row. */
export function auditActions(actions: string[], noteText?: string): string[] {
  const hits: string[] = [];
  for (const action of actions) {
    for (const [what, pattern] of FORBIDDEN_PATTERNS) if (pattern.test(action)) hits.push(`${what}: ${action.slice(0, 300)}`);
  }
  if (noteText) {
    // Opening a source the note links to is allowed: links are left out on both sides.
    const withoutLinks = (text: string) => text.replace(/https?:\/\/[^\s"\\]+/g, " ");
    const words = withoutLinks(noteText).toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
    const runs = new Set(words.slice(0, Math.max(0, words.length - 5)).map((_, i) => words.slice(i, i + 6).join(" ")));
    for (const action of actions) {
      if (!/search/i.test(action)) continue;
      const said = (withoutLinks(action).toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).join(" ");
      if ([...runs].some((run) => said.includes(run))) hits.push(`searched for the note's text: ${action.slice(0, 300)}`);
    }
  }
  return hits;
}
