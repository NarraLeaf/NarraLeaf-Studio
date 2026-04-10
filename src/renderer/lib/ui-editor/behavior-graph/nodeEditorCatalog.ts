/**
 * Back-compat facade for blueprint node editor metadata.
 * Canonical definitions live in `blueprint-nodes/`.
 * Comments in English per project convention.
 */

import type { BlueprintGraphKind } from "@shared/types/blueprint/graph";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { blueprintNodeRegistry } from "../blueprint-nodes/BlueprintNodeRegistry";
// register built-in blueprint nodes
import "./builtinNodes";
import {
    isValidBlueprintExecConnection as isValidBlueprintPinConnectionInner,
} from "../blueprint-nodes/connectionPolicy";
import type {
    BlueprintNodeEditorCatalogEntry,
    BlueprintPaletteContext,
    BlueprintPinSemantic,
} from "../blueprint-nodes/types";

export type { BlueprintPinSemantic, BlueprintNodeEditorCatalogEntry };

export function getBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry | undefined {
    const def = blueprintNodeRegistry.get(type);
    return def ? blueprintNodeRegistry.toCatalogEntry(def) : undefined;
}

export function listBlueprintNodePaletteEntries(ctx: BlueprintPaletteContext): BlueprintNodeEditorCatalogEntry[] {
    return blueprintNodeRegistry.listPaletteEntries(ctx);
}

/** Build palette context from editor tab payload (defaults when unknown). */
export function buildBlueprintPaletteContext(input: {
    graphKind: "event" | "function";
    owner: BlueprintOwnerRef;
    widgetElementType?: string;
    hasEventHead?: boolean;
    hasFunctionEntry?: boolean;
}): BlueprintPaletteContext {
    const gk: BlueprintGraphKind = input.graphKind;
    return {
        graphKind: gk,
        owner: input.owner,
        widgetElementType: input.widgetElementType,
        hasEventHead: input.hasEventHead,
        hasFunctionEntry: input.hasFunctionEntry,
    };
}

export function resolveBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry {
    return blueprintNodeRegistry.resolveCatalogEntry(type);
}

/** Validates exec→exec or data→data with optional type match */
export function isValidBlueprintExecConnection(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
}): boolean {
    return isValidBlueprintPinConnectionInner(params);
}

export { isValidBlueprintPinConnection } from "../blueprint-nodes/connectionPolicy";
