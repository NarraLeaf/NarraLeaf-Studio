/**
 * Registers all built-in blueprint nodes (single entry; definitions live under ./built-in).
 * Comments in English per project convention.
 */

import { allBuiltinBlueprintNodes } from "./built-in";
import { defineBlueprintNodes } from "./defineBlueprintNode";

let installed = false;

export function registerCoreBlueprintNodes(): void {
    if (installed) {
        return;
    }
    installed = true;

    defineBlueprintNodes(allBuiltinBlueprintNodes);
}
