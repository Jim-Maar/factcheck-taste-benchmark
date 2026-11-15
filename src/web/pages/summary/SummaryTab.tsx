import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchSummary, labelAxes, labelCounts, modelRecall, modelStats, SPLIT_LABELS, splits, totals, writerFailures, writerStats, type Score, type SummaryData } from "@cn/core/summary";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { queryKeys } from "@cn/features/query/queryKeys";
import { type BarSeries, GroupedBars } from "@cn/features/summary/GroupedBars";
import { countAxisMax, LineProfile } from "@cn/features/summary/LineProfile";
import { labelText, RadarChart, type RadarSeries } from "@cn/features/summary/RadarChart";
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

function RadarSection({
  title,
  intro,
  axes,
  options,
  scoresOf,
  reference,
  chart,
}: {
  title: string;
  intro: string;
  axes: { label: string; notes: number }[];
  options: { id: string; name: string }[];
  scoresOf: (id: string) => Score[];
  reference?: RadarSeries;
  /** Bars or lines when each note has only one or two of the labels, so a
   *  series' scores aren't independent strengths; a radar when they are.
   *  Bars and lines can be switched between. */
  chart: "radar" | "bars";
}) {
  const [view, setView] = useState<"bars" | "lines">("bars");
  const picks = usePicks(options.slice(0, 3).map((o) => o.id));
  const shown: BarSeries[] = picks.slots.flatMap((id, slot) => {
    const option = options.find((o) => o.id === id);
    return option ? [{ id: option.id, name: option.name, color: SLOT_COLORS[slot]!, scores: scoresOf(option.id) }] : [];
  });
  const series = reference ? [reference, ...shown] : shown;
  return (
    <section className="space-y-3">
      <SectionTitle>{title}</SectionTitle>
      <p className="text-sm text-fg-secondary">{intro}</p>
      {axes.length < (chart === "radar" ? 3 : 1) ? (
        <p className="text-sm text-fg-muted">
          The chart needs hand labels of at least {chart === "radar" ? "three kinds" : "one kind"}; {axes.length === 0 ? "there are none yet" : `there are ${axes.length} so far`}.
        </p>
      ) : (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <Picker options={options} picks={picks} />
            {chart === "bars" && (
              <div className="flex gap-1" role="group" aria-label="Chart">
                {(["bars", "lines"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(chipVariants(), view === v ? "border-line-strong bg-surface-hover text-fg" : "border-line text-fg-secondary hover:bg-surface-hover")}
                  >
                    {v === "bars" ? "Bars" : "Lines"}
                  </button>
                ))}
              </div>
            )}
          </div>
          {chart === "radar" ? (
            <RadarChart axes={axes} series={series} label={title} />
          ) : view === "bars" ? (
            <GroupedBars rows={axes} series={shown} label={title} />
          ) : (
            <LineProfile
              columns={axes.map((a) => ({ label: a.label, detail: `${a.notes} labelled` }))}
              series={shown.map((s) => ({ ...s, values: s.scores.map((x) => x.share), details: s.scores.map((x) => (x.of ? `(${x.hits} of ${x.of})` : "")) }))}
              label={title}
              max={1}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-fg-secondary">The numbers</summary>
            <Table head={["", ...axes.map((a) => labelText(a.label))]} rows={series.map((s) => [s.name, ...s.scores.map(shareText)])} />
          </details>
        </Card>
      )}
    </section>
  );
}

/** How many notes each model gave each label to, a line per model, with the
 *  labellers' counts dashed. Shows both how much more one model flags than
 *  another and on which labels. */
function LabelCountSection({ data, models }: { data: SummaryData; models: string[] }) {
  const counts = labelCounts(data, models);
  const reviewed = (model: string) => data.reviews.filter((r) => r.model === model).length;
  const series = [
    { id: "hand", name: `Labellers (${data.verdicts.size} notes)`, color: null, values: counts.hand },
    // A model keeps the colour of its place in the AI reviewers table.
    ...counts.byModel.slice(0, 7).map((m, i) => ({ id: m.model, name: `${m.model} (${reviewed(m.model)} notes)`, color: `var(--cn-compare-${i + 1})`, values: m.counts })),
  ];
  const largest = Math.max(1, ...series.flatMap((s) => s.values));
  return (
    <section className="space-y-3">
      <SectionTitle>How often each model gives each label</SectionTitle>
      <p className="text-sm text-fg-secondary">
        The number of notes given each label, a line per model, counting a note with two labels under both. The dashed line is the labellers. These are counts, not shares,
        so a model that reviewed more notes sits higher.
      </p>
      {counts.labels.length === 0 ? (
        <p className="text-sm text-fg-muted">No one has given a label yet.</p>
      ) : (
        <Card className="space-y-4 p-4">
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
          <LineProfile
            columns={counts.labels.map((label, i) => ({ label, detail: `${series.reduce((n, s) => n + s.values[i]!, 0)} in all` }))}
            series={series}
            label="How often each model gives each label"
            max={countAxisMax(largest)}
            format={(v) => String(v)}
          />
          <details className="text-sm">
            <summary className="cursor-pointer text-fg-secondary">The numbers</summary>
            <Table head={["", ...counts.labels.map(labelText)]} rows={series.map((s) => [s.name, ...s.values])} />
          </details>
        </Card>
      )}
    </section>
  );
}

function Summary({ data }: { data: SummaryData }) {
  const models = modelStats(data);
  const total = totals(data, models);
  const writers = writerStats(data);
  const axes = labelAxes(data);
  const axisNames = axes.map((a) => a.label);
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
          <SplitBars splits={splits(data, axisNames, models.map((m) => m.model))} labels={axisNames.slice(0, SPLIT_LABELS)} />
        </Card>
      </section>

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

      <LabelCountSection data={data} models={models.map((m) => m.model)} />

      <RadarSection
        title="What each reviewer catches"
        intro="For each label, the notes a labeller gave it to that the model reviewed, and the share of those the model gave it to as well. Longer is better."
        axes={axes}
        options={models.map((m) => ({ id: m.model, name: m.model }))}
        scoresOf={(model) => modelRecall(data, model, axisNames)}
        chart="bars"
      />

      <section className="space-y-3">
        <SectionTitle>Notewriters</SectionTitle>
        <Table
          head={["Notewriter", "Judged", "Taste failures", "Rate", "Post didn't need a note"]}
          rows={writers.map((w) => [w.name, w.judged, w.tasteFailures, pct(w.tasteFailures, w.judged), w.askedNeed ? `${pct(w.notNeeded, w.askedNeed)} of ${w.askedNeed}` : "–"])}
        />
      </section>

      <RadarSection
        title="Where notewriters fail"
        intro="For each label, the share of a notewriter's judged notes a labeller gave it to. Further out is worse. The scale grows to fit the largest share shown. The dashed outline is every notewriter together."
        axes={axes}
        options={writers.map((w) => ({ id: w.id, name: w.name }))}
        scoresOf={(id) => writerFailures(data, id, axisNames)}
        reference={{ id: "all", name: "All notewriters", color: null, scores: writerFailures(data, null, axisNames) }}
        chart="radar"
      />
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
