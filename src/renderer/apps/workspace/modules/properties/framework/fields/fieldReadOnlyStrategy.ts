import type { FieldType } from "../types";

/**
 * How a field type is actually made read-only.
 *
 * Measured in the running app on a frozen workspace, with one element selected: Position X and Y came
 * back `readOnly: true` while **Rotation and opacity, in the same panel, one row below, reported
 * `readOnly: false, disabled: false` and accepted input.** Position is an `inputGroup`, whose renderer
 * threads `field.readOnly` into each `<input>`; Rotation and opacity are `inlineRow`s, whose items are
 * arbitrary JSX supplied by the caller's `render` callback - there is nothing for the framework to
 * thread the flag into, so the flag was simply dropped.
 *
 * Hence two strategies rather than a fix at the two call sites: patching Rotation and opacity would
 * have left the other sixteen `inlineRow` definitions (and every `custom` field) in the same state, and
 * the next one written would join them.
 *
 *  - `"own"`: the field's renderer honours `field.readOnly` itself.
 *  - `"structural"`: the framework has to clamp the rendered subtree from outside, because the field
 *    hands rendering to its caller.
 *
 * **The table names the `"own"` types, and everything else is `"structural"`.** Same rule as the rest
 * of the freeze pass: an unlisted or newly added field type gets the clamp rather than silently staying
 * writable. Over-clamping greys out a control that was already read-only; under-clamping offers a
 * write inside a frozen project.
 */
export type FieldReadOnlyStrategy = "own" | "structural";

/**
 * The field types whose own renderer passes `readOnly` down to its inputs.
 *
 * Verified by reading each renderer: `TextField` and `NumberField` read `field.readOnly`,
 * `InputGroupField` uses `field.readOnly || item.readOnly` per input, `ColorPickerField` passes it to
 * both of its inputs, and `FieldRenderer` passes it to the `fontAsset` field.
 */
const SELF_READ_ONLY_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
    "text",
    "textarea",
    "number",
    "inputGroup",
    "colorPicker",
    "fontAsset",
    // Purely presentational - there is nothing to write, so a clamp would only add a wrapper.
    "info",
    "thumbnail",
    "section",
]);

/** Which of the two ways `field` has to be made read-only. */
export function fieldReadOnlyStrategy(type: FieldType): FieldReadOnlyStrategy {
    return SELF_READ_ONLY_FIELD_TYPES.has(type) ? "own" : "structural";
}

/** Whether the framework must clamp this field's rendered subtree from outside. */
export function needsStructuralReadOnly(type: FieldType): boolean {
    return fieldReadOnlyStrategy(type) === "structural";
}
