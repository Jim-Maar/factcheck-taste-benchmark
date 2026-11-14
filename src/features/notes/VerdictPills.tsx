import { useState } from "react";
import { cva } from "class-variance-authority";
import type { Verdict } from "@cn/core/taste";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";
import { CheckIcon, CloseIcon } from "@cn/ui/icons";

/* The answer to "Taste failure?", drawn with commonnotes.net's rating pills
 * (VoteRatings in cn-return-bot, in its colourful palette). Yes means the note
 * is a taste failure, so it takes the red of a Not helpful rating, and No the
 * green of a Helpful one. Somewhat takes the amber of a Somewhat helpful
 * rating, and Unsure stays grey. */
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

/** The two verdict pills. Clicking the chosen pill again clears the verdict.
 *  While a click is being saved both pills wait. */
export function VerdictPills({ verdict, onChange }: { verdict: Verdict | null; onChange: (verdict: Verdict | null) => Promise<void> }) {
  const [saving, setSaving] = useState(false);
  const choose = async (value: Verdict) => {
    setSaving(true);
    try {
      await onChange(verdict === value ? null : value);
    } finally {
      setSaving(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {VERDICT_OPTIONS.map(({ value, label, meaning, tone, icon }) => (
        <button
          key={value}
          type="button"
          disabled={saving}
          aria-pressed={verdict === value}
          aria-label={`${label}, ${meaning.toLowerCase()}`}
          onClick={() => void choose(value)}
          className={verdictPillVariants({ tone, selected: verdict === value })}
        >
          {verdict === value && icon}
          {label}
        </button>
      ))}
    </span>
  );
}
