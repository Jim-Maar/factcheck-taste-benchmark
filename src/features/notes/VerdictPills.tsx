import { useState } from "react";
import { cva } from "class-variance-authority";
import { isDatabaseOutdated, type Accuracy, type Verdict } from "@cn/core/taste";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";
import { CheckIcon, CloseIcon } from "@cn/ui/icons";

/* The answer to "Taste failure?", drawn with commonnotes.net's rating pills
 * (VoteRatings in cn-return-bot, in its colourful palette). Yes means the note
 * is a taste failure, so it takes the red of a Not helpful rating, and No the
 * green of a Helpful one. Somewhat takes the amber of a Somewhat helpful
 * rating, and Unsure stays grey. The accuracy pills use the same colours:
 * Correct green, Partly amber, Wrong red. */
const verdictPillVariants = cva(
  cn("inline-flex h-9 items-center justify-center gap-1.5 rounded-control border px-4 text-sm font-semibold transition-colors [@media(pointer:coarse)]:min-h-10 disabled:opacity-60", focusRing),
  {
    variants: {
      tone: { positive: "", negative: "", caution: "", neutral: "" },
      selected: { true: "", false: "" },
    },
    compoundVariants: [
      // An unchosen pill waits with a grey border and coloured text. A hover
      // washes the fill faintly in the pill's colour.
      { tone: "positive", selected: false, className: "border-line-strong text-positive hover:bg-positive-soft" },
      { tone: "negative", selected: false, className: "border-line-strong text-negative hover:bg-negative-soft" },
      { tone: "caution", selected: false, className: "border-line-strong text-caution hover:bg-caution-soft" },
      { tone: "neutral", selected: false, className: "border-line-strong text-fg-secondary hover:bg-surface-hover" },
      // A chosen pill is tonal: a stronger wash, a border in its colour and a
      // deeper text shade.
      { tone: "positive", selected: true, className: "border-positive-line bg-positive-selected text-positive-selected-fg" },
      { tone: "negative", selected: true, className: "border-negative-line bg-negative-selected text-negative-selected-fg" },
      { tone: "caution", selected: true, className: "border-caution-line bg-caution-selected text-caution-selected-fg" },
      { tone: "neutral", selected: true, className: "border-fg-muted bg-surface-hover text-fg" },
    ],
  },
);

const VERDICT_ICON_SIZE = 12;

const VERDICT_OPTIONS = [
  { value: "taste_failure", label: "Yes", meaning: "Taste failure", tone: "negative", icon: <CloseIcon size={VERDICT_ICON_SIZE} aria-hidden /> },
  { value: "somewhat", label: "Somewhat", meaning: "Somewhat a taste failure", tone: "caution", icon: null },
  { value: "fine", label: "No", meaning: "No taste failure", tone: "positive", icon: <CheckIcon size={VERDICT_ICON_SIZE} aria-hidden /> },
  { value: "unsure", label: "Unsure", meaning: "Not sure whether it is a taste failure", tone: "neutral", icon: null },
] as const satisfies readonly { value: Verdict; label: string; meaning: string; tone: string; icon: React.ReactNode }[];

const ACCURACY_OPTIONS = [
  { value: "correct", label: "Correct", meaning: "The note is factually correct", tone: "positive", icon: <CheckIcon size={VERDICT_ICON_SIZE} aria-hidden /> },
  { value: "partly", label: "Partly", meaning: "The note is partly correct", tone: "caution", icon: null },
  { value: "wrong", label: "Wrong", meaning: "The note is factually wrong", tone: "negative", icon: <CloseIcon size={VERDICT_ICON_SIZE} aria-hidden /> },
  { value: "unsure", label: "Unsure", meaning: "Not sure whether the note is correct", tone: "neutral", icon: null },
] as const satisfies readonly { value: Accuracy; label: string; meaning: string; tone: string; icon: React.ReactNode }[];

type PillOption<T extends string> = { value: T; label: string; meaning: string; tone: "positive" | "negative" | "caution" | "neutral"; icon: React.ReactNode };

/** A row of pills for one answer. Clicking the chosen pill again clears it.
 *  While a click is being saved every pill waits. A save that fails leaves
 *  the answer as it was and says why beside the pills: an outdated database
 *  will not be fixed by trying again. */
function ChoicePills<T extends string>({ options, value: chosen, onChange }: { options: readonly PillOption<T>[]; value: T | null; onChange: (value: T | null) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const choose = async (value: T) => {
    setSaving(true);
    setFailure(null);
    try {
      await onChange(chosen === value ? null : value);
    } catch (error) {
      console.error(error);
      setFailure(isDatabaseOutdated(error) ? "Not saved: the database is out of date. Ask whoever manages it to apply the latest migration." : "Not saved. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {options.map(({ value, label, meaning, tone, icon }) => (
        <button
          key={value}
          type="button"
          disabled={saving}
          aria-pressed={chosen === value}
          aria-label={`${label}, ${meaning.toLowerCase()}`}
          onClick={() => void choose(value)}
          className={verdictPillVariants({ tone, selected: chosen === value })}
        >
          {chosen === value && icon}
          {label}
        </button>
      ))}
      {failure && (
        <span role="alert" className="text-xs text-negative">
          {failure}
        </span>
      )}
    </span>
  );
}

/** The answer to "Taste failure?". */
export function VerdictPills({ verdict, onChange }: { verdict: Verdict | null; onChange: (verdict: Verdict | null) => Promise<void> }) {
  return <ChoicePills options={VERDICT_OPTIONS} value={verdict} onChange={onChange} />;
}

/** The answer to "Accurate?", asked apart from taste. */
export function AccuracyPills({ accuracy, onChange }: { accuracy: Accuracy | null; onChange: (accuracy: Accuracy | null) => Promise<void> }) {
  return <ChoicePills options={ACCURACY_OPTIONS} value={accuracy} onChange={onChange} />;
}
