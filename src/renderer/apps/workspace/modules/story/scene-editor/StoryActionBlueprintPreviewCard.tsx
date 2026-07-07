/**
 * Preview card for a Story Action Blueprint (a graph blueprint whose single "On Call" layer is the
 * one referenced by story actions and inline interpolations). Renders a live mini graph preview of
 * that layer and opens the blueprint editor on click. This mirrors the UI editor's Page/surface
 * blueprint entry (`SurfaceBlueprintEntrySection`) so every blueprint entry looks and behaves the
 * same way. Comments in English per project convention.
 */

import { useMemo, type ReactNode } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import {
    BlueprintLayerPreview,
    resolveFirstBlueprintLayerPreview,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintLayerPreview";

export function StoryActionBlueprintPreviewCard(props: {
    /** Owner blueprint id; may be empty (the card stays clickable so `onOpen` can create it). */
    blueprintId: string;
    /** Ensure the blueprint exists (when needed) and open its editor. */
    onOpen: () => void;
    /** Optional footer note, e.g. "On Call → value" for inline interpolation. */
    note?: ReactNode;
    /** Preview height; defaults to the standard entry height. */
    heightClassName?: string;
}) {
    const { context, isInitialized } = useWorkspace();
    const blueprintRevision = useBlueprintDocumentRevision();
    const localBp =
        isInitialized && context ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint) : null;
    const nodeCatalog =
        isInitialized && context ? context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog) : null;
    const previewModel = useMemo(
        () => resolveFirstBlueprintLayerPreview(localBp, nodeCatalog, props.blueprintId || undefined),
        [localBp, nodeCatalog, props.blueprintId, blueprintRevision],
    );

    return (
        <div className="space-y-2 rounded-lg border border-white/10 bg-[#111315] px-3 py-3">
            <button
                type="button"
                className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70"
                onClick={props.onOpen}
                aria-label={props.blueprintId ? "Open story action blueprint" : "Create story action blueprint"}
            >
                <BlueprintLayerPreview model={previewModel} heightClassName={props.heightClassName} />
            </button>
            {props.note ? <div className="text-[10px] leading-snug text-slate-500">{props.note}</div> : null}
        </div>
    );
}
