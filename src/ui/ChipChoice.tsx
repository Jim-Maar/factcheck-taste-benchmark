import { chipVariants } from "./Chip";
import { cn } from "./cn";

/** A row of chips of which one is on, such as the chart type or the judge. */
export function ChipChoice<T extends string>({ options, value, onChange, label }: { options: { id: T; name: string }[]; value: T; onChange: (id: T) => void; label: string }) {
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
