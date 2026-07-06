import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
    Blueprint,
    BlueprintPersistentVariable,
    BlueprintVariable,
    LiteralValue,
} from "@shared/types/blueprint/document";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { BlueprintLiteralValueControl } from "./BlueprintLiteralValueControl";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/ui";
import { createInputDialog } from "@/lib/components/dialogs";
import { GLOBAL_MAIN_OWNER_KEY } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import { BlueprintVariableDialogContent, type BlueprintVariableDialogValue } from "./BlueprintVariableDialogContent";
import { ChevronDown, ChevronRight, Plus, Save, Trash2 } from "lucide-react";

const FIELD_INPUT =
    "w-full rounded-md border border-white/20 bg-white/5 px-2 py-1 text-[11px] text-gray-200 outline-none transition-colors focus:border-[#40a8c4] focus:ring-1 focus:ring-[#40a8c4]/30";

type Props = {
    blueprint: Blueprint;
    blueprintId: string;
    /** Bumps when blueprint / uigraphs document mutates (keeps member lists in sync with in-place object updates). */
    blueprintDocumentRevision: number;
    graphView: BlueprintEditorGraphView | null;
    diagnostics: BlueprintGraphEditorDiagnostic[];
    localBp: LocalBlueprintService;
    surfaceId?: string;
    widgetElementType?: string;
    variableGroupOpenState?: Partial<Record<BlueprintVariableGroupKey, boolean>>;
    onVariableGroupOpenChange?: (groupKey: BlueprintVariableGroupKey, open: boolean) => void;
    onSelectLayer: (layerId: string) => void;
    onAddLayer: () => void | Promise<void>;
    onDeleteLayer: (layerId: string) => void;
};

export type BlueprintVariableGroupKey = "page" | "global" | "persistent";

type VariableGroup = {
    key: BlueprintVariableGroupKey;
    label: string;
    scopeLabel: string;
    blueprintId: string;
    blueprint: Blueprint;
    defaultOpen: boolean;
    accentClass: string;
    emptyText: string;
};

function countForGraph(
    diagnostics: BlueprintGraphEditorDiagnostic[],
    kind: "event" | "function",
    graphId: string,
): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;
    for (const d of diagnostics) {
        const t = d.target;
        if (!t || t.kind !== "graph" || t.graphKind !== kind || t.graphId !== graphId) {
            continue;
        }
        if (d.severity === "error") {
            errors += 1;
        } else if (d.severity === "warning") {
            warnings += 1;
        }
    }
    return { errors, warnings };
}

function CollapsibleSection({
    title,
    titleIcon,
    defaultOpen,
    open,
    onOpenChange,
    action,
    children,
}: {
    title: string;
    titleIcon?: ReactNode;
    defaultOpen: boolean;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    action?: ReactNode;
    children: ReactNode;
}) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const actualOpen = open ?? uncontrolledOpen;
    const setOpen = (next: boolean) => {
        if (open === undefined) {
            setUncontrolledOpen(next);
        }
        onOpenChange?.(next);
    };

    return (
        <section className="shrink-0">
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px] tracking-wide text-gray-500">
                <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-gray-300"
                    onClick={() => setOpen(!actualOpen)}
                >
                    {actualOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {titleIcon}
                    <span className="truncate">{title}</span>
                </button>
                {action}
            </div>
            {actualOpen ? children : null}
        </section>
    );
}

function BlueprintVariableRow({
    v,
    blueprintId,
    localBp,
    uiService,
    scopeLabel,
    accentClass,
}: {
    v: BlueprintVariable;
    blueprintId: string;
    localBp: LocalBlueprintService;
    uiService: UIService | null;
    scopeLabel: string;
    accentClass: string;
}) {
    const [draftName, setDraftName] = useState(v.name);

    useEffect(() => {
        setDraftName(v.name);
    }, [v.id, v.name]);

    const commitName = useCallback(() => {
        const t = draftName.trim();
        if (!t) {
            setDraftName(v.name);
            return;
        }
        if (t !== v.name) {
            localBp.renameBlueprintVariable(blueprintId, v.id, t);
        }
    }, [blueprintId, draftName, localBp, v.id, v.name]);

    return (
        <div className="group rounded border border-white/10 bg-[#0d0f12] px-2 py-1.5 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`text-[9px] ${accentClass}`}>{scopeLabel}</span>
                    {v.valueType ? (
                        <span className="truncate rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[9px] text-gray-400">
                            {v.valueType}
                        </span>
                    ) : null}
                </div>
                <button
                    type="button"
                    title={`Delete variable "${v.name}"`}
                    aria-label={`Delete variable ${v.name}`}
                    className="-m-0.5 rounded p-1 text-red-400/90 opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                    onClick={() => {
                        if (!uiService) {
                            return;
                        }
                        void (async () => {
                            const ok = await uiService.showConfirm(
                                `Delete variable "${v.name}"?`,
                                "Nodes that referenced this variable will lose their selection. This cannot be undone.",
                            );
                            if (ok) {
                                localBp.deleteBlueprintVariable(blueprintId, v.id);
                            }
                        })();
                    }}
                >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                </button>
            </div>
            <input
                className={`${FIELD_INPUT} font-mono`}
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        setDraftName(v.name);
                        e.currentTarget.blur();
                    }
                }}
            />
            <div>
                <div className="mb-0.5 text-[9px] text-gray-500">Default</div>
                <BlueprintLiteralValueControl
                    variant="inspector"
                    value={v.defaultValue ?? null}
                    onChange={next =>
                        localBp.setBlueprintVariableDefault(blueprintId, v.id, normalizeVariableDefault(next))
                    }
                />
            </div>
        </div>
    );
}

function BlueprintPersistentVariableRow({
    v,
    historyBlueprintId,
    localBp,
    uiService,
}: {
    v: BlueprintPersistentVariable;
    historyBlueprintId: string;
    localBp: LocalBlueprintService;
    uiService: UIService | null;
}) {
    const [draftName, setDraftName] = useState(v.name);

    useEffect(() => {
        setDraftName(v.name);
    }, [v.id, v.name]);

    const commitName = useCallback(() => {
        const t = draftName.trim();
        if (!t) {
            setDraftName(v.name);
            return;
        }
        if (t !== v.name) {
            localBp.renamePersistentVariable(historyBlueprintId, v.id, t);
        }
    }, [draftName, historyBlueprintId, localBp, v.id, v.name]);

    return (
        <div className="group rounded border border-white/10 bg-[#0d0f12] px-2 py-1.5 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
                <label htmlFor={`persistent-variable-name-${v.id}`} className="text-[10px] font-medium text-gray-500">
                    Name
                </label>
                <button
                    type="button"
                    title={`Delete persistent variable "${v.name}"`}
                    aria-label={`Delete persistent variable ${v.name}`}
                    className="-m-0.5 rounded p-1 text-red-400/90 opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                    onClick={() => {
                        if (!uiService) {
                            return;
                        }
                        void (async () => {
                            const ok = await uiService.showConfirm(
                                `Delete persistent variable "${v.name}"?`,
                                "Nodes that referenced this persistent variable will lose their selection. Saved player data for this key is not deleted.",
                            );
                            if (ok) {
                                localBp.deletePersistentVariable(historyBlueprintId, v.id);
                            }
                        })();
                    }}
                >
                    <Trash2 className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                </button>
            </div>
            <input
                id={`persistent-variable-name-${v.id}`}
                className={`${FIELD_INPUT} font-mono`}
                value={draftName}
                onChange={e => setDraftName(e.target.value)}
                onBlur={commitName}
                onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        setDraftName(v.name);
                        e.currentTarget.blur();
                    }
                }}
            />
            <div>
                <div className="mb-0.5 text-[9px] text-gray-500">Default</div>
                <BlueprintLiteralValueControl
                    variant="inspector"
                    value={v.defaultValue ?? null}
                    onChange={next =>
                        localBp.setPersistentVariableDefault(
                            historyBlueprintId,
                            v.id,
                            normalizeVariableDefault(next),
                        )
                    }
                />
            </div>
        </div>
    );
}

function sortedVariables(blueprint: Blueprint): BlueprintVariable[] {
    return Object.values(blueprint.members?.variables ?? {}).sort((a, b) => a.name.localeCompare(b.name));
}

function sortedPersistentVariables(variables: Record<string, BlueprintPersistentVariable> | undefined): BlueprintPersistentVariable[] {
    return Object.values(variables ?? {}).sort((a, b) => a.name.localeCompare(b.name));
}

function buildVariableGroups(input: {
    pageBlueprint?: Blueprint;
    pageBlueprintId?: string;
    globalBlueprint?: Blueprint;
    globalBlueprintId?: string;
}): VariableGroup[] {
    const groups: VariableGroup[] = [];
    const used = new Set<string>();

    const addGroup = (group: VariableGroup | null) => {
        if (!group || used.has(group.blueprintId)) {
            return;
        }
        used.add(group.blueprintId);
        groups.push(group);
    };

    addGroup(
        input.pageBlueprint && input.pageBlueprintId
            ? {
                  key: "page",
                  label: "Page variables",
                  scopeLabel: "Page",
                  blueprintId: input.pageBlueprintId,
                  blueprint: input.pageBlueprint,
                  defaultOpen: false,
                  accentClass: "text-sky-200/80",
                  emptyText: "No page variables.",
              }
            : null,
    );

    addGroup(
        input.globalBlueprint && input.globalBlueprintId
            ? {
                  key: "global",
                  label: "Global variables",
                  scopeLabel: "Global",
                  blueprintId: input.globalBlueprintId,
                  blueprint: input.globalBlueprint,
                  defaultOpen: false,
                  accentClass: "text-violet-200/80",
                  emptyText: "No global variables.",
              }
            : null,
    );

    return groups;
}

export function BlueprintMemberTree({
    blueprint,
    blueprintId,
    blueprintDocumentRevision,
    graphView,
    diagnostics,
    localBp,
    surfaceId,
    variableGroupOpenState,
    onVariableGroupOpenChange,
    onSelectLayer,
    onAddLayer,
    onDeleteLayer,
}: Props) {
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuLayerId, setMenuLayerId] = useState<string | null>(null);
    const { context, isInitialized } = useWorkspace();

    const uiService = useMemo(() => {
        if (!isInitialized || !context) {
            return null;
        }
        return context.services.get<UIService>(Services.UI);
    }, [context, isInitialized]);

    const inputDialog = useMemo(() => {
        if (!uiService) {
            return null;
        }
        return createInputDialog(uiService);
    }, [uiService]);

    const promptCreateVariable = useCallback(
        (group: VariableGroup): Promise<BlueprintVariableDialogValue | null> => {
            if (!uiService) {
                return Promise.resolve(null);
            }
            return new Promise(resolve => {
                let dialogId: string | null = null;
                let settled = false;
                const existingNames = sortedVariables(group.blueprint).map(v => v.name);
                const selection: BlueprintVariableDialogValue = {
                    name: "Variable",
                    valueType: "string",
                    defaultValue: "",
                    valid: true,
                };

                const safeResolve = (value: BlueprintVariableDialogValue | null) => {
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
                    if (!selection.valid) {
                        uiService.showNotification("Check the variable name and data type before creating it.", "warning");
                        return;
                    }
                    safeResolve({ ...selection });
                    closeDialog();
                };

                const handleCancel = () => {
                    safeResolve(null);
                    closeDialog();
                };

                dialogId = uiService.dialogs.show({
                    title: `Create ${group.scopeLabel} variable`,
                    content: (
                        <BlueprintVariableDialogContent
                            defaultName="Variable"
                            existingNames={existingNames}
                            onChange={value => {
                                selection.name = value.name;
                                selection.valueType = value.valueType;
                                selection.defaultValue = value.defaultValue;
                                selection.valid = value.valid;
                            }}
                        />
                    ),
                    closable: true,
                    width: 420,
                    buttons: [
                        {
                            label: "Cancel",
                            onClick: handleCancel,
                        },
                        {
                            label: "Create",
                            primary: true,
                            onClick: handleConfirm,
                        },
                    ],
                    onClose: handleCancel,
                });
            });
        },
        [uiService],
    );

    const promptCreatePersistentVariable = useCallback(
        (existingNames: string[]): Promise<BlueprintVariableDialogValue | null> => {
            if (!uiService) {
                return Promise.resolve(null);
            }
            return new Promise(resolve => {
                let dialogId: string | null = null;
                let settled = false;
                const selection: BlueprintVariableDialogValue = {
                    name: "Persistent",
                    valueType: "string",
                    defaultValue: "",
                    valid: true,
                };

                const safeResolve = (value: BlueprintVariableDialogValue | null) => {
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
                    if (!selection.valid) {
                        uiService.showNotification("Check the persistent variable name and data type before creating it.", "warning");
                        return;
                    }
                    safeResolve({ ...selection });
                    closeDialog();
                };

                const handleCancel = () => {
                    safeResolve(null);
                    closeDialog();
                };

                dialogId = uiService.dialogs.show({
                    title: "Create Persistent variable",
                    content: (
                        <BlueprintVariableDialogContent
                            defaultName="Persistent"
                            existingNames={existingNames}
                            onChange={value => {
                                selection.name = value.name;
                                selection.valueType = value.valueType;
                                selection.defaultValue = value.defaultValue;
                                selection.valid = value.valid;
                            }}
                        />
                    ),
                    closable: true,
                    width: 420,
                    buttons: [
                        {
                            label: "Cancel",
                            onClick: handleCancel,
                        },
                        {
                            label: "Create",
                            primary: true,
                            onClick: handleConfirm,
                        },
                    ],
                    onClose: handleCancel,
                });
            });
        },
        [uiService],
    );

    const handleCreateVariable = useCallback(
        async (group: VariableGroup) => {
            const selection = await promptCreateVariable(group);
            if (!selection) {
                return;
            }
            localBp.createBlueprintVariable(group.blueprintId, {
                name: selection.name,
                valueType: selection.valueType,
                defaultValue: selection.defaultValue,
            });
            onVariableGroupOpenChange?.(group.key, true);
        },
        [localBp, onVariableGroupOpenChange, promptCreateVariable],
    );

    const handleCreatePersistentVariable = useCallback(async () => {
        const existingNames = sortedPersistentVariables(localBp.getBlueprintDocument().persistentVariables).map(v => v.name);
        const selection = await promptCreatePersistentVariable(existingNames);
        if (!selection) {
            return;
        }
        localBp.createPersistentVariable(blueprintId, {
            name: selection.name,
            valueType: selection.valueType,
            defaultValue: selection.defaultValue,
        });
        onVariableGroupOpenChange?.("persistent", true);
    }, [blueprintId, localBp, onVariableGroupOpenChange, promptCreatePersistentVariable]);

    if (blueprint.program.kind !== "graph") {
        return <p className="text-xs text-gray-500">Not a graph blueprint.</p>;
    }

    const blueprintDocument = localBp.getBlueprintDocument();
    const globalBlueprintId = blueprintDocument.ownerRecords[GLOBAL_MAIN_OWNER_KEY]?.activeBlueprintId;
    const globalBlueprint = globalBlueprintId ? blueprintDocument.blueprints[globalBlueprintId] : undefined;
    const pageBlueprintId =
        blueprint.owner.kind === "surfaceMain"
            ? blueprintId
            : surfaceId
              ? localBp.getSurfaceMainBlueprintId(surfaceId)
              : undefined;
    const pageBlueprint = pageBlueprintId ? blueprintDocument.blueprints[pageBlueprintId] : undefined;

    const events = blueprint.program.graphs.events ?? {};
    const persistentVariables = blueprintDocument.persistentVariables ?? {};

    const variableGroups = useMemo(
        () =>
            buildVariableGroups({
                pageBlueprint,
                pageBlueprintId,
                globalBlueprint,
                globalBlueprintId,
            }),
        [
            blueprint,
            blueprintDocumentRevision,
            blueprintId,
            globalBlueprint,
            globalBlueprintId,
            pageBlueprint,
            pageBlueprintId,
        ],
    );
    const sortedPersistentList = useMemo(
        () => sortedPersistentVariables(persistentVariables),
        [persistentVariables, blueprintDocumentRevision],
    );

    const layerActive = (id: string) => graphView?.kind === "event" && graphView.graphId === id;

    const layerMenuItems: ContextMenuDef = useMemo(() => {
        if (!menuLayerId) {
            return [];
        }
        return [
            {
                id: "rename",
                label: "Rename layer...",
                onClick: () => {
                    const id = menuLayerId;
                    hideMenu();
                    setMenuLayerId(null);
                    if (!id || !inputDialog) {
                        return;
                    }
                    const cur = events[id]?.name ?? id;
                    void inputDialog
                        .show({
                            title: "Rename layer",
                            placeholder: "Layer name",
                            initialValue: cur,
                            required: true,
                            maxLength: 120,
                        })
                        .then(name => {
                            if (name != null) {
                                localBp.renameEventGraph(blueprintId, id, name);
                            }
                        });
                },
            },
            {
                id: "delete",
                label: "Delete layer...",
                onClick: () => {
                    const id = menuLayerId;
                    hideMenu();
                    setMenuLayerId(null);
                    if (!id || !uiService) {
                        return;
                    }
                    void (async () => {
                        const ok = await uiService.showConfirm(
                            "Delete this layer?",
                            "Linked UI events will be cleared.",
                        );
                        if (ok) {
                            onDeleteLayer(id);
                        }
                    })();
                },
            },
        ];
    }, [blueprintId, events, hideMenu, inputDialog, localBp, menuLayerId, onDeleteLayer, uiService]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-4 text-xs text-gray-300">
            <section className="shrink-0">
                <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-gray-500">
                    <span>Layers</span>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 text-cyan-400/90 hover:text-cyan-300"
                        onClick={() => void onAddLayer()}
                    >
                        <Plus className="h-3 w-3" />
                        New
                    </button>
                </div>
                <ul className="space-y-0.5">
                    {Object.keys(events).length === 0 ? (
                        <li className="text-gray-500">-</li>
                    ) : (
                        Object.keys(events).map(id => {
                            const { errors, warnings } = countForGraph(diagnostics, "event", id);
                            return (
                                <li key={id}>
                                    <button
                                        type="button"
                                        className={`w-full rounded px-2 py-1 text-left font-mono text-[11px] ${
                                            layerActive(id)
                                                ? "bg-cyan-500/15 text-cyan-100"
                                                : "text-gray-300 hover:bg-white/5"
                                        }`}
                                        onClick={() => onSelectLayer(id)}
                                        onContextMenu={e => {
                                            setMenuLayerId(id);
                                            showMenu(e);
                                        }}
                                    >
                                        {events[id]?.name ?? "Unnamed event"}
                                        {errors > 0 ? (
                                            <span className="ml-1 text-red-400">- {errors} err</span>
                                        ) : warnings > 0 ? (
                                            <span className="ml-1 text-amber-400">- {warnings} warn</span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })
                    )}
                </ul>
            </section>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t border-white/5 pt-2">
                {variableGroups.map(group => {
                    const vars = sortedVariables(group.blueprint);
                    return (
                        <CollapsibleSection
                            key={`${group.key}:${group.blueprintId}`}
                            title={group.label}
                            defaultOpen={group.defaultOpen}
                            open={variableGroupOpenState?.[group.key] ?? group.defaultOpen}
                            onOpenChange={open => onVariableGroupOpenChange?.(group.key, open)}
                            action={
                                <button
                                    type="button"
                                    className="inline-flex items-center gap-1 text-cyan-400/90 hover:text-cyan-300"
                                    onClick={() => void handleCreateVariable(group)}
                                >
                                    <Plus className="h-3 w-3" />
                                    New
                                </button>
                            }
                        >
                            <div className="space-y-2">
                                {vars.length === 0 ? <p className="text-gray-500">{group.emptyText}</p> : null}
                                {vars.map(v => (
                                    <BlueprintVariableRow
                                        key={v.id}
                                        v={v}
                                        blueprintId={group.blueprintId}
                                        localBp={localBp}
                                        uiService={uiService}
                                        scopeLabel={group.scopeLabel}
                                        accentClass={group.accentClass}
                                    />
                                ))}
                            </div>
                        </CollapsibleSection>
                    );
                })}

                <CollapsibleSection
                    title="Persistent variables"
                    titleIcon={<Save className="h-3 w-3 shrink-0 text-current" aria-hidden />}
                    defaultOpen={false}
                    open={variableGroupOpenState?.persistent ?? false}
                    onOpenChange={open => onVariableGroupOpenChange?.("persistent", open)}
                    action={
                        <button
                            type="button"
                            className="inline-flex items-center gap-1 text-cyan-400/90 hover:text-cyan-300"
                            onClick={() => void handleCreatePersistentVariable()}
                        >
                            <Plus className="h-3 w-3" />
                            New
                        </button>
                    }
                >
                    <div className="space-y-2">
                        {sortedPersistentList.length === 0 ? <p className="text-gray-500">No persistent variables.</p> : null}
                        {sortedPersistentList.map(v => (
                            <BlueprintPersistentVariableRow
                                key={v.id}
                                v={v}
                                historyBlueprintId={blueprintId}
                                localBp={localBp}
                                uiService={uiService}
                            />
                        ))}
                    </div>
                </CollapsibleSection>
            </div>

            <ContextMenu items={layerMenuItems} position={menuState.position} visible={menuState.visible} onClose={hideMenu} />
        </div>
    );
}

function normalizeVariableDefault(next: unknown): LiteralValue | undefined {
    if (next === undefined) {
        return undefined;
    }
    if (next === null || typeof next === "string" || typeof next === "number" || typeof next === "boolean") {
        return next;
    }
    if (Array.isArray(next)) {
        return next.map(item => normalizeVariableJsonValue(item));
    }
    if (typeof next === "object") {
        const out: Record<string, LiteralValue> = {};
        for (const [key, value] of Object.entries(next as Record<string, unknown>)) {
            out[key] = normalizeVariableJsonValue(value);
        }
        return out;
    }
    return null;
}

function normalizeVariableJsonValue(value: unknown): LiteralValue {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (value === undefined) {
        return null;
    }
    if (Array.isArray(value)) {
        return value.map(item => normalizeVariableJsonValue(item));
    }
    if (typeof value === "object") {
        const out: Record<string, LiteralValue> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            out[key] = normalizeVariableJsonValue(item);
        }
        return out;
    }
    return null;
}
