/**
 * Back-compat facade for blueprint node editor metadata.
 * Definitions are owned by BlueprintNodeCatalogService (workspace); this module delegates to it.
 * Comments in English per project convention.
 */

import { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import {
    isValidBlueprintExecConnection as isValidBlueprintPinConnectionInner,
} from "../blueprint-nodes/connectionPolicy";
import type {
    BlueprintNodeEditorCatalogEntry,
    BlueprintPaletteContext,
    BlueprintPinSemantic,
} from "../blueprint-nodes/types";

export type { BlueprintPinSemantic, BlueprintNodeEditorCatalogEntry };

function catalog(): BlueprintNodeCatalogService {
    return BlueprintNodeCatalogService.getInstance();
}

export function getBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry | undefined {
    return catalog().getBlueprintNodeEditorCatalogEntry(type);
}

export function listBlueprintNodePaletteEntries(ctx: BlueprintPaletteContext): BlueprintNodeEditorCatalogEntry[] {
    return catalog().listPaletteEntries(ctx);
}

/**
 * Palette context for a graph. Re-exported here because this module is what the editor imports its
 * node metadata from; the derivation itself lives beside the rule it feeds.
 */
export { buildBlueprintGraphContext } from "../blueprint-nodes/graphContext";
export type { BlueprintGraphContextInput } from "../blueprint-nodes/graphContext";

export function resolveBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry {
    return catalog().resolveCatalogEntry(type);
}

export function resolveBlueprintNodeEditorCatalogEntryForNode(
    type: string,
    params?: Record<string, unknown>,
): BlueprintNodeEditorCatalogEntry {
    return catalog().resolveCatalogEntryForNode(type, params);
}

/** Validates exec→exec or data→data with optional type match */
export function isValidBlueprintExecConnection(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
    sourceParams?: Record<string, unknown>;
    targetParams?: Record<string, unknown>;
}): boolean {
    catalog().ensureBuiltinsRegistered();
    return isValidBlueprintPinConnectionInner(params);
}

export { isValidBlueprintPinConnection } from "../blueprint-nodes/connectionPolicy";
