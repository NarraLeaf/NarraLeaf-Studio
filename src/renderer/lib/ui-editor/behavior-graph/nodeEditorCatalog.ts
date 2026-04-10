/**
 * Back-compat facade for blueprint node editor metadata.
 * Definitions are owned by BlueprintNodeCatalogService (workspace); this module delegates to it.
 * Comments in English per project convention.
 */

import type { BlueprintGraphKind } from "@shared/types/blueprint/graph";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
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

/** Build palette context from editor tab payload (defaults when unknown). */
export function buildBlueprintPaletteContext(input: {
    graphKind: "event" | "function";
    owner: BlueprintOwnerRef;
    widgetElementType?: string;
    widgetEventLayerSlots?: string[];
    hasEventHead?: boolean;
    hasFunctionEntry?: boolean;
}): BlueprintPaletteContext {
    const gk: BlueprintGraphKind = input.graphKind;
    return {
        graphKind: gk,
        owner: input.owner,
        widgetElementType: input.widgetElementType,
        widgetEventLayerSlots: input.widgetEventLayerSlots,
        hasEventHead: input.hasEventHead,
        hasFunctionEntry: input.hasFunctionEntry,
    };
}

export function resolveBlueprintNodeEditorCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry {
    return catalog().resolveCatalogEntry(type);
}

/** Validates exec→exec or data→data with optional type match */
export function isValidBlueprintExecConnection(params: {
    sourceType: string;
    sourcePort: string;
    targetType: string;
    targetPort: string;
}): boolean {
    catalog().ensureBuiltinsRegistered();
    return isValidBlueprintPinConnectionInner(params);
}

export { isValidBlueprintPinConnection } from "../blueprint-nodes/connectionPolicy";
