/**
 * A data input pin nobody filled in.
 *
 * "Why does my button do nothing" is most often this: a `Set Text` whose Element pin has no edge
 * runs, resolves `undefined`, and writes nothing. Nothing throws, so the graph editor, the lint
 * report and the shipped game were all silent about it. This module is the one judgement all of
 * them ask, so the canvas marker, the lint row, the Dev Mode issue and the player's log cannot
 * disagree about which pin is missing.
 *
 * It lives under `blueprint-nodes` because the game runtime bundles this tree and may not reach the
 * workspace services the editor's validator sits in (see `project/build/runtime-alias-plugin.js`).
 */

import type { TranslationKey } from "@shared/i18n";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { resolveEffectiveBlueprintNodePins, saveSchemaFieldIdFromPin } from "./effectivePins";

/** One unwired pin, named the way its node declares it (English; see the note on the key below). */
export type BlueprintUnwiredRequiredPin = {
    pinId: string;
    /** The pin's label, or its id when a node declared none. */
    label: string;
};

/**
 * The sentence every surface says, so that four reports of one fault read as one fault.
 *
 * Shared as a key rather than as a rendered string because two of the four callers are not allowed
 * to render one: a lint rule may not build prose (the locale belongs to whoever renders the report),
 * and the shipped runtime speaks the machine's language rather than the author's. The lint rule
 * therefore keeps its own key with the same wording; the other three interpolate this one.
 */
export const BLUEPRINT_INPUT_MISSING_MESSAGE_KEY = "blueprint.diagnostics.node.inputMissing" as TranslationKey;

/**
 * The data input pins of one node that will resolve to nothing when it runs.
 *
 * **What makes a pin required** is read off the node's own definition, never off a list kept here:
 *
 *  - it is a **data input** - an exec pin is a wire, not a value, and an output is not asked for;
 *  - the definition does **not mark it `optional`** - forty-odd pins already do, and they are
 *    exactly the ones that fall back to an inspector param or to a runtime default when absent
 *    (`Play Sound`'s Volume, `Save Game`'s Slot, `Go Page`'s Page). A node type that legitimately
 *    accepts an absent input says so there, in one place, rather than being excepted here;
 *  - the node carries **no literal for it**. `resolveDataPinValue` falls back to `params[pinId]`
 *    when no edge feeds a pin, so a value typed on the card or picked in the inspector is a real
 *    answer and not a missing one. An empty string counts as an answer: an author who cleared a
 *    field chose the empty string.
 *
 * Two kinds of pin are left out because another report already owns them, and one node reported
 * twice with two explanations is worse than one report:
 *
 *  - a **`valueReturn`** node's Value pin, which is `condition.return_missing`;
 *  - a **save-schema** pin, which is `blueprint/save-field-empty` - and that one is an error,
 *    because the read side promises every declared field always has a value.
 *
 * A node whose type the registry does not know returns nothing: it has no declared pins to judge,
 * and `node.unknown_type` / `blueprint/unknown-node` already name it.
 */
export function listUnwiredRequiredInputPins(
    type: string,
    params: Record<string, unknown> | undefined,
    isPinWired: (pinId: string) => boolean,
): BlueprintUnwiredRequiredPin[] {
    const def = blueprintNodeRegistry.get(type);
    if (!def || def.role === "valueReturn") {
        return [];
    }
    const out: BlueprintUnwiredRequiredPin[] = [];
    for (const pin of resolveEffectiveBlueprintNodePins(def, params)) {
        if (pin.kind !== "input" || pin.semantic !== "data" || pin.optional) {
            continue;
        }
        if (saveSchemaFieldIdFromPin(pin.id) !== null) {
            continue;
        }
        if (params?.[pin.id] !== undefined || isPinWired(pin.id)) {
            continue;
        }
        out.push({ pinId: pin.id, label: pin.label ?? pin.id });
    }
    return out;
}

/** The node's own display name, or the raw type when the registry does not know it. */
export function blueprintNodeDisplayName(type: string): string {
    return blueprintNodeRegistry.get(type)?.displayName ?? type;
}
