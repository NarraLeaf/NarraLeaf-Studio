/**
 * The sentences the game app refuses a node with.
 *
 * A node that drives the running game - `Next`, `Start Game`, `Set Saved Var` - reaches one of this
 * app's host functions, and what that function throws is what the node reports: the Dev Mode Issues
 * panel shows it under the page the node is on, a shipped build writes it to the log. So it is worded
 * from the catalog like every other node failure (`blueprint.runtimeError.*`), names the node by its
 * canvas title, and carries no id.
 *
 * Comments in English per project convention.
 */

import { translate } from "@/lib/i18n";
import type { InterpolationParams, TranslationKey } from "@shared/i18n";

/**
 * "“Next” needs a running game." `node` is the catalog key of what asked (a node's title, or a Dev
 * Mode menu item's label); null when the asker is not one thing an author placed.
 */
export function needsRunningGame(node: TranslationKey | null): Error {
    return new Error(node
        ? translate("blueprint.runtimeError.needsGame", { node: translate(node) })
        : translate("blueprint.runtimeError.needsGameAny"));
}

/** A refusal worded from `key`, with the asking node's title as `{node}`. */
export function refusal(key: TranslationKey, node: TranslationKey, params?: InterpolationParams): Error {
    return new Error(translate(key, { ...params, node: translate(node) }));
}
