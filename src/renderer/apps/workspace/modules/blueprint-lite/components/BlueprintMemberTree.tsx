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
import { useTranslation } from "@/lib/i18n";
import type { UseTranslation } from "@/lib/i18n";

const FIELD_INPUT =
    "w-full rounded-md border border-edge-strong bg-fill-subtle px-2 py-1 text-2xs text-fg outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30";

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
            <div className="mb-1 flex items-center justify-between gap-2 text-2xs tracking-wide text-fg-subtle">
                <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-fg-muted"
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
    const { t } = useTranslation();
    const [draftName, setDraftName] = useState(v.name);

    useEffect(() => {
        setDraftName(v.name);
    }, [v.id, v.name]);

    const commitName = useCallback(() => {
        const next = draftName.trim();
        if (!next) {
            setDraftName(v.name);
            return;
        }
        if (next !== v.name) {
            localBp.renameBlueprintVariable(blueprintId, v.id, next);
        }
    }, [blueprintId, draftName, localBp, v.id, v.name]);

    return (
        <div className="group rounded border border-edge bg-[#0d0f12] px-2 py-1.5 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                    <span className={`text-2xs ${accentClass}`}>{scopeLabel}</span>
                    {v.valueType ? (
                        <span className="truncate rounded border border-edge bg-fill-subtle px-1 py-0.5 font-mono text-2xs text-fg-muted">
                            {v.valueType}
                        </span>
                    ) : null}
                </div>
                <button
                    type="button"
                    title={t("blueprint.memberTree.deleteVariableLabel", { name: v.name })}
                    aria-label={t("blueprint.memberTree.deleteVariableLabel", { name: v.name })}
                    className="-m-0.5 rounded p-1 text-red-400/90 opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                    onClick={() => {
                        if (!uiService) {
                            return;
                        }
                        void (async () => {
                            const ok = await uiService.showConfirm(
                                t("blueprint.memberTree.deleteVariableConfirm", { name: v.name }),
                                t("blueprint.memberTree.deleteVariableDetail"),
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
                <div className="mb-0.5 text-2xs text-fg-subtle">{t("blueprint.memberTree.default")}</div>
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
    const { t } = useTranslation();
    const [draftName, setDraftName] = useState(v.name);

    useEffect(() => {
        setDraftName(v.name);
    }, [v.id, v.name]);

    const commitName = useCallback(() => {
        const next = draftName.trim();
        if (!next) {
            setDraftName(v.name);
            return;
        }
        if (next !== v.name) {
            localBp.renamePersistentVariable(historyBlueprintId, v.id, next);
        }
    }, [draftName, historyBlueprintId, localBp, v.id, v.name]);

    return (
        <div className="group rounded border border-edge bg-[#0d0f12] px-2 py-1.5 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
                <label htmlFor={`persistent-variable-name-${v.id}`} className="text-2xs font-medium text-fg-subtle">
                    {t("common.name")}
                </label>
                <button
                    type="button"
                    title={t("blueprint.memberTree.deletePersistentVariableLabel", { name: v.name })}
                    aria-label={t("blueprint.memberTree.deletePersistentVariableLabel", { name: v.name })}
                    className="-m-0.5 rounded p-1 text-red-400/90 opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-300 group-hover:opacity-100"
                    onClick={() => {
                        if (!uiService) {
                            return;
                        }
                        void (async () => {
                            const ok = await uiService.showConfirm(
                                t("blueprint.memberTree.deletePersistentVariableConfirm", { name: v.name }),
                                t("blueprint.memberTree.deletePersistentVariableDetail"),
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
                <div className="mb-0.5 text-2xs text-fg-subtle">{t("blueprint.memberTree.default")}</div>
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

function buildVariableGroups(
    input: {
        pageBlueprint?: Blueprint;
        pageBlueprintId?: string;
        globalBlueprint?: Blueprint;
        globalBlueprintId?: string;
    },
    t: UseTranslation["t"],
): VariableGroup[] {
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
                  label: t("blueprint.memberTree.pageVariables"),
                  scopeLabel: t("blueprint.memberTree.pageScope"),
                  blueprintId: input.pageBlueprintId,
                  blueprint: input.pageBlueprint,
                  defaultOpen: false,
                  accentClass: "text-sky-200/80",
                  emptyText: t("blueprint.memberTree.pageEmpty"),
              }
            : null,
    );

    addGroup(
        input.globalBlueprint && input.globalBlueprintId
            ? {
                  key: "global",
                  label: t("blueprint.memberTree.globalVariables"),
                  scopeLabel: t("blueprint.memberTree.globalScope"),
                  blueprintId: input.globalBlueprintId,
                  blueprint: input.globalBlueprint,
                  defaultOpen: false,
                  accentClass: "text-violet-200/80",
                  emptyText: t("blueprint.memberTree.globalEmpty"),
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
    const { t } = useTranslation();
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
                const defaultVariableName = t("blueprint.memberTree.defaultVariableName");
                const selection: BlueprintVariableDialogValue = {
                    name: defaultVariableName,
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
                        uiService.showNotification(t("blueprint.memberTree.createVariableInvalid"), "warning");
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
                    title: t("blueprint.memberTree.createVariableTitle", { scope: group.scopeLabel }),
                    content: (
                        <BlueprintVariableDialogContent
                            defaultName={defaultVariableName}
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
                            label: t("common.cancel"),
                            onClick: handleCancel,
                        },
                        {
                            label: t("common.create"),
                            primary: true,
                            onClick: handleConfirm,
                        },
                    ],
                    onClose: handleCancel,
                });
            });
        },
        [uiService, t],
    );

    const promptCreatePersistentVariable = useCallback(
        (existingNames: string[]): Promise<BlueprintVariableDialogValue | null> => {
            if (!uiService) {
                return Promise.resolve(null);
            }
            return new Promise(resolve => {
                let dialogId: string | null = null;
                let settled = false;
                const defaultPersistentName = t("blueprint.memberTree.defaultPersistentName");
                const selection: BlueprintVariableDialogValue = {
                    name: defaultPersistentName,
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
                        uiService.showNotification(t("blueprint.memberTree.createPersistentInvalid"), "warning");
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
                    title: t("blueprint.memberTree.createVariableTitle", {
                        scope: t("blueprint.memberTree.persistentScope"),
                    }),
                    content: (
                        <BlueprintVariableDialogContent
                            defaultName={defaultPersistentName}
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
                            label: t("common.cancel"),
                            onClick: handleCancel,
                        },
                        {
                            label: t("common.create"),
                            primary: true,
                            onClick: handleConfirm,
                        },
                    ],
                    onClose: handleCancel,
                });
            });
        },
        [uiService, t],
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
        return <p className="text-xs text-fg-subtle">{t("blueprint.memberTree.notGraph")}</p>;
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
            buildVariableGroups(
                {
                    pageBlueprint,
                    pageBlueprintId,
                    globalBlueprint,
                    globalBlueprintId,
                },
                t,
            ),
        [
            blueprint,
            blueprintDocumentRevision,
            blueprintId,
            globalBlueprint,
            globalBlueprintId,
            pageBlueprint,
            pageBlueprintId,
            t,
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
                label: t("blueprint.memberTree.renameLayer"),
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
                            title: t("blueprint.memberTree.renameLayerTitle"),
                            placeholder: t("blueprint.memberTree.layerNamePlaceholder"),
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
                label: t("blueprint.memberTree.deleteLayer"),
                onClick: () => {
                    const id = menuLayerId;
                    hideMenu();
                    setMenuLayerId(null);
                    if (!id || !uiService) {
                        return;
                    }
                    void (async () => {
                        const ok = await uiService.showConfirm(
                            t("blueprint.memberTree.deleteLayerConfirm"),
                            t("blueprint.memberTree.deleteLayerDetail"),
                        );
                        if (ok) {
                            onDeleteLayer(id);
                        }
                    })();
                },
            },
        ];
    }, [blueprintId, events, hideMenu, inputDialog, localBp, menuLayerId, onDeleteLayer, uiService, t]);

    return (
        <div className="flex h-full min-h-0 flex-col gap-4 text-xs text-fg-muted">
            <section className="shrink-0">
                <div className="mb-1 flex items-center justify-between text-2xs font-medium text-fg-subtle">
                    <span>{t("blueprint.memberTree.layers")}</span>
                    <button
                        type="button"
                        className="inline-flex items-center gap-1 text-cyan-400/90 hover:text-cyan-300"
                        onClick={() => void onAddLayer()}
                    >
                        <Plus className="h-3 w-3" />
                        {t("common.new")}
                    </button>
                </div>
                <ul className="space-y-0.5">
                    {Object.keys(events).length === 0 ? (
                        <li className="text-fg-subtle">-</li>
                    ) : (
                        Object.keys(events).map(id => {
                            const { errors, warnings } = countForGraph(diagnostics, "event", id);
                            return (
                                <li key={id}>
                                    <button
                                        type="button"
                                        className={`w-full rounded px-2 py-1 text-left font-mono text-2xs ${
                                            layerActive(id)
                                                ? "bg-cyan-500/15 text-cyan-100"
                                                : "text-fg-muted hover:bg-fill-subtle"
                                        }`}
                                        onClick={() => onSelectLayer(id)}
                                        onContextMenu={e => {
                                            setMenuLayerId(id);
                                            showMenu(e);
                                        }}
                                    >
                                        {events[id]?.name ?? t("blueprint.memberTree.unnamedEvent")}
                                        {errors > 0 ? (
                                            <span className="ml-1 text-red-400">{t("blueprint.memberTree.errorBadge", { count: errors })}</span>
                                        ) : warnings > 0 ? (
                                            <span className="ml-1 text-amber-400">{t("blueprint.memberTree.warningBadge", { count: warnings })}</span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })
                    )}
                </ul>
            </section>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto border-t border-edge-subtle pt-2">
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
                                    {t("common.new")}
                                </button>
                            }
                        >
                            <div className="space-y-2">
                                {vars.length === 0 ? <p className="text-fg-subtle">{group.emptyText}</p> : null}
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
                    title={t("blueprint.memberTree.persistentVariables")}
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
                        {sortedPersistentList.length === 0 ? <p className="text-fg-subtle">{t("blueprint.memberTree.persistentEmpty")}</p> : null}
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
