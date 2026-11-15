import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { kappaText, wilson, type Prevalence } from "@cn/core/agreement";
import {
  commonNotes,
  ESTIMATED_COST,
  judgedNotes,
  labelAxes,
  labelCounts,
  LABELLERS,
  labelText,
  MIN_REVIEWS,
  modelAgreement,
  modelRecall,
  modelStats,
  promptVersions,
  sameProtocol,
  SPLIT_LABELS,
  splits,
  totals,
  UNRECORDED_PROMPT,
  writerLabelShares,
  writerStats,
  withoutTriedModels,
  type Score,
  type SummaryData,
} from "@cn/core/summary";
import { fetchSummary } from "@cn/core/summaryFetch";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { queryKeys } from "@cn/features/query/queryKeys";
import { type BarSeries, GroupedBars } from "@cn/features/summary/GroupedBars";
import { LineProfile, type LineSeries } from "@cn/features/summary/LineProfile";
import { SplitBars } from "@cn/features/summary/SplitBars";
import { Card } from "@cn/ui/Card";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";
import { SectionTitle } from "@cn/ui/typography";

const SLOT_COLORS = ["var(--cn-compare-1)", "var(--cn-compare-2)", "var(--cn-compare-3)"];

const pct = (part: number, whole: number) => (whole ? `${Math.round((100 * part) / whole)}%` : "–");
const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);
const tokens = (n: number | null) => (n === null ? "–" : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const ci = ([low, high]: [number, number]) => `${Math.round(low * 100)}–${Math.round(high * 100)}%`;
/** A share with its count and 95% Wilson interval. */
const shareText = (s: Score) => (s.share === null ? "–" : `${Math.round(s.share * 100)}% (${s.hits}/${s.of}, ${ci(wilson(s.hits, s.of))})`);
const prevalenceText = (p: Prevalence) => (p.estimate === null ? "–" : `${percent(p.estimate)}${p.ci ? ` (${ci(p.ci)})` : ""}`);
const promptName = (id: string) => (id === UNRECORDED_PROMPT ? "Not recorded" : id.slice(0, 7));

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <Card className="space-y-1 p-4">
      <p className="text-xs font-semibold text-fg-muted">{label}</p>
      <p className="font-title text-2xl font-bold text-fg">{value}</p>
      {detail && <p className="text-xs text-fg-muted">{detail}</p>}
    </Card>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-muted">
            {head.map((h, i) => (
              <th key={h} className={cn("py-2 pr-4 font-semibold", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-line last:border-0">
              {row.map((cell, i) => (
                <td key={i} className={cn("py-2 pr-4 text-fg-secondary", i === 0 ? "text-fg" : "text-right tabular-nums")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Up to three picks, each holding its colour while it stays picked, so
 *  picking another never repaints the ones already shown. */
function usePicks(initial: string[]) {
  const [slots, setSlots] = useState<(string | null)[]>(() => SLOT_COLORS.map((_, i) => initial[i] ?? null));
  const toggle = (id: string) =>
    setSlots((s) => {
      if (s.includes(id)) return s.map((x) => (x === id ? null : x));
      const free = s.indexOf(null);
      return free === -1 ? s : s.map((x, i) => (i === free ? id : x));
    });
  return { slots, toggle, full: !slots.includes(null) };
}

function Picker({ options, picks }: { options: { id: string; name: string }[]; picks: ReturnType<typeof usePicks> }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Show on the chart, up to three">
      {options.map((o) => {
        const slot = picks.slots.indexOf(o.id);
        const on = slot !== -1;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            disabled={!on && picks.full}
            onClick={() => picks.toggle(o.id)}
            className={cn(chipVariants(), on ? "border-line-strong bg-surface-hover text-fg" : "border-line text-fg-secondary hover:bg-surface-hover", "disabled:opacity-50")}
          >
            <span className="inline-block size-2 rounded-full" style={{ background: on ? SLOT_COLORS[slot] : "var(--cn-line-strong)" }} />
            {o.name}
          </button>
        );
      })}
    </div>
  );
}

/** A row of chips of which one is on, such as the chart type or the judge. */
function ChipChoice<T extends string>({ options, value, onChange, label }: { options: { id: T; name: string }[]; value: T; onChange: (id: T) => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      <span className="mr-1 text-xs text-fg-muted">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(chipVariants(), value === o.id ? "border-line-strong bg-surface-hover text-fg" : "border-line text-fg-secondary hover:bg-surface-hover")}
        >
          {o.name}
        </button>
      ))}
    </div>
  );
}

/** The legend of a line chart; a series without a colour is the dashed
 *  reference line. */
function LineLegend({ series }: { series: LineSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
      {series.map((s) => (
        <li key={s.id} className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4"
            style={s.color ? { background: s.color } : { backgroundImage: "repeating-linear-gradient(90deg, var(--cn-fg-subtle) 0 4px, transparent 4px 7px)" }}
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/** The axis top for shares: the next of 10, 20, 40, 60 and 100% at or above
 *  the largest, so small shares don't hug the bottom. */
const shareAxisMax = (largest: number) => [0.1, 0.2, 0.4, 0.6, 1].find((m) => m >= largest) ?? 1;
const percent = (v: number) => `${Math.round(v * 100)}%`;

/** Scores as the line chart's series values, with "(hits of all)" details. */
const scoreLine = (id: string, name: string, color: string | null, scores: Score[]): LineSeries => ({
  id,
  name,
  color,
  values: scores.map((x) => x.share),
  details: scores.map((x) => (x.of ? `(${x.hits} of ${x.of})` : "")),
});

/** What the benchmark is after: how often each notewriter's notes get each
 *  label. A judge's labels decide it, the labellers' or a model's, so the
 *  models can stand in where hand labels are thin. Once a model writes notes
 *  of its own, it is a notewriter here like any other. */
function WriterLabelSection({ data, models, labels }: { data: SummaryData; models: string[]; labels: string[] }) {
  const [judge, setJudge] = useState(LABELLERS);
  const [scope, setScope] = useState<"same" | "own">("same");
  const same = commonNotes(data, [LABELLERS, ...models]);
  const only = scope === "same" ? same : undefined;
  const judged = [...judgedNotes(data, judge).keys()].filter((id) => !only || only.has(id));
  const writers = writerStats(data);
  const notesBy = (writerId: string) => judged.filter((id) => data.writers.get(id)?.id === writerId).length;
  const options = writers.map((w) => ({ id: w.id, name: w.name }));
  const picks = usePicks(options.slice(0, 3).map((o) => o.id));
  const all = scoreLine("all", `All notewriters (${judged.length} notes)`, null, writerLabelShares(data, judge, null, labels, only));
  const shown = picks.slots.flatMap((id, slot) => {
    const writer = writers.find((w) => w.id === id);
    return writer ? [scoreLine(writer.id, `${writer.name} (${notesBy(writer.id)} notes)`, SLOT_COLORS[slot]!, writerLabelShares(data, judge, writer.id, labels, only))] : [];
  });
  const series = [all, ...shown];
  const largest = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  return (
    <section className="space-y-3">
      <SectionTitle>How often each notewriter&rsquo;s notes get each label</SectionTitle>
      <p className="text-sm text-fg-secondary">
        Of a notewriter&rsquo;s notes the judge judged, the share given each label. Lower is better. Pick the labellers, or a model to stand in where hand labels are
        thin. The labellers&rsquo; notes are those they called fine, or a taste failure and gave at least one label; unsure, somewhat and unlabelled failures are left
        out. With same notes, every judge is out of the {same.size} notes the labellers and every model judged, so switching judge compares like with like; with all its
        notes, each judge is out of its own, given beside each name. The dashed line is every notewriter together. Notes on X don&rsquo;t say which model wrote them; a
        model&rsquo;s own notes will show up here as a notewriter.
      </p>
      {labels.length === 0 ? (
        <p className="text-sm text-fg-muted">No one has given a label yet.</p>
      ) : (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <ChipChoice label="Judged by" options={[{ id: LABELLERS, name: "Labellers" }, ...models.map((m) => ({ id: m, name: m }))]} value={judge} onChange={setJudge} />
            <ChipChoice label="Notes" options={[{ id: "same", name: "Same notes" }, { id: "own", name: "All its notes" }]} value={scope} onChange={setScope} />
          </div>
          <Picker options={options} picks={picks} />
          <LineLegend series={series} />
          <LineProfile
            columns={labels.map((label) => ({ label, detail: "" }))}
            series={series}
            label="How often each notewriter's notes get each label"
            max={shareAxisMax(largest)}
            format={percent}
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-fg-secondary">The numbers</summary>
            <Table
              head={["", ...labels.map(labelText)]}
              rows={series.map((s) => [s.name, ...s.values.map((v, i) => (v === null ? "–" : `${percent(v)} ${s.details![i]}`))])}
            />
          </details>
        </Card>
      )}
    </section>
  );
}

/** How often each reviewer gives each label, as a share of the notes it
 *  reviewed, so a model that reviewed more notes isn't higher for that. */
function ReviewerLabelSection({ data, models }: { data: SummaryData; models: string[] }) {
  // The models past the seventh have no colour of their own, so aren't drawn or counted.
  const shownModels = models.slice(0, 7);
  const same = commonNotes(data, [LABELLERS, ...shownModels]);
  const counts = labelCounts(data, shownModels, same);
  const share = (n: number, of: number) => (of ? n / of : null);
  const series: LineSeries[] = [
    {
      id: "hand",
      name: `Labellers (${counts.handNotes} notes)`,
      color: null,
      values: counts.hand.map((n) => share(n, counts.handNotes)),
      details: counts.hand.map((n) => `(${n} of ${counts.handNotes})`),
    },
    // A model keeps the colour of its place in the AI reviewers table.
    ...counts.byModel.map((m, i) => ({
      id: m.model,
      name: `${m.model} (${m.notes} notes)`,
      color: `var(--cn-compare-${i + 1})`,
      values: m.counts.map((n) => share(n, m.notes)),
      details: m.counts.map((n) => `(${n} of ${m.notes})`),
    })),
  ];
  const largest = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  return (
    <section className="space-y-3">
      <SectionTitle>How often each reviewer gives each label</SectionTitle>
      <p className="text-sm text-fg-secondary">
        Every judge is out of the same {same.size} notes: those every model reviewed and the labellers called fine, or a taste failure with at least one label (unsure,
        somewhat and unlabelled failures are left out, since a model labels every failure it calls). The share is of those notes, counting a note with two labels under
        both. The dashed line is the labellers. This is the models as judges, not as writers.
      </p>
      {same.size === 0 ? (
        <p className="text-sm text-fg-muted">No note has been both fully labelled and reviewed by every model.</p>
      ) : counts.labels.length === 0 ? (
        <p className="text-sm text-fg-muted">No one has given a label yet.</p>
      ) : (
        <Card className="space-y-4 p-4">
          <LineLegend series={series} />
          <LineProfile columns={counts.labels.map((label) => ({ label, detail: "" }))} series={series} label="How often each reviewer gives each label" max={shareAxisMax(largest)} format={percent} />
          <details className="text-sm">
            <summary className="cursor-pointer text-fg-secondary">The numbers</summary>
            <Table head={["", ...counts.labels.map(labelText)]} rows={series.map((s) => [s.name, ...s.values.map((v, i) => (v === null ? "–" : `${percent(v)} ${s.details![i]}`))])} />
          </details>
        </Card>
      )}
    </section>
  );
}

/** Of the notes a labeller gave each label to, the share each picked model
 *  gave it to as well, as grouped bars or a line per model. */
function RecallSection({ data, axes, models }: { data: SummaryData; axes: { label: string; notes: number }[]; models: string[] }) {
  const [view, setView] = useState<"bars" | "lines">("bars");
  const picks = usePicks(models.slice(0, 3));
  const labels = axes.map((a) => a.label);
  const shown: BarSeries[] = picks.slots.flatMap((model, slot) => (model ? [{ id: model, name: model, color: SLOT_COLORS[slot]!, scores: modelRecall(data, model, labels) }] : []));
  const title = "What each reviewer catches";
  return (
    <section className="space-y-3">
      <SectionTitle>{title}</SectionTitle>
      <p className="text-sm text-fg-secondary">
        Of the notes a labeller gave each label to that the model reviewed, the share the model gave it to as well. Higher is better. The numbers and the tooltip give a
        95% Wilson interval; with a handful of notes it spans most of the scale.
      </p>
      {axes.length === 0 ? (
        <p className="text-sm text-fg-muted">No one has given a hand label yet.</p>
      ) : (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <Picker options={models.map((m) => ({ id: m, name: m }))} picks={picks} />
            <ChipChoice label="Chart" options={[{ id: "bars", name: "Bars" }, { id: "lines", name: "Lines" }]} value={view} onChange={setView} />
          </div>
          {view === "bars" ? (
            <GroupedBars rows={axes} series={shown} label={title} />
          ) : (
            <>
              <LineLegend series={shown.map((s) => scoreLine(s.id, s.name, s.color, s.scores))} />
              <LineProfile
                columns={axes.map((a) => ({ label: a.label, detail: `${a.notes} labelled` }))}
                series={shown.map((s) => scoreLine(s.id, s.name, s.color, s.scores))}
                label={title}
                max={1}
                format={percent}
              />
            </>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-fg-secondary">The numbers</summary>
            <Table head={["", ...axes.map((a) => labelText(a.label))]} rows={shown.map((s) => [s.name, ...s.scores.map(shareText)])} />
          </details>
        </Card>
      )}
    </section>
  );
}

/** Which reviews count: only those run.ts made, with one prompt. */
function ProtocolChoice({ raw, prompt, onChange, data }: { raw: SummaryData; prompt: string | null; onChange: (id: string) => void; data: SummaryData }) {
  const versions = promptVersions(raw);
  const byModel = [...Map.groupBy(data.reviews, (r) => r.model)].map(([model, rs]) => `${model} ${rs.length}`);
  const byHand = raw.reviews.filter((r) => r.harness === null).length;
  return (
    <Card className="space-y-2 p-4">
      {versions.length > 0 && prompt !== null && (
        <ChipChoice label="Prompt" options={versions.map((v) => ({ id: v.id, name: `${promptName(v.id)} (${v.reviews})` }))} value={prompt} onChange={onChange} />
      )}
      <p className="text-xs text-fg-muted">
        Only reviews made by scripts/ai/run.ts with {versions.length > 0 ? "the prompt picked here (newest first)" : "any prompt"}, so every model is scored on the same
        instructions; {byHand} made by hand are left out. Reviews under this: {byModel.length ? byModel.join(", ") : "none"}
. Models with fewer than {MIN_REVIEWS} are left out.
      </p>
    </Card>
  );
}

/** How common taste failures are beyond the labelled notes, by each model,
 *  and how the models agree with each other. */
function PrevalenceSection({ data, models }: { data: SummaryData; models: ReturnType<typeof modelStats> }) {
  const between = modelAgreement(
    data,
    models.map((m) => m.model),
  );
  return (
    <section className="space-y-3">
      <SectionTitle>Taste failures beyond the labelled notes</SectionTitle>
      <p className="text-sm text-fg-secondary">
        A model&rsquo;s own taste-failure rate on every note it reviewed, corrected for the failures it misses (sensitivity) and the false alarms it gives
        (specificity) on the notes the labellers called a taste failure or fine (Rogan&ndash;Gladen). The interval is 95% and carries the uncertainty of all three. The
        reviewed notes aren&rsquo;t a random sample of X&rsquo;s notes, so this is the rate on those notes; scripts/ai/compare.ts --prevalence weights a stratified set back to
        the population.
      </p>
      <Table
        head={["Model", "Own rate", "Sensitivity", "Specificity", "Corrected rate"]}
        rows={models.map((m) => {
          const p = m.prevalence;
          const vs = m.vsLabellers;
          return [
            m.model,
            `${pct(m.tasteFailures, m.reviews)} of ${m.reviews}`,
            p.sensitivity === null ? "–" : `${percent(p.sensitivity)} of ${vs.caught + vs.missed}`,
            p.specificity === null ? "–" : `${percent(p.specificity)} of ${vs.cleared + vs.falseAlarms}`,
            prevalenceText(p),
          ];
        })}
      />
      {between.pairs.length > 0 && (
        <>
          <p className="text-sm text-fg-secondary">
            How the models agree with each other, as Cohen&rsquo;s κ on the notes both reviewed
            {between.fleiss !== null ? `; Fleiss' κ of all ${models.length} on the ${between.fleissNotes} notes all reviewed is ${between.fleiss.toFixed(2)}` : ""}.
          </p>
          <Table head={["Models", "Notes both reviewed", "Agreement", "κ"]} rows={between.pairs.map((p) => [`${p.a} and ${p.b}`, p.agreement.notes, pct(Math.round(p.agreement.agreement * p.agreement.notes), p.agreement.notes), kappaText(p.agreement)])} />
        </>
      )}
    </section>
  );
}

function Summary({ raw }: { raw: SummaryData }) {
  const [picked, setPicked] = useState<string | null>(null);
  const prompt = picked ?? promptVersions(raw)[0]?.id ?? null;
  const data = withoutTriedModels(sameProtocol(raw, prompt));
  const models = modelStats(data);
  const modelIds = models.map((m) => m.model);
  const total = totals(data, models);
  const writers = writerStats(data);
  const axes = labelAxes(data);
  const axisNames = axes.map((a) => a.label);
  const allLabels = labelCounts(data, modelIds).labels;
  return (
    <div className="space-y-10">
      <ProtocolChoice raw={raw} prompt={prompt} onChange={setPicked} data={data} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Notes judged" value={total.judged} detail={`${total.labelled} with labels`} />
        <Stat
          label="Taste failures"
          value={total.tasteFailures}
          detail={`${pct(total.tasteFailures, total.decided)} of ${total.decided} decided (${total.judged - total.decided} unsure left out)`}
        />
        <Stat label="AI reviews" value={total.reviews} detail={`${total.models} models, ${total.reviewedNotes} notes`} />
        <Stat
          label="Post needed a note"
          value={total.needsNote.yes}
          detail={`of ${total.needsNote.yes + total.needsNote.no + total.needsNote.unsure} asked; ${total.needsNote.no} didn't, ${total.needsNote.unsure} unsure`}
        />
      </div>

      <section className="space-y-3">
        <SectionTitle>How each judge splits the notes</SectionTitle>
        <p className="text-sm text-fg-secondary">
          Every note the labellers judged, and every note each model reviewed, by what they called it. A failure with several labels counts under the commonest; a failure with no label yet, or only
          labels past the {SPLIT_LABELS} commonest, counts as other. Each bar is out of its own notes, so the bars cover different notes.
        </p>
        <Card className="p-4">
          <SplitBars splits={splits(data, axisNames, modelIds)} labels={axisNames.slice(0, SPLIT_LABELS)} />
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>Notewriters</SectionTitle>
        <p className="text-sm text-fg-secondary">The rate is of the decided notes: those the labellers didn&rsquo;t mark unsure. Somewhat counts as not a taste failure.</p>
        <Table
          head={["Notewriter", "Judged", "Decided", "Taste failures", "Rate", "Post didn't need a note"]}
          rows={writers.map((w) => [
            w.name,
            w.judged,
            w.decided,
            w.tasteFailures,
            pct(w.tasteFailures, w.decided),
            w.askedNeed ? `${pct(w.notNeeded, w.askedNeed)} of ${w.askedNeed}` : "–",
          ])}
        />
      </section>

      <WriterLabelSection data={data} models={modelIds} labels={allLabels} />

      <section className="space-y-3">
        <SectionTitle>AI reviewers</SectionTitle>
        <p className="text-sm text-fg-secondary">
          The model is compared with the labellers only on notes they called a taste failure or fine. κ (Cohen&rsquo;s kappa) is agreement beyond chance: 0 is no better
          than guessing, 1 is perfect; under 10 notes it isn&rsquo;t shown. The baseline is how often always giving the labellers&rsquo; commoner answer would agree.
          Intervals are 95%. Cost is per model and never added up across models: a cost marked {ESTIMATED_COST} is worked out from the tokens at the provider&rsquo;s
          list price, because the harness reported no dollars.
        </p>
        <Table
          head={["Model", "Reviews", "Taste failure", "κ with labellers", "Agreement", "Baseline", "Failures caught", "Cost", "Per review", "Tokens in / out"]}
          rows={models.map((m) => [
            m.model,
            m.reviews,
            pct(m.tasteFailures, m.reviews),
            kappaText(m.vsLabellers),
            m.vsLabellers.notes ? `${pct(Math.round(m.vsLabellers.agreement * m.vsLabellers.notes), m.vsLabellers.notes)} (${ci(m.vsLabellers.agreementCi)}) of ${m.vsLabellers.notes}` : "–",
            m.vsLabellers.notes ? percent(m.vsLabellers.baseline) : "–",
            m.vsLabellers.caught + m.vsLabellers.missed ? `${m.vsLabellers.caught} of ${m.vsLabellers.caught + m.vsLabellers.missed}` : "–",
            m.costed ? `${usd(m.costUsd)}${m.estimated ? ` ${ESTIMATED_COST}` : ""}${m.costed < m.reviews ? ` (${m.costed} of ${m.reviews})` : ""}` : "unknown",
            m.costed ? `${usd(m.costUsd / m.costed)}${m.estimated ? " est." : ""}` : "–",
            `${tokens(m.avgInputTokens)} / ${tokens(m.avgOutputTokens)}`,
          ])}
        />
      </section>

      <PrevalenceSection data={data} models={models} />

      <ReviewerLabelSection data={data} models={modelIds} />

      <RecallSection data={data} axes={axes} models={modelIds} />
    </div>
  );
}

/** The Summary tab: counts, costs and per-model scores for the X notes. */
export function SummaryTab() {
  const query = useQuery({ queryKey: queryKeys.tasteSummary, queryFn: fetchSummary });
  if (query.isError) return <LoadFailed what="The summary" onRetry={() => void query.refetch()} />;
  if (!query.data) return <p className="text-sm text-fg-muted">Loading…</p>;
  return <Summary raw={query.data} />;
}
