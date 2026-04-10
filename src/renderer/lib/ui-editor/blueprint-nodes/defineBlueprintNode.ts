/**
 * Public API: register a blueprint node with a single definition object.
 * Comments in English per project convention.
 */

import type { BlueprintNodeDef } from "./types";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";

export function defineBlueprintNode(def: BlueprintNodeDef): void {
    blueprintNodeRegistry.register(def);
}

export function defineBlueprintNodes(defs: BlueprintNodeDef[]): void {
    blueprintNodeRegistry.registerMany(defs);
}
