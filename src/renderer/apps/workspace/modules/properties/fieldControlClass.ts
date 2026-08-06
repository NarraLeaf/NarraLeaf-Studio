/**
 * The properties panel's own text fields, in one place.
 *
 * The same class list was copied into six files (`BasePropertyEditor`, `TextField`,
 * `NumberField`, `TagsField`, …) and had already drifted: the name field padded
 * itself to 38px while the tag field beside it came out at 34px, neither of them
 * on the shared control scale. Nothing about a field is per-file, so the string
 * is not either — the pattern `controlButtonClass` already follows for buttons.
 *
 * Comments in English per project convention.
 */
import { CONTROL_HEIGHT_CLASS } from "@/lib/components/elements";

/** Border, fill, radius and type — everything except how tall the box is. */
const FIELD_BOX_CLASS =
    "bg-surface-raised border border-edge rounded-md text-sm text-fg-muted "
    + "focus:outline-none focus:border-primary/50 transition-colors "
    + "disabled:opacity-50 disabled:cursor-not-allowed";

/** A single-line field, on the shared `md` control height (36px). */
export const FIELD_INPUT_CLASS = `px-3 ${CONTROL_HEIGHT_CLASS.md} ${FIELD_BOX_CLASS}`;

/**
 * A multi-line field. No height floor — `rows` decides that — and the roomier
 * padding a paragraph needs rather than the one that centres a single line.
 */
export const FIELD_TEXTAREA_CLASS = `px-3 py-2 ${FIELD_BOX_CLASS}`;
