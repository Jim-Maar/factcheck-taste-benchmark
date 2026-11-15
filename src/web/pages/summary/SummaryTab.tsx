import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchSummary,
  judgedNotes,
  labelAxes,
  labelCounts,
  LABELLERS,
  labelText,
  modelRecall,
  modelStats,
  SPLIT_LABELS,
  splits,
  totals,
  writerLabelShares,
  writerStats,
  type Score,
  type SummaryData,
} from "@cn/core/summary";
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
const shareText = (s: Score) => (s.share === null ? "–" : `${Math.round(s.share * 100)}% (${s.hits}/${s.of})`);

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
  const judged = judgedNotes(data, judge);
  const writers = writerStats(data);
  const notesBy = (writerId: string) => [...judged.keys()].filter((id) => data.writers.get(id)?.id === writerId).length;
  const options = writers.map((w) => ({ id: w.id, name: w.name }));
  const picks = usePicks(options.slice(0, 3).map((o) => o.id));
  const all = scoreLine("all", `All notewriters (${judged.size} notes)`, null, writerLabelShares(data, judge, null, labels));
  const shown = picks.slots.flatMap((id, slot) => {
    const writer = writers.find((w) => w.id === id);
    return writer ? [scoreLine(writer.id, `${writer.name} (${notesBy(writer.id)} notes)`, SLOT_COLORS[slot]!, writerLabelShares(data, judge, writer.id, labels))] : [];
  });
  const series = [all, ...shown];
  const largest = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  return (
    <section className="space-y-3">
      <SectionTitle>How often each notewriter&rsquo;s notes get each label</SectionTitle>
      <p className="text-sm text-fg-secondary">
        Of a notewriter&rsquo;s notes the judge judged, the share given each label. Lower is better. Pick the labellers, or a model to stand in where hand labels are
        thin. The dashed line is every notewriter together. Notes on X don&rsquo;t say which model wrote them; a model&rsquo;s own notes will show up here as a notewriter.
      </p>
      {labels.length === 0 ? (
        <p className="text-sm text-fg-muted">No one has given a label yet.</p>
      ) : (
        <Card className="space-y-4 p-4">
          <ChipChoice label="Judged by" options={[{ id: LABELLERS, name: "Labellers" }, ...models.map((m) => ({ id: m, name: m }))]} value={judge} onChange={setJudge} />
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
  const counts = labelCounts(data, models);
  const reviewed = (model: string) => data.reviews.filter((r) => r.model === model).length;
  const share = (n: number, of: number) => (of ? n / of : null);
  const series: LineSeries[] = [
    {
      id: "hand",
      name: `Labellers (${data.verdicts.size} notes)`,
      color: null,
      values: counts.hand.map((n) => share(n, data.verdicts.size)),
      details: counts.hand.map((n) => `(${n} of ${data.verdicts.size})`),
    },
    // A model keeps the colour of its place in the AI reviewers table.
    ...counts.byModel.slice(0, 7).map((m, i) => ({
      id: m.model,
      name: `${m.model} (${reviewed(m.model)} notes)`,
      color: `var(--cn-compare-${i + 1})`,
      values: m.counts.map((n) => share(n, reviewed(m.model))),
      details: m.counts.map((n) => `(${n} of ${reviewed(m.model)})`),
    })),
  ];
  const largest = Math.max(0, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  return (
    <section className="space-y-3">
      <SectionTitle>How often each reviewer gives each label</SectionTitle>
      <p className="text-sm text-fg-secondary">
        Of the notes each one reviewed, the share it gave each label, counting a note with two labels under both. The dashed line is the labellers. This is the models as
        judges, not as writers.
      </p>
      {counts.labels.length === 0 ? (
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
      <p className="text-sm text-fg-secondary">Of the notes a labeller gave each label to that the model reviewed, the share the model gave it to as well. Higher is better.</p>
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

function Summary({ data }: { data: SummaryData }) {
  const models = modelStats(data);
  const modelIds = models.map((m) => m.model);
  const total = totals(data, models);
  const writers = writerStats(data);
  const axes = labelAxes(data);
  const axisNames = axes.map((a) => a.label);
  const allLabels = labelCounts(data, modelIds).labels;
  const est = total.estimated ? " (part estimated)" : "";
  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Notes judged" value={total.judged} detail={`${total.labelled} with labels`} />
        <Stat label="Taste failures" value={total.tasteFailures} detail={`${pct(total.tasteFailures, total.judged)} of judged`} />
        <Stat label="AI reviews" value={total.reviews} detail={`${total.models} models, ${total.reviewedNotes} notes`} />
        <Stat
          label="Post needed a note"
          value={total.needsNote.yes}
          detail={`of ${total.needsNote.yes + total.needsNote.no + total.needsNote.unsure} asked; ${total.needsNote.no} didn't, ${total.needsNote.unsure} unsure`}
        />
        <Stat label={`Total cost${est}`} value={usd(total.costUsd)} detail={`for ${total.costed} of ${total.reviews} reviews`} />
        <Stat label={`Cost per review${est}`} value={total.costed ? usd(total.costUsd / total.costed) : "–"} />
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
        <Table
          head={["Notewriter", "Judged", "Taste failures", "Rate", "Post didn't need a note"]}
          rows={writers.map((w) => [w.name, w.judged, w.tasteFailures, pct(w.tasteFailures, w.judged), w.askedNeed ? `${pct(w.notNeeded, w.askedNeed)} of ${w.askedNeed}` : "–"])}
        />
      </section>

      <WriterLabelSection data={data} models={modelIds} labels={allLabels} />

      <section className="space-y-3">
        <SectionTitle>AI reviewers</SectionTitle>
        <p className="text-sm text-fg-secondary">
          Agreement counts only notes a labeller called a taste failure or fine. A cost marked est. is worked out from the tokens at the provider&rsquo;s list price, because
          the harness reported no dollars.
        </p>
        <Table
          head={["Model", "Reviews", "Taste failure", "Agrees with labellers", "Cost", "Per review", "Tokens in / out"]}
          rows={models.map((m) => [
            m.model,
            m.reviews,
            pct(m.tasteFailures, m.reviews),
            m.comparable ? `${pct(m.agreed, m.comparable)} of ${m.comparable}` : "–",
            m.costed ? `${usd(m.costUsd)}${m.estimated ? " est." : ""}${m.costed < m.reviews ? ` (${m.costed} of ${m.reviews})` : ""}` : "unknown",
            m.costed ? usd(m.costUsd / m.costed) : "–",
            `${tokens(m.avgInputTokens)} / ${tokens(m.avgOutputTokens)}`,
          ])}
        />
      </section>

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
  return <Summary data={query.data} />;
}
