import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchPostCards, loadEvalData, runScore, type Decision, type EvalAnswer, type EvalPost, type EvalRun } from "@cn/core/notewriterEval";
import type { XNote } from "@cn/core/taste";
import { StatusBadge } from "@cn/features/notes/NoteBox";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { queryKeys } from "@cn/features/query/queryKeys";
import { communityNoteUrl } from "@cn/shared/communityNoteUrl";
import { LinkifiedText } from "@cn/shared/LinkifiedText";
import { Button } from "@cn/ui/Button";
import { Card } from "@cn/ui/Card";
import { chipVariants } from "@cn/ui/Chip";
import { ChipChoice } from "@cn/ui/ChipChoice";
import { cn } from "@cn/ui/cn";
import { eyebrowVariants } from "@cn/ui/typography";
import { XPostCard } from "../x/XPostCard";

type Outcome = "all" | "right" | "wrong";
type LabelFilter = "all" | Decision;

const LABEL_NAMES: Record<Decision, string> = { write_note: "Needs a note", no_note: "Needs no note" };
const noteTextClass = "text-sm text-fg whitespace-pre-wrap [overflow-wrap:anywhere]";
const noteLinkClass = "text-link hover:underline break-all";
/** A share with one decimal, so that 129 of 200 reads 64.5% and not a
 *  rounded 64% or 65%. */
const pct = (part: number, whole: number) => (whole ? `${((100 * part) / whole).toFixed(1).replace(/\.0$/, "")}%` : "–");
const runName = (run: EvalRun) => `${run.model}, ${run.effort} effort`;

/** A choice kept in the page address, so a link shows the same view. A value
 *  the address names that is not among the options falls back to the first. */
function useAddressChoice<T extends string>(name: string, options: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState(() => new URLSearchParams(window.location.search).get(name));
  const set = (next: T) => {
    const params = new URLSearchParams(window.location.search);
    params.set(name, next);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    setValue(next);
  };
  return [options.find((option) => option === value) ?? options[0]!, set];
}

/** The model's answer where the Community Note goes: its note, rated helpful
 *  when writing one was right and not helpful when it was wrong, or the words
 *  that it wrote none. */
function ModelNote({ run, answer, right }: { run: EvalRun; answer: EvalAnswer; right: boolean }) {
  return (
    <section aria-label="The model's note" className="mt-4">
      <h3 className={cn(eyebrowVariants(), "mb-1.5")}>Community Note by {run.model}</h3>
      {answer.decision === "write_note" ? (
        <>
          <div className="mb-2">
            <StatusBadge status={right ? "helpful" : "not_helpful"} />
          </div>
          <LinkifiedText className={noteTextClass} linkClassName={noteLinkClass} text={answer.note} />
        </>
      ) : (
        <p className="text-sm text-fg-muted">{run.model} wrote no note.</p>
      )}
    </section>
  );
}

/** The AI note on X behind the post's label, behind a toggle, and for a post
 *  that needs no note, why the judge says so. */
function ReferenceNote({ post }: { post: EvalPost }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button variant="link" className="text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Hide the AI note on X behind the label" : "Show the AI note on X behind the label"}
      </Button>
      {open && (
        <div className="mt-2 space-y-2 rounded-card border border-line p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <StatusBadge status={post.referenceNote.status} />
            <a href={communityNoteUrl(post.referenceNote.id)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-link hover:underline">
              View on X ↗
            </a>
          </div>
          <LinkifiedText className={noteTextClass} linkClassName={noteLinkClass} text={post.referenceNote.text} />
          {post.judgeReasoning && (
            <p className="text-xs text-fg-secondary">
              <span className="font-semibold">Why the judge says the post needs no note:</span> {post.judgeReasoning}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** One post of the eval: the post with the model's note under it, and beside
 *  it on a wide screen, or below it on a narrow one, the label, whether the
 *  model got it right and why it decided as it did. */
function EvalCard({ post, card, run }: { post: EvalPost; card: XNote["post"] | undefined; run: EvalRun }) {
  const answer = run.answers.get(post.tweetId)!;
  const right = answer.decision === post.label;
  return (
    <div className="items-start space-y-4 lg:grid lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:gap-4 lg:space-y-0">
      <Card className="mx-auto w-full max-w-[40rem] p-4 lg:mx-0 lg:max-w-none">
        {card ? <XPostCard post={card} /> : <p className="text-sm text-fg-muted">Loading the post…</p>}
        <ModelNote run={run} answer={answer} right={right} />
      </Card>
      <div className="mx-auto w-full max-w-[40rem] space-y-3 [overflow-wrap:anywhere] lg:mx-0 lg:max-w-none">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-fg-muted">Label</span>
          <span className={cn(chipVariants(), "border-line-strong text-fg")}>{LABEL_NAMES[post.label]}</span>
          <span className={cn(chipVariants(), "border-transparent", right ? "bg-positive-selected text-positive-selected-fg" : "bg-negative-selected text-negative-selected-fg")}>
            {right ? "Right" : "Wrong"}
          </span>
        </div>
        <p className="text-sm text-fg-secondary">
          <span className="font-semibold">Why {run.model} {answer.decision === "write_note" ? "wrote a note" : "wrote none"}:</span> {answer.reasoning}
        </p>
        <ReferenceNote post={post} />
      </div>
    </div>
  );
}

/** One run's score, in a sentence. */
function Score({ run, posts }: { run: EvalRun; posts: EvalPost[] }) {
  const score = runScore(run, posts);
  return (
    <p className="text-sm text-fg-secondary">
      {runName(run)} got {score.right} of {score.answered} posts right ({pct(score.right, score.answered)}): {score.noNote.right} of {score.noNote.of} posts that
      need no note and {score.writeNote.right} of {score.writeNote.of} that need one.
      {score.answered < posts.length && ` It answered only ${score.answered} of the ${posts.length} posts.`}
    </p>
  );
}

function EvalList({ posts, runs }: { posts: EvalPost[]; runs: EvalRun[] }) {
  const [runId, setRunId] = useAddressChoice("run", runs.map((r) => r.id));
  const [outcome, setOutcome] = useAddressChoice<Outcome>("outcome", ["all", "wrong", "right"]);
  const [label, setLabel] = useAddressChoice<LabelFilter>("label", ["all", "write_note", "no_note"]);
  const cards = useQuery({ queryKey: queryKeys.evalPosts, queryFn: () => fetchPostCards(posts.map((post) => post.tweetId)), staleTime: Infinity });
  const run = runs.find((r) => r.id === runId)!;
  const answered = posts.filter((post) => run.answers.has(post.tweetId) && (label === "all" || post.label === label));
  const isRight = (post: EvalPost) => run.answers.get(post.tweetId)!.decision === post.label;
  const wrong = answered.filter((post) => !isRight(post)).length;
  const shown = answered.filter((post) => outcome === "all" || isRight(post) === (outcome === "right"));
  return (
    <section className="space-y-4">
      <ChipChoice label="Notewriter" options={runs.map((r) => ({ id: r.id, name: `${runName(r)} ${pct(runScore(r, posts).right, runScore(r, posts).answered)}` }))} value={runId} onChange={setRunId} />
      <Score run={run} posts={posts} />
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <ChipChoice
          label="Label"
          options={[{ id: "all", name: "Both" }, { id: "write_note", name: LABEL_NAMES.write_note }, { id: "no_note", name: LABEL_NAMES.no_note }]}
          value={label}
          onChange={setLabel}
        />
        <ChipChoice
          label="Show"
          options={[{ id: "all", name: `All ${answered.length}` }, { id: "wrong", name: `Wrong ${wrong}` }, { id: "right", name: `Right ${answered.length - wrong}` }]}
          value={outcome}
          onChange={setOutcome}
        />
      </div>
      {cards.isError && <LoadFailed what="The posts" onRetry={() => void cards.refetch()} />}
      {shown.length === 0 ? (
        <p className="py-12 text-center text-sm text-fg-muted">No posts match.</p>
      ) : (
        <div className="divide-y divide-line">
          {shown.map((post) => (
            <div key={post.tweetId} className="py-6 first:pt-0">
              <EvalCard post={post} card={cards.data?.get(post.tweetId)} run={run} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** The notewriter eval: its posts, newest first, with one model's answer on
 *  each. The models are listed best first. The model, the label and whether the model got the post right can
 *  be chosen above the list. */
export function EvalTab() {
  const data = useQuery({ queryKey: queryKeys.evalData, queryFn: loadEvalData, staleTime: Infinity });
  if (data.isError) return <LoadFailed what="The eval" onRetry={() => void data.refetch()} />;
  if (!data.data) return <p className="text-sm text-fg-muted">Loading…</p>;
  if (data.data.runs.length === 0) return <p className="text-sm text-fg-muted">No model has been run on the eval yet.</p>;
  const posts = [...data.data.posts].sort((a, b) => (BigInt(b.tweetId) > BigInt(a.tweetId) ? 1 : -1));
  const accuracy = (run: EvalRun) => {
    const score = runScore(run, posts);
    return score.right / score.answered;
  };
  const runs = [...data.data.runs].sort((a, b) => accuracy(b) - accuracy(a));
  return <EvalList posts={posts} runs={runs} />;
}
