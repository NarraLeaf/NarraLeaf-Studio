/**
 * Nodes that read the project's input-action vocabulary.
 *
 * An action is a name the project gives to a gesture - "advance", "open the log", "dismiss" - and
 * the bindings that raise it live on the vocabulary entry and on each surface's answer to it, never
 * on the graph. That is what these nodes exist for: an author picks the action by name and the
 * binding behind it stays the project's business.
 *
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
    BLUEPRINT_NODE_TYPE_INPUT_GET_DEVICE,
    BLUEPRINT_NODE_TYPE_INPUT_IS_ACTION_HELD,
} from "@shared/types/blueprint/graph";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type {
    BlueprintInspectorParamDef,
    BlueprintInspectorParamSelectOption,
    BlueprintNodeDef,
} from "../types";

/**
 * The id the action pickers fill their options from.
 *
 * A dynamic source rather than a static option list, for the same reason the list field pickers use
 * one: the vocabulary is a table the author edits, so nothing baked in at module load could ever be
 * right. The stored value is the entry's key, which is also its id - renaming an action's
 * author-facing name therefore leaves every graph pointing at it.
 */
export const BLUEPRINT_INPUT_ACTION_OPTIONS_SOURCE = "inputActions";

/** The `Action` picker, shared by every node that is about one action. */
export function inputActionParam(label = "Action"): BlueprintInspectorParamDef {
    return {
        key: BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
        label,
        kind: "select",
        dynamicOptionsSource: BLUEPRINT_INPUT_ACTION_OPTIONS_SOURCE,
    };
}

/**
 * The vocabulary as an action picker offers it.
 *
 * Ordered by the name an author reads rather than by id, because the ids are slugs the panel mints
 * and nobody scans a list by them. The two labels are passed in rather than translated here: this
 * module is imported by the node registry, which the build and the CLI load without a locale.
 *
 * `pickedId` is what the node currently stores. When it names an action the project no longer has,
 * the id is kept in the list rather than dropped - a `<select>` whose value is absent from its
 * options falls back to the empty entry, which would make a broken reference look like a node
 * nobody had finished filling in.
 */
export function listBlueprintInputActionOptions(input: {
    document: Pick<UIDocument, "actions">;
    pickedId?: string;
    unnamedLabel: string;
    missingLabel: (id: string) => string;
}): BlueprintInspectorParamSelectOption[] {
    const options = Object.values(input.document.actions ?? {})
        .map(action => ({ value: action.id, label: action.name.trim() || input.unnamedLabel }))
        .sort((a, b) => a.label.localeCompare(b.label));
    const pickedId = input.pickedId?.trim();
    if (pickedId && !options.some(option => option.value === pickedId)) {
        options.push({ value: pickedId, label: input.missingLabel(pickedId) });
    }
    return options;
}

/**
 * The input router's read side, as the pin resolver needs it.
 *
 * Named here rather than reached for on the host API type because the router that answers it lives
 * on the runtime side of the boundary: this file is the catalogue's statement of what it will ask
 * for, and a host without the family answers false rather than nothing at all (see
 * `resolveInputActionNodeOutput`).
 */
export type BlueprintInputActionHostApi = {
    /**
     * Whether the player is holding a gesture that raises this action right now.
     *
     * The bindings are the ones the asking surface resolves - its own when it overrides or extends
     * the project's, the project's otherwise - so a surface that has taken an action's gestures away
     * reads it as never held, exactly as it fires nothing. A key or a mouse button can be held; a
     * wheel notch and a double click cannot, and never answer.
     */
    isActionHeld?: (actionId: string) => boolean;
    /**
     * Which device the player is using at this moment.
     *
     * One of the four values the `On Action` head's `source` pin carries, so a graph tests both
     * against the same literals. It is the player's last-used hardware rather than what a binding
     * could accept, because only the first tells an interface which word to print.
     */
    getDevice?: () => string;
};

export const inputActionBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_INPUT_IS_ACTION_HELD,
        displayName: "Is Action Held",
        category: "Input",
        keywords: ["input", "action", "held", "down", "pressed", "hold", "gesture"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        // No scope: it answers about the player's hands rather than about any one element, so a
        // widget's own graph reads it to decide whether a press became a hold just as readily as a
        // surface graph does. Pure, so it may also stand behind a bound pin - "dim this while the
        // gesture is held" is the binding it exists for.
        pins: [{ id: "held", kind: "output", semantic: "data", valueType: "boolean", label: "Held" }],
        inspectorParams: [inputActionParam()],
        execute: () => ({}),
    },
    {
        type: BLUEPRINT_NODE_TYPE_INPUT_GET_DEVICE,
        displayName: "Get Input Device",
        category: "Input",
        // English only, as everywhere in the catalogue: the palette searches the localized title
        // too, so a translated name is what a query in another language matches on.
        keywords: [
            "input", "device", "pointer", "mouse", "keyboard", "key", "touch", "tap", "click",
            "platform", "mobile", "desktop",
        ],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        // No scope, for the reason `Is Action Held` has none: it answers about the player rather
        // than about any one element. Pure, so a prompt's text may be bound straight to it.
        //
        // `device` carries the same four values as the `source` pin on the `On Action` head, and
        // reads as a plain string so both are compared the same way. All four are in the domain
        // from the first day even though nothing produces every one of them yet: a pin's set of
        // values can be narrowed later - graphs switching on the survivors keep working - but never
        // widened, because a graph written against a smaller set has no branch for a value that
        // did not exist when it was authored, and would fall through in silence.
        pins: [{ id: "device", kind: "output", semantic: "data", valueType: "string", label: "Device" }],
        execute: () => ({}),
    },
];
