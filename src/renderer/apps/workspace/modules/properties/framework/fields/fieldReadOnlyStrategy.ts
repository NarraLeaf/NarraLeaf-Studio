import type { ComponentType } from "react";
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

/** Which of the two ways a field of this TYPE has to be made read-only. */
export function fieldTypeReadOnlyStrategy(type: FieldType): FieldReadOnlyStrategy {
    return SELF_READ_ONLY_FIELD_TYPES.has(type) ? "own" : "structural";
}

/**
 * A custom field component that is read-only-aware, and says so.
 *
 * `custom` is one bucket in the table above and it has to be, because the framework cannot see what
 * a caller's component does - so every custom field is clamped. That default is right for the great
 * majority of them and wrong for the ones that only LOOK: the blueprint entry a widget shows in its
 * Interaction tab is a preview and a way into another editor, and a clamped one meant a frozen
 * workspace could not open the blueprint of the element it had selected, which is reading.
 *
 * Declared on the COMPONENT rather than on each field definition, because the definitions are
 * copies: eleven widget inspectors each write their own `interaction.blueprint.readonly` literal,
 * and the twelfth would be written by copying one of them. A flag on the literal is a flag the copy
 * can drop silently; a component that carries its own strategy cannot be pasted without it.
 */
export type ReadOnlyAwareComponent = { readOnlyStrategy?: FieldReadOnlyStrategy };

/**
 * Mark a custom field component as honouring `readOnly` itself, so the framework leaves its subtree
 * alone.
 *
 * Only for components that genuinely do - either because every control in them is inspection (a
 * preview, an entry into another editor) or because they thread `readOnly` down to their own inputs.
 * Getting this wrong offers a write inside a frozen project, which is the one direction this whole
 * pass is not allowed to be wrong in.
 */
export function selfReadOnly<C extends ComponentType<any>>(component: C): C & ReadOnlyAwareComponent {
    return Object.assign(component, { readOnlyStrategy: "own" as const });
}

/** What the framework has to render around a field, given its type and (for `custom`) its component. */
export function fieldReadOnlyStrategy(field: {
    type: FieldType;
    component?: unknown;
}): FieldReadOnlyStrategy {
    if ((field.component as ReadOnlyAwareComponent | undefined)?.readOnlyStrategy === "own") {
        return "own";
    }
    return fieldTypeReadOnlyStrategy(field.type);
}

/** Whether the framework must clamp this field's rendered subtree from outside. */
export function needsStructuralReadOnly(field: { type: FieldType; component?: unknown }): boolean {
    return fieldReadOnlyStrategy(field) === "structural";
}
