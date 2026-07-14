/**
 * Registers all built-in blueprint nodes (single entry; definitions live under ./built-in).
 * Comments in English per project convention.
 */

import { allBuiltinBlueprintNodes } from "./built-in";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { defineBlueprintNode } from "./defineBlueprintNode";

export function registerCoreBlueprintNodes(): void {
    for (const def of allBuiltinBlueprintNodes) {
        if (!blueprintNodeRegistry.get(def.type)) {
            defineBlueprintNode(def);
        }
    }
}
