import { useEffect, useMemo, useState } from "react";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UISurface, UISurfaceKind } from "@shared/types/ui-editor/document";
import { useRegistry } from "../../registry";
import { UISurfaceEditorTab } from "./editors/UISurfaceEditorTab";

type SurfaceKindOption = {
    kind: UISurfaceKind;
    label: string;
    description: string;
};

const SURFACE_KIND_OPTIONS: SurfaceKindOption[] = [
    {
        kind: "appSurface",
        label: "App Surface",
        description: "App Surface is the main surface for the application.",
    },
    {
        kind: "playerStageSurface",
        label: "Player Stage",
        description: "Player Stage Surface is the main surface for the player.",
    },
    {
        kind: "playerOverlaySurface",
        label: "Player Overlay",
        description: "Player Overlay Surface is the overlay surface for the player.",
    },
];

const formatSurfaceLabel = (surface: UISurface) => `${surface.name} (${surface.kind})`;

export function UISurfacesPanel({ panelId }: PanelComponentProps) {
    const { context } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const [surfaces, setSurfaces] = useState<UISurface[]>([]);
    const [kind, setKind] = useState<UISurfaceKind>("appSurface");

    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context) return null;
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context]);

    useEffect(() => {
        if (!documentService) return;

        const refresh = () => {
            const doc = documentService.getDocument();
            setSurfaces(doc.surfaces);
        };

        refresh();

        const unsubscribe = documentService.onDocumentChanged?.(refresh);
        return () => {
            unsubscribe?.();
        };
    }, [documentService]);

    const filteredSurfaces = useMemo(() => surfaces.filter(surface => surface.kind === kind), [surfaces, kind]);

    const handleOpenSurface = (surface: UISurface) => {
        const tabId = `ui-editor:surface:${surface.id}`;
        openEditorTab({
            id: tabId,
            title: surface.name,
            component: UISurfaceEditorTab,
            payload: { surfaceId: surface.id },
            closable: true,
            modified: false,
        });
    };

    return (
        <div className="h-full flex flex-col">
            <div className="px-2 pt-2 pb-1">
                <div className="text-xs font-semibold uppercase text-gray-400">Surface Type</div>
                <div className="mt-2 flex gap-2">
                    {SURFACE_KIND_OPTIONS.map(option => (
                        <button
                            key={option.kind}
                            type="button"
                            className={`flex-1 rounded-md px-2 py-1 text-xs font-medium border ${
                                kind === option.kind ? "border-primary bg-primary/10 text-white" : "border-white/10 text-gray-300"
                            }`}
                            onClick={() => setKind(option.kind)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="px-2 mt-4 text-xs text-gray-500">Click a surface to open the corresponding editor tab</div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
                {filteredSurfaces.length === 0 && (
                    <div className="text-xs text-gray-500">No surfaces of this type available</div>
                )}
                {filteredSurfaces.map(surface => (
                    <button
                        key={surface.id}
                        type="button"
                        className="w-full text-left rounded-md border border-white/10 bg-[#11131a] px-3 py-2 hover:border-primary transition-colors"
                        onClick={() => handleOpenSurface(surface)}
                    >
                        <div className="text-sm font-semibold text-white">{surface.name}</div>
                        <div className="text-[11px] text-gray-400">{surface.designSize.width}×{surface.designSize.height}</div>
                        <div className="text-[11px] text-gray-500">{surface.host}</div>
                    </button>
                ))}
            </div>
        </div>
    );
}
