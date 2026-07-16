/**
 * Preview card for a Story Action Blueprint (a graph blueprint whose single "On Call" layer is the
 * one referenced by story actions and inline interpolations). Renders a live mini graph preview of
 * that layer and opens the blueprint editor on click. This mirrors the UI editor's Page/surface
 * blueprint entry (`SurfaceBlueprintEntrySection`) so every blueprint entry looks and behaves the
 * same way. Comments in English per project convention.
 */

import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
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
    /** Preview height; defaults to the standard entry height. */
    heightClassName?: string;
    /**
     * "mini" (default): compact abstract preview for inline value entries. "detailed": a larger card
     * that renders real node titles + pins — used by the condition entry so the graph is readable.
     */
    variant?: "mini" | "detailed";
    /** Accessible label; defaults to the story-action wording. */
    ariaLabel?: string;
}) {
    const { t } = useTranslation();
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
        <div className="space-y-2 rounded-lg border border-edge bg-surface px-3 py-3">
            <button
                type="button"
                className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
                onClick={props.onOpen}
                aria-label={props.ariaLabel ?? (props.blueprintId ? t("story.blueprintCard.openAria") : t("story.blueprintCard.createAria"))}
            >
                <BlueprintLayerPreview model={previewModel} heightClassName={props.heightClassName} variant={props.variant ?? "mini"} />
            </button>
        </div>
    );
}
