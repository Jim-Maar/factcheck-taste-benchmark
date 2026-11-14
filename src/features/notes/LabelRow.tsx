import type { ReactNode } from "react";
import type { Label, Source } from "@cn/core/taste";
import { Button } from "@cn/ui/Button";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";
import { DropdownMenu } from "@cn/ui/DropdownMenu";
import { focusRing } from "@cn/ui/focusRing";
import { AddIcon, CloseIcon, SpeechBubbleIcon } from "@cn/ui/icons";
import { useLabelling, useLabels } from "./useLabelling";

/* The row under a note, where commonnotes.net has its actions (NoteMenu in
 * cn-return-bot): the note's labels as chips, and the menu that adds one. */

const ACTION_ICON_SIZE = "1.15em";
const TOUCH_TARGET = "[@media(pointer:coarse)]:min-h-10";

function LabelChip({ label, onRemove }: { label: Label; onRemove: () => void }) {
  return (
    <span className={cn(chipVariants(), "border-line bg-surface-muted pr-0.5 font-medium text-fg-secondary")}>
      {label.name}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove the label ${label.name}`}
        title={`Remove the label ${label.name}`}
        className={cn("flex h-5 w-5 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg", focusRing)}
      >
        <CloseIcon size={10} aria-hidden />
      </button>
    </span>
  );
}

/** The labels of one note, the Add comment button and the Add label menu. The
 *  menu's search box finds a label by name, and typing a name nobody used yet
 *  offers to create it. `children` come first in the row, such as the Source
 *  details button. Without `onAddComment` the row has no Add comment button,
 *  because the note's comment is already open. */
export function LabelRow({ source, noteId, labels, onAddComment, children }: { source: Source; noteId: string; labels: Label[]; onAddComment?: () => void; children?: ReactNode }) {
  const allLabels = useLabels().data ?? [];
  const { addLabel, removeLabel, createAndAddLabel } = useLabelling(source);
  const onNote = new Set(labels.map((label) => String(label.id)));
  const choose = (selected: string[]) => {
    const picked = new Set(selected);
    for (const label of allLabels) {
      const id = String(label.id);
      if (picked.has(id) && !onNote.has(id)) void addLabel(noteId, label);
      if (!picked.has(id) && onNote.has(id)) void removeLabel(noteId, label);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5 text-xs text-fg-muted">
      {children}
      {labels.map((label) => (
        <LabelChip key={label.id} label={label} onRemove={() => void removeLabel(noteId, label)} />
      ))}
      {onAddComment && (
        <Button variant="link" className={TOUCH_TARGET} onClick={onAddComment}>
          <SpeechBubbleIcon size={ACTION_ICON_SIZE} aria-hidden /> Add comment
        </Button>
      )}
      <DropdownMenu
        label="Labels"
        entries={[
          {
            type: "choice",
            key: "labels",
            multiple: true,
            searchable: true,
            options: allLabels.map((label) => ({ value: String(label.id), label: label.name, count: label.uses })),
            selected: [...onNote],
            onChange: choose,
            onCreate: (name) => void createAndAddLabel(noteId, name),
            createLabel: (name) => `Create label “${name}”`,
          },
        ]}
        trigger={
          <Button variant="link" className={TOUCH_TARGET}>
            <AddIcon size={ACTION_ICON_SIZE} aria-hidden /> Add label
          </Button>
        }
      />
    </div>
  );
}
