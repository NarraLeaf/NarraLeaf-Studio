/**
 * Unified exec + data connection validation (single source for canvas + IR checks).
 * Comments in English per project convention.
 */

import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";

export function isValidBlueprintPinConnection(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
}): boolean {
    const src = blueprintNodeRegistry.resolveCatalogEntry(params.sourceType);
    const tgt = blueprintNodeRegistry.resolveCatalogEntry(params.targetType);
    const outPin = src.pins.find(p => p.id === params.sourcePort && p.kind === "output");
    const inPin = tgt.pins.find(p => p.id === params.targetPort && p.kind === "input");
    if (!outPin || !inPin) {
        return false;
    }
    if (outPin.semantic !== inPin.semantic) {
        return false;
    }
    if (outPin.semantic === "data" && outPin.valueType && inPin.valueType && outPin.valueType !== inPin.valueType) {
        // `json` / `any` are wildcards for polymorphic or literal outputs (e.g. Literal → Branch condition).
        const wild = new Set(["json", "any"]);
        if (!wild.has(outPin.valueType) && !wild.has(inPin.valueType)) {
            return false;
        }
    }
    return true;
}

/** Exec-only shortcut for legacy call sites */
export function isValidBlueprintExecConnection(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
}): boolean {
    return isValidBlueprintPinConnection(params);
}
