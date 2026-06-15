import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { buildReadonlySurfaceMainSummary } from "@/lib/workspace/services/ui-editor/blueprint/readonlyBlueprintSummary";
import { collectSubtreeElements } from "./collectSubtreeElements";
import { collectLinkDiagnostics } from "./rules/linkDiagnostics";
import { collectResourceDiagnostics } from "./rules/resourceDiagnostics";
import { collectStageDiagnostics } from "./rules/stageDiagnostics";
import { collectLayoutDiagnostics } from "./rules/layoutDiagnostics";
import { collectInteractionDiagnostics } from "./rules/interactionDiagnostics";
import type { UISurfaceDiagnostic } from "./types";
import { sortSurfaceDiagnostics } from "./types";

export type CollectSurfaceDiagnosticsOptions = {
    blueprintDocument?: BlueprintDocument;
};

export function collectSurfaceDiagnostics(
    document: UIDocument,
    surfaceId: string,
    options?: CollectSurfaceDiagnosticsOptions,
): UISurfaceDiagnostic[] {
    const surface = document.surfaces.find(s => s.id === surfaceId);
    if (!surface) {
        return [
            {
                id: `surface:missing:${surfaceId}`,
                severity: "error",
                source: "layout",
                message: "Surface not found in document",
            },
        ];
    }

    const rootId = resolveSurfaceRootElementId(document, surfaceId);
    const elements = collectSubtreeElements(document, rootId);

    const parts: UISurfaceDiagnostic[] = [
        ...collectLinkDiagnostics(document, surface),
        ...collectStageDiagnostics(surface),
        ...collectResourceDiagnostics(elements),
        ...collectLayoutDiagnostics(document, surface, elements),
        ...collectInteractionDiagnostics(document, elements),
    ];

    const bp = options?.blueprintDocument;
    if (bp) {
        const sum = buildReadonlySurfaceMainSummary(bp, surfaceId);
        if (sum.brokenBindingCount > 0) {
            parts.push({
                id: `bp:broken:${surfaceId}`,
                severity: "warning",
                source: "blueprint",
                message: `Surface blueprint has ${sum.brokenBindingCount} broken binding(s)`,
                hint: "Fix bindings in the Blueprint editor or Dev Mode for runtime behavior.",
            });
        }
    }

    return sortSurfaceDiagnostics(parts);
}
