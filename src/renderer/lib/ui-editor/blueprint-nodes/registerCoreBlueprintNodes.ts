/**
 * Registers all built-in blueprint nodes (single entry; definitions live under ./built-in).
 * Comments in English per project convention.
 */

import { setBehaviorDataPinResolver } from "../behavior-graph/dataPinResolver";
import { allBuiltinBlueprintNodes } from "./built-in";
import { resolveNodeInput } from "./built-in/graphParamResolvers";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { defineBlueprintNode } from "./defineBlueprintNode";

/**
 * Installed here rather than imported by the executor: `graphParamResolvers`
 * depends on `behavior-graph`, so a direct import would close a module cycle.
 * This function is the one entry every execution environment already calls.
 */
function installDataPinResolver(): void {
    setBehaviorDataPinResolver(resolveNodeInput);
}

export function registerCoreBlueprintNodes(): void {
    installDataPinResolver();
    // Before the loop, and unconditionally: the loop skips types already registered, and data pin
    // resolution needs the built-in set complete whether or not this call did the registering.
    blueprintNodeRegistry.markBuiltIn(allBuiltinBlueprintNodes.map(def => def.type));
    for (const def of allBuiltinBlueprintNodes) {
        if (!blueprintNodeRegistry.get(def.type)) {
            defineBlueprintNode(def);
        }
    }
}
