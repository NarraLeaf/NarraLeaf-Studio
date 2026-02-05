import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UISurface, UISurfaceKind, UIHost } from "@shared/types/ui-editor/document";
import { useRegistry } from "../../registry";
import { UISurfaceEditorTab } from "./editors/UISurfaceEditorTab";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { MoreVertical, PanelsTopLeft, Plus } from "lucide-react";
import { UIService } from "@/lib/workspace/services/core/UIService";

type SurfaceKindOption = {
    kind: UISurfaceKind;
    label: string;
    description: string;
    host: UIHost;
};

const SURFACE_KIND_OPTIONS: SurfaceKindOption[] = [
    {
        kind: "appSurface",
        label: "App",
        description: "App Surface is the main surface for the application.",
        host: "app",
    },
    {
        kind: "playerStageSurface",
        label: "Stage",
        description: "Player Stage Surface is the main surface for the player.",
        host: "player",
    },
    {
        kind: "playerOverlaySurface",
        label: "Overlay",
        description: "Player Overlay Surface is the overlay surface for the player.",
        host: "player",
    },
];

const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const getSurfaceTabId = (surfaceId: string) => `${SURFACE_TAB_PREFIX}${surfaceId}`;
const formatSurfaceLabel = (surface: UISurface) => `${surface.name} (${surface.kind})`;

export function UISurfacesPanel({ panelId }: PanelComponentProps) {
    const { context } = useWorkspace();
    const { openEditorTab, closeEditorTab } = useRegistry();
    const [surfaces, setSurfaces] = useState<UISurface[]>([]);
    const [kind, setKind] = useState<UISurfaceKind>("appSurface");
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);

    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context) return null;
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context]);
    const uiService = useMemo<UIService | null>(() => {
        if (!context) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context]);

    useEffect(() => {
        if (!documentService) return;

        const refresh = () => {
            const doc = documentService.getDocument();
            setSurfaces([...doc.surfaces]);
        };

        refresh();

        const unsubscribe = documentService.onDocumentChanged?.(refresh);
        return () => {
            unsubscribe?.();
        };
    }, [documentService]);

    const filteredSurfaces = useMemo(() => surfaces.filter(surface => surface.kind === kind), [surfaces, kind]);
    const currentKindOption = useMemo(() => SURFACE_KIND_OPTIONS.find(option => option.kind === kind), [kind]);

    const handleOpenSurface = useCallback((surface: UISurface) => {
        const tabId = getSurfaceTabId(surface.id);
        openEditorTab({
            id: tabId,
            title: surface.name,
            icon: <PanelsTopLeft className="w-4 h-4" />,
            component: UISurfaceEditorTab,
            payload: { surfaceId: surface.id },
            closable: true,
            modified: false,
        });
    }, [openEditorTab]);

    const handleDeleteSurface = useCallback(async (surface: UISurface) => {
        if (!documentService || !uiService) {
            return;
        }
        const document = documentService.getDocument();
        const root = document.elements[surface.rootElementId];
        const hasChildren = Boolean(root && root.childrenIds.length > 0);
        const confirmed = await uiService.showConfirm(
            "Delete surface?",
            hasChildren ? "This will remove all elements on the surface." : undefined
        );
        if (!confirmed) {
            return;
        }
        documentService.deleteSurface(surface.id);
        closeEditorTab(getSurfaceTabId(surface.id));
        const remaining = documentService.getDocument().surfaces.filter(next => next.kind === surface.kind);
        if (remaining.length > 0) {
            handleOpenSurface(remaining[0]);
        }
    }, [documentService, uiService, handleOpenSurface, closeEditorTab]);

    const handleOpenMenu = useCallback((event: React.MouseEvent, surface: UISurface) => {
        event.stopPropagation();
        const items: ContextMenuDef = [
            {
                id: "open-surface",
                label: "Open Surface",
                onClick: () => handleOpenSurface(surface),
            },
            {
                id: "surface-separator",
                separator: true,
            },
            {
                id: "delete-surface",
                label: "Delete Surface",
                onClick: () => {
                    void handleDeleteSurface(surface);
                },
            },
        ];
        setMenuItems(items);
        showMenu(event);
    }, [showMenu, handleOpenSurface, handleDeleteSurface]);

    const handleCreateSurface = () => {
        if (!documentService || !currentKindOption) {
            return;
        }
        const document = documentService.getDocument();
        const existingCount = document.surfaces.filter(surface => surface.kind === kind).length;
        const name = `${currentKindOption.label} ${existingCount + 1}`;
        const surface = documentService.createSurface(kind, name, currentKindOption.host);
        void documentService.save(documentService.getDocument()).catch(err => {
            console.warn("[UISurfacesPanel] failed to save surface", err);
        });
        handleOpenSurface(surface);
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

            <div className="px-2 mt-2">
                <button
                    type="button"
                    onClick={handleCreateSurface}
                    disabled={!documentService || !currentKindOption}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-white/20 bg-[#11131a] px-3 py-2 text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:border-primary hover:text-white hover:bg-[#1a1d26]"
                >
                    <Plus className="w-4 h-4" />
                    <span>Create {currentKindOption?.label ?? "Surface"}</span>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
                {filteredSurfaces.length === 0 && (
                    <div className="text-xs text-gray-500">Creates a new surface of the selected type and opens it in the editor</div>
                )}
                {filteredSurfaces.map(surface => (
                    <div
                        key={surface.id}
                        className="group w-full text-left rounded-md border border-white/10 bg-[#11131a] px-3 py-2 hover:border-primary transition-colors"
                        onClick={() => handleOpenSurface(surface)}
                        onContextMenu={(event) => handleOpenMenu(event, surface)}
                        role="button"
                        tabIndex={0}
                    >
                        <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-white truncate">{surface.name}</div>
                                <div className="text-[11px] text-gray-400">{surface.designSize.width}×{surface.designSize.height}</div>
                                <div className="text-[11px] text-gray-500">{surface.host}</div>
                            </div>
                            <button
                                type="button"
                                className="p-1 rounded hover:bg-white/10 text-gray-300 opacity-0 group-hover:opacity-100"
                                onClick={(event) => handleOpenMenu(event, surface)}
                                title="Surface actions"
                            >
                                <MoreVertical className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                ))}
            </div>

            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
        </div>
    );
}
