import { LABEL_DEFINITIONS, labelDefinition } from "@cn/core/labelDefinitions";
import { useLabels } from "./useLabelling";

/** "What the labels mean": a closed disclosure under the labels that lists
 *  every label with its one-line definition, so a labeller can read them all
 *  at once. It lists the labels in use first, then any defined label nobody
 *  has used yet. A label without a definition says so. */
export function LabelGuide() {
  const used = (useLabels().data ?? []).map((label) => label.name);
  const usedKeys = new Set(used.map((name) => name.toLowerCase()));
  const names = [...used, ...Object.keys(LABEL_DEFINITIONS).filter((key) => !usedKeys.has(key))];
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-fg-muted hover:text-fg-secondary">What the labels mean</summary>
      <dl className="mt-1.5 space-y-1.5">
        {names.map((name) => (
          <div key={name}>
            <dt className="font-semibold text-fg-secondary">{name}</dt>
            <dd className="text-fg-muted">{labelDefinition(name) ?? "No definition yet."}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
