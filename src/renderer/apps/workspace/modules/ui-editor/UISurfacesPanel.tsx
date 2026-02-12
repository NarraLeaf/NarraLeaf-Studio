import { useCallback, useEffect, useMemo, useState } from "react";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIStageSlotId, UIStageSurfaceMount, UISurface, UISurfaceKind, UIHost } from "@shared/types/ui-editor/document";
import { useRegistry } from "../../registry";
import { UISurfaceEditorTab } from "./editors/UISurfaceEditorTab";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { MoreVertical, PanelsTopLeft, Plus } from "lucide-react";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { FocusArea } from "@/lib/workspace/services/ui/types";

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
        description: "App surfaces represent application-level UI such as start screens or settings.",
        host: "app",
    },
    {
        kind: "stageSurface",
        label: "Stage",
        description: "Stage surfaces run inside the player and can mount as slots, persistent overlays, or layers.",
        host: "player",
    },
];

type StageMountOption = {
    kind: UIStageSurfaceMount["kind"];
    label: string;
    description: string;
};

const STAGE_MOUNT_OPTIONS: StageMountOption[] = [
    {
        kind: "persistent",
        label: "On Stage",
        description: "Always-mounted stage UI such as quick menus.",
    },
    {
        kind: "slot",
        label: "Slot",
        description: "Mount inside a stage slot (dialog, notification, etc.).",
    },
    {
        kind: "layer",
        label: "Layer",
        description: "Page-like layers such as settings or save screens.",
    },
];

const STAGE_SLOT_OPTIONS: { value: UIStageSlotId; label: string; description: string }[] = [
    {
        value: "dialog",
        label: "Dialog",
        description: "Game Dialog",
    },
    {
        value: "menu",
        label: "Menu",
        description: "Game Menu Choice",
    },
    {
        value: "notification",
        label: "Notification",
        description: "App Notification",
    },
    {
        value: "none",
        label: "None",
        description: "No slot-specific behavior.",
    },
];

const STAGE_SLOT_LABELS: Record<UIStageSlotId, string> = {
    dialog: "Dialog",
    menu: "Menu",
    notification: "Notification",
    none: "None",
};

const DEFAULT_STAGE_SLOT_ID: UIStageSlotId = "dialog";

type StageSlotSelectionProps = {
    value: UIStageSlotId;
    onChange: (value: UIStageSlotId) => void;
};

const StageSlotSelection = ({ value, onChange }: StageSlotSelectionProps) => {
    return (
        <div className="space-y-3">
            <div className="text-sm text-gray-400">
                Choose the slot that determines how this stage surface is injected.
            </div>
            <div className="grid gap-2">
                {STAGE_SLOT_OPTIONS.map(option => {
                    const isActive = value === option.value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            onClick={() => onChange(option.value)}
                            className={`w-full rounded-md border px-3 py-3 text-left text-sm transition-colors ${
                                isActive
                                    ? "border-primary bg-primary/10 text-white"
                                    : "border-white/10 text-gray-300 hover:border-white/30 hover:bg-white/5"
                            }`}
                        >
                            <div className="font-semibold">{option.label}</div>
                            <div className="text-[11px] text-gray-400">{option.description}</div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

type StageMountDialogContentProps = {
    initial?: UIStageSurfaceMount;
    onChange: (value: UIStageSurfaceMount) => void;
};

const StageMountDialogContent = ({ initial, onChange }: StageMountDialogContentProps) => {
    const [selectedKind, setSelectedKind] = useState<UIStageSurfaceMount["kind"]>(initial?.kind ?? "persistent");
    const [selectedSlot, setSelectedSlot] = useState<UIStageSlotId>(
        initial?.kind === "slot" ? initial.slotId : DEFAULT_STAGE_SLOT_ID
    );

    useEffect(() => {
        const nextMount =
            selectedKind === "slot"
                ? { kind: "slot", slotId: selectedSlot }
                : ({ kind: selectedKind } as UIStageSurfaceMount);
        onChange(nextMount as UIStageSurfaceMount);
    }, [onChange, selectedKind, selectedSlot]);

    return (
        <div className="space-y-4">
            <div className="text-sm text-gray-400">
                Choose how this stage surface is mounted inside the player.
            </div>
            <div className="grid gap-2">
                {STAGE_MOUNT_OPTIONS.map(option => {
                    const isActive = selectedKind === option.kind;
                    return (
                        <button
                            key={option.kind}
                            type="button"
                            onClick={() => setSelectedKind(option.kind)}
                            className={`w-full rounded-md border px-3 py-3 text-left text-sm transition-colors ${
                                isActive
                                    ? "border-primary bg-primary/10 text-white"
                                    : "border-white/10 text-gray-300 hover:border-white/30 hover:bg-white/5"
                            }`}
                        >
                            <div className="font-semibold">{option.label}</div>
                            <div className="text-[11px] text-gray-400">{option.description}</div>
                        </button>
                    );
                })}
            </div>
            {selectedKind === "slot" && <StageSlotSelection value={selectedSlot} onChange={setSelectedSlot} />}
        </div>
    );
};

const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const getSurfaceTabId = (surfaceId: string) => `${SURFACE_TAB_PREFIX}${surfaceId}`;
const formatSurfaceLabel = (surface: UISurface) => `${surface.name} (${surface.kind})`;

export function UISurfacesPanel({ panelId }: PanelComponentProps) {
    const { context } = useWorkspace();
    const { openEditorTab, closeEditorTab } = useRegistry();
    const [surfaces, setSurfaces] = useState<UISurface[]>([]);
    const [kind, setKind] = useState<UISurfaceKind>("appSurface");
    const [stageMountFilter, setStageMountFilter] = useState<UIStageSurfaceMount["kind"] | null>(null);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const [hasEnsuredAppSurface, setHasEnsuredAppSurface] = useState(false);

    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context) return null;
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context]);
    const uiService = useMemo<UIService | null>(() => {
        if (!context) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context]);
    const inputDialog = useMemo(() => {
        if (!uiService) return null;
        return createInputDialog(uiService);
    }, [uiService]);

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

    useEffect(() => {
        if (kind !== "stageSurface" && stageMountFilter !== null) {
            setStageMountFilter(null);
        }
    }, [kind, stageMountFilter]);

    const filteredSurfaces = useMemo(() => {
        return surfaces.filter(surface => {
            if (surface.kind !== kind) {
                return false;
            }
            if (kind === "stageSurface" && stageMountFilter && surface.kind === "stageSurface") {
                return surface.mount.kind === stageMountFilter;
            }
            return true;
        });
    }, [surfaces, kind, stageMountFilter]);
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

    const focusSceneProperties = useCallback((surface: UISurface) => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: "scene", data: surface.id });
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
        uiService.panels.show("narraleaf-studio:properties");
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId, { silent: true });
    }, [context, panelId]);

    const handleSurfaceClick = useCallback((surface: UISurface) => {
        handleOpenSurface(surface);
        focusSceneProperties(surface);
    }, [focusSceneProperties, handleOpenSurface]);

    useEffect(() => {
        if (!documentService || hasEnsuredAppSurface) {
            return;
        }
        const document = documentService.getDocument();
        const hasAppSurface = document.surfaces.some(surface => surface.kind === "appSurface");
        if (hasAppSurface) {
            setHasEnsuredAppSurface(true);
            return;
        }
        if (documentService.getRevision() !== 0) {
            return;
        }
        const defaultSurface = documentService.createSurface({
            kind: "appSurface",
            name: DEFAULT_APP_SURFACE_NAME,
            host: "app",
        });
        setHasEnsuredAppSurface(true);
        handleOpenSurface(defaultSurface);
    }, [documentService, handleOpenSurface, hasEnsuredAppSurface]);

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
        ];
        if (surface.id !== MAIN_APP_SURFACE_ID) {
            items.push(
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
            );
        }
        setMenuItems(items);
        showMenu(event);
    }, [showMenu, handleOpenSurface, handleDeleteSurface]);

    const promptStageMountSelection = useCallback(async (): Promise<UIStageSurfaceMount | null> => {
        if (!uiService) {
            return null;
        }
        return new Promise(resolve => {
            let settled = false;
            let dialogId: string | null = null;
            const mountRef = { current: { kind: "persistent" } as UIStageSurfaceMount };

            const safeResolve = (value: UIStageSurfaceMount | null) => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(value);
            };

            const closeDialog = () => {
                if (dialogId) {
                    uiService.dialogs.close(dialogId);
                    dialogId = null;
                }
            };

            const handleConfirm = () => {
                safeResolve(mountRef.current);
                closeDialog();
            };

            const handleCancel = () => {
                safeResolve(null);
                closeDialog();
            };

            dialogId = uiService.dialogs.show({
                title: "Select Stage Mount",
                content: (
                    <StageMountDialogContent
                        initial={mountRef.current}
                        onChange={value => {
                            mountRef.current = value;
                        }}
                    />
                ),
                closable: true,
                buttons: [
                    {
                        label: "Cancel",
                        onClick: handleCancel,
                    },
                    {
                        label: "Confirm",
                        primary: true,
                        onClick: handleConfirm,
                    },
                ],
                onClose: () => safeResolve(null),
            });
        });
    }, [uiService]);

    const handleCreateSurface = useCallback(async () => {
        if (!documentService || !currentKindOption || !inputDialog) {
            return;
        }
        const suggestedName = `${currentKindOption.label} ${filteredSurfaces.length + 1}`;
        const name = await inputDialog.show({
            title: "New Surface",
            description: `Please name the ${currentKindOption.label.toLowerCase()} surface.`,
            placeholder: "Enter surface name",
            initialValue: suggestedName,
            required: true,
            maxLength: 100,
        });
        if (!name) {
            return;
        }
        let stageMount: UIStageSurfaceMount | undefined;
        if (kind === "stageSurface") {
            const selectedMount = await promptStageMountSelection();
            if (!selectedMount) {
                return;
            }
            stageMount = selectedMount;
        }
        const surface = documentService.createSurface({
            kind,
            name,
            host: currentKindOption.host,
            stageMount,
        });
        void documentService.save(documentService.getDocument()).catch(err => {
            console.warn("[UISurfacesPanel] failed to save surface", err);
        });
        handleOpenSurface(surface);
    }, [
        currentKindOption,
        documentService,
        filteredSurfaces.length,
        handleOpenSurface,
        inputDialog,
        kind,
        promptStageMountSelection,
    ]);

    const surfaceKindButtonClass = (optionKind: UISurfaceKind) =>
        `flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
            kind === optionKind
                ? "border-primary bg-primary/10 text-white"
                : "border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
        }`;

    const stageMountButtonClass = (optionKind: UIStageSurfaceMount["kind"] | null) =>
        `flex-1 rounded-md px-2 py-1 text-xs font-medium border transition-colors ${
            stageMountFilter === optionKind
                ? "border-primary bg-primary/10 text-white"
                : "border-white/10 text-gray-300 hover:bg-white/10 hover:text-white"
        }`;

    const formatStageMountLabel = (mount: UIStageSurfaceMount): string => {
        if (mount.kind === "slot") {
            return `Slot · ${STAGE_SLOT_LABELS[mount.slotId] ?? mount.slotId}`;
        }
        return mount.kind === "persistent" ? "Persistent" : "Layer";
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
                            className={surfaceKindButtonClass(option.kind)}
                            onClick={() => setKind(option.kind)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>

            {kind === "stageSurface" && (
                <div className="px-2 mt-2">
                    <div className="text-xs font-semibold uppercase text-gray-400">Stage Mount</div>
                    <div className="mt-2 flex gap-2">
                        <button
                            type="button"
                            className={stageMountButtonClass(null)}
                            onClick={() => setStageMountFilter(null)}
                        >
                            All
                        </button>
                        {STAGE_MOUNT_OPTIONS.map(option => (
                            <button
                                key={option.kind}
                                type="button"
                                className={stageMountButtonClass(option.kind)}
                                onClick={() =>
                                    setStageMountFilter(prev => (prev === option.kind ? null : option.kind))
                                }
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="px-2 mt-2">
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={handleCreateSurface}
                        disabled={!documentService || !currentKindOption || !inputDialog}
                        className="flex-1 flex h-10 items-center justify-center gap-2 rounded-md border border-white/20 bg-[#0b0d12] px-3 text-xs font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed hover:bg-white/10 hover:text-white"
                    >
                        <Plus className="w-4 h-4" />
                        <span>Create Surface</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 bg-[#0b0d12]">
                {filteredSurfaces.length === 0 && (
                    <div className="text-xs text-gray-500">Creates a new surface of the selected type and opens it in the editor</div>
                )}
                {filteredSurfaces.map(surface => (
                    <div
                        key={surface.id}
                        className="group w-full text-left rounded-md border border-white/10 bg-[#0b0d12] px-3 py-2 transition-colors hover:bg-white/5"
                        onClick={() => handleSurfaceClick(surface)}
                        onContextMenu={(event) => handleOpenMenu(event, surface)}
                        role="button"
                        tabIndex={0}
                    >
                        <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-semibold text-white truncate">{surface.name}</div>
                                <div className="text-[11px] text-gray-400">{surface.designSize.width}×{surface.designSize.height}</div>
                                <div className="text-[11px] text-gray-500">{surface.host}</div>
                                {surface.kind === "stageSurface" && (
                                    <div className="text-[11px] text-gray-500">
                                        {formatStageMountLabel(surface.mount)}
                                    </div>
                                )}
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
