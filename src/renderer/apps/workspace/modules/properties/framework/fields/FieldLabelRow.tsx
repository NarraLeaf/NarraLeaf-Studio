import { HintPopover } from "@/lib/components/elements";
import type { BaseFieldDefinition } from "../types";
import { useComparisonFieldMark } from "./comparisonFieldMarks";

interface FieldLabelRowProps {
    field: BaseFieldDefinition;
    /** The control the label names, for the fields that give theirs an id. */
    htmlFor?: string;
}

/**
 * The label above a field, and the hint icon when the field carries one.
 *
 * The icon sits beside the label rather than inside it: a `<label>` passes a click to the control it
 * names, so a button inside one would toggle the setting on the way to explaining it. Same shape the
 * project settings rows use, so a hint reads the same wherever it is.
 *
 * Inside a comparison it also carries the mark for a value the other version holds differently. A
 * dot rather than a second value: the row shows the version the author picked and only that one (see
 * `comparisonFieldMarks`), and the counterpart is on the hover. `data-tip`, so it is drawn by
 * Studio's own tooltip like every other one, and the same sentence is the dot's accessible name, so
 * it is not only available to a pointer.
 */
export function FieldLabelRow({ field, htmlFor }: FieldLabelRowProps) {
    const mark = useComparisonFieldMark(field.id);
    if (!field.label) {
        return null;
    }
    return (
        <div className="mb-1 flex items-center gap-1.5">
            <label htmlFor={htmlFor} className="text-xs font-medium text-fg-muted">
                {field.label}
            </label>
            {mark ? (
                <span
                    role="img"
                    aria-label={mark.tip}
                    data-tip={mark.tip}
                    data-comparison-differs
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                />
            ) : null}
            {field.tip ? <HintPopover text={field.tip} /> : null}
        </div>
    );
}
