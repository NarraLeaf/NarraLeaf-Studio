import { useCallback, useEffect, useMemo, useState } from "react";
import type { Blueprint, BlueprintVariable, LiteralValue } from "@shared/types/blueprint/document";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { ContextMenu, type ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { BlueprintLiteralValueControl } from "./BlueprintLiteralValueControl";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/ui";
import { createInputDialog } from "@/lib/components/dialogs";
import { Trash2 } from "lucide-react";

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
    onSelectLayer: (layerId: string) => void;
    onAddLayer: () => void;
    onDeleteLayer: (layerId: string) => void;
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

function BlueprintVariableRow({
    v,
    blueprintId,
    localBp,
    uiService,
}: {
    v: BlueprintVariable;
    blueprintId: string;
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
            localBp.renameBlueprintVariable(blueprintId, v.id, t);
        }
    }, [blueprintId, draftName, localBp, v.id, v.name]);

    return (
        <div className="group rounded border border-white/10 bg-[#0d0f12] px-2 py-1.5 space-y-1.5">
            <div className="flex items-center justify-between gap-1">
                <span className="text-[9px] uppercase text-amber-200/80">Var</span>
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

export function BlueprintMemberTree({
    blueprint,
    blueprintId,
    blueprintDocumentRevision,
    graphView,
    diagnostics,
    localBp,
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

    if (blueprint.program.kind !== "graph") {
        return <p className="text-xs text-gray-500">Not a graph blueprint.</p>;
    }

    const events = blueprint.program.graphs.events ?? {};
    const vars = blueprint.members?.variables ?? {};
    const decls = blueprint.members?.declarations ?? {};

    const sortedVars = useMemo(
        () => Object.values(vars).sort((a, b) => a.name.localeCompare(b.name)),
        [vars, blueprintDocumentRevision],
    );
    const sortedDecls = useMemo(
        () => Object.values(decls).sort((a, b) => a.name.localeCompare(b.name)),
        [decls, blueprintDocumentRevision],
    );

    const layerActive = (id: string) => graphView?.kind === "event" && graphView.graphId === id;

    const layerMenuItems: ContextMenuDef = useMemo(() => {
        if (!menuLayerId) {
            return [];
        }
        return [
            {
                id: "rename",
                label: "Rename layer…",
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
                            description: "Display name for this graph layer (shown in the list).",
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
                label: "Delete layer…",
                onClick: () => {
                    const id = menuLayerId;
                    hideMenu();
                    setMenuLayerId(null);
                    if (!id || !uiService) {
                        return;
                    }
                    void (async () => {
                        const ok = await uiService.showConfirm(
                            "Delete this blueprint layer?",
                            "UI events wired to it will be cleared (noop). This cannot be undone.",
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
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500">
                    <span>Layers</span>
                    <button
                        type="button"
                        className="text-cyan-400/90 hover:text-cyan-300"
                        onClick={() => onAddLayer()}
                    >
                        + New
                    </button>
                </div>
                <p className="mb-1 text-[10px] leading-snug text-gray-600">
                    Each layer is a graph. Add an event head on the canvas (On widget initialize / On button click —
                    right-click) to start a chain. Wire layers from Properties → Interaction → Blueprint.
                </p>
                <ul className="space-y-0.5">
                    {Object.keys(events).length === 0 ? (
                        <li className="text-gray-500">—</li>
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
                                        {events[id]?.name ?? id.slice(0, 10)}
                                        {errors > 0 ? (
                                            <span className="ml-1 text-red-400">· {errors} err</span>
                                        ) : warnings > 0 ? (
                                            <span className="ml-1 text-amber-400">· {warnings} warn</span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })
                    )}
                </ul>
            </section>

            <section className="flex min-h-0 flex-1 flex-col gap-1">
                <div className="mb-1 flex shrink-0 items-center justify-between text-[10px] uppercase tracking-wide text-gray-500">
                    <span>Members</span>
                    <div className="flex gap-1">
                        <button
                            type="button"
                            className="text-cyan-400/90 hover:text-cyan-300"
                            onClick={() => localBp.createBlueprintVariable(blueprintId, {})}
                        >
                            + Var
                        </button>
                        <button
                            type="button"
                            className="text-cyan-400/90 hover:text-cyan-300"
                            onClick={() =>
                                localBp.createDeclaration(blueprintId, {
                                    name: "Declaration",
                                    kind: "constant",
                                })
                            }
                        >
                            + Decl
                        </button>
                    </div>
                </div>
                <p className="mb-1.5 shrink-0 text-[10px] text-gray-600">
                    <span className="text-gray-500">Var</span>: execution locals (defaults below).{" "}
                    <span className="text-gray-500">Decl</span>: binding sources (surface state key).
                </p>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto border-t border-white/5 pt-2">
                    {sortedVars.length === 0 && sortedDecls.length === 0 ? (
                        <p className="text-gray-500">No members yet.</p>
                    ) : null}
                    {sortedVars.map(v => (
                        <BlueprintVariableRow
                            key={v.id}
                            v={v}
                            blueprintId={blueprintId}
                            localBp={localBp}
                            uiService={uiService}
                        />
                    ))}
                    {sortedDecls.map(d => (
                        <div
                            key={d.id}
                            className="rounded border border-white/10 bg-[#0d0f12] px-2 py-1.5 space-y-1.5"
                        >
                            <div className="flex items-center justify-between gap-1">
                                <span className="text-[9px] uppercase text-cyan-200/80">Decl</span>
                                <button
                                    type="button"
                                    className="text-[10px] text-red-400/90 hover:text-red-300"
                                    onClick={() => {
                                        if (!uiService) {
                                            return;
                                        }
                                        void (async () => {
                                            const ok = await uiService.showConfirm(
                                                `Delete declaration "${d.name}"?`,
                                                "This cannot be undone.",
                                            );
                                            if (ok) {
                                                localBp.deleteDeclaration(blueprintId, d.id);
                                            }
                                        })();
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                            <input
                                className={FIELD_INPUT}
                                value={d.name}
                                onChange={e => localBp.renameDeclaration(blueprintId, d.id, e.target.value)}
                                onKeyDown={e => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        e.currentTarget.blur();
                                    }
                                }}
                            />
                            <label className="block space-y-0.5">
                                <span className="text-[9px] text-gray-500">Surface state key</span>
                                <input
                                    className={`${FIELD_INPUT} font-mono`}
                                    value={d.valueSource?.kind === "surfaceState" ? d.valueSource.key : ""}
                                    placeholder="w:elementId:propPath"
                                    onChange={e => {
                                        const key = e.target.value.trim();
                                        if (!key) {
                                            localBp.setDeclarationValueSource(blueprintId, d.id, undefined);
                                            return;
                                        }
                                        localBp.setDeclarationValueSource(blueprintId, d.id, {
                                            kind: "surfaceState",
                                            key,
                                        });
                                    }}
                                    onKeyDown={e => {
                                        e.stopPropagation();
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            e.currentTarget.blur();
                                        }
                                    }}
                                />
                            </label>
                        </div>
                    ))}
                </div>
            </section>

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
    try {
        return JSON.stringify(next) as unknown as string;
    } catch {
        return String(next);
    }
}
