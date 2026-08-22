import { HintPopover } from "@/lib/components/elements";
import type { BaseFieldDefinition } from "../types";

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
 */
export function FieldLabelRow({ field, htmlFor }: FieldLabelRowProps) {
    if (!field.label) {
        return null;
    }
    return (
        <div className="mb-1 flex items-center gap-1.5">
            <label htmlFor={htmlFor} className="text-xs font-medium text-fg-muted">
                {field.label}
            </label>
            {field.tip ? <HintPopover text={field.tip} /> : null}
        </div>
    );
}
