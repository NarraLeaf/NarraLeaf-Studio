/**
 * The graph, over the game, while it is stopped.
 *
 * It takes the run area rather than sharing it. A debugger that shows the graph in a 380px column
 * is a debugger nobody reads the graph in: the node the game stopped on, what fed it, and what it
 * was about to do are a picture, and a picture needs the room. The game underneath is not going
 * anywhere - it is stopped, which is the whole reason this is on screen.
 *
 * It also opens on demand while the game runs, so breakpoints can be placed on the graph the
 * author is watching without going back to the editor window.
 */

import { useEffect, useMemo, type ReactNode } from "react";
import { X } from "lucide-react";
import { ContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { Select } from "@/lib/components/elements/Select";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { useTranslation } from "@/lib/i18n";
import { blueprintBreakpointKey } from "@shared/types/blueprint/breakpoints";
import { BlueprintBreakpointDialog } from "@/lib/ui-editor/blueprint-debug/BlueprintBreakpointDialog";
import { buildBreakpointContextMenu } from "@/lib/ui-editor/blueprint-debug/breakpointContextMenu";
import { getBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { resolveBlueprintNodeTitle } from "@/apps/workspace/modules/blueprint-lite/blueprintNodeI18n";
import { BlueprintDebuggerToolbar } from "./BlueprintDebuggerToolbar";
import { BlueprintReadonlyGraphView } from "./BlueprintReadonlyGraphView";
import { useBlueprintDebuggerContext } from "./BlueprintDebuggerContext";

export function BlueprintDebuggerOverlay(): ReactNode {
    const { t } = useTranslation();
    const ctx = useBlueprintDebuggerContext();
    const paused = ctx?.snapshot.status === "paused";
    const open = Boolean(ctx && (paused || ctx.graphBrowserOpen));

    // Landing on a stop with nothing picked yet: the stopped graph is what the overlay shows, and
    // closing it afterwards should not put the author back on a blank picker.
    useEffect(() => {
        if (ctx && paused) {
            ctx.setView(ctx.snapshot.pausedBlueprintId ?? null, ctx.snapshot.pausedGraphId ?? null);
        }
        // Only when the stop itself changes; `setView` is stable.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [paused, ctx?.snapshot.pausedBlueprintId, ctx?.snapshot.pausedGraphId]);

    const graphOptions = useMemo(() => {
        if (!ctx) {
            return [];
        }
        return ctx.blueprints.flatMap(blueprint =>
            blueprint.graphs.map(graph => ({
                value: `${blueprint.id}\u0000${graph.graphId}`,
                label: graph.name,
                secondaryLabel: blueprint.name,
            })),
        );
    }, [ctx]);

    const menuItems = useMemo<ContextMenuDef>(() => {
        if (!ctx?.contextMenu || !ctx.viewBlueprintId || !ctx.viewGraphId) {
            return [];
        }
        const nodeId = ctx.contextMenu.nodeId;
        const target = { blueprintId: ctx.viewBlueprintId, graphId: ctx.viewGraphId, nodeId };
        const existing = ctx.breakpointsByKey.get(blueprintBreakpointKey(target));
        return buildBreakpointContextMenu({
            existing,
            onToggle: () => {
                ctx.toggleBreakpoint(nodeId);
                ctx.closeContextMenu();
            },
            onSetEnabled: enabled => {
                ctx.setBreakpointEnabled(target, enabled);
                ctx.closeContextMenu();
            },
            onEdit: () => ctx.openBreakpointEditor(target),
            labels: {
                add: t("blueprint.breakpoint.add"),
                remove: t("blueprint.breakpoint.remove"),
                enable: t("blueprint.breakpoint.enable"),
                disable: t("blueprint.breakpoint.disable"),
                edit: t("blueprint.breakpoint.edit"),
            },
        });
    }, [ctx, t]);

    if (!ctx || !open) {
        return null;
    }

    const editing = ctx.editingTarget;
    const editingBreakpoint = editing ? ctx.breakpointsByKey.get(blueprintBreakpointKey(editing)) : undefined;

    return (
        <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col bg-surface/95 backdrop-blur-sm">
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-2 py-1.5">
                <span className="text-xs font-medium text-fg">{t("devMode.debugger.title")}</span>
                <BlueprintDebuggerToolbar session={ctx.session} snapshot={ctx.snapshot} />
                <span className={`min-w-0 flex-1 truncate text-2xs ${paused ? "text-warning" : "text-fg-subtle"}`}>
                    {paused
                        ? ctx.snapshot.reason === "breakpoint"
                            ? t("devMode.debugger.statusBreakpoint")
                            : t("devMode.debugger.statusStepped")
                        : t("devMode.debugger.statusRunning")}
                </span>
                <Select
                    size="sm"
                    className="w-64 shrink-0"
                    portalMenu
                    ariaLabel={t("devMode.debugger.graphPicker")}
                    placeholder={t("devMode.debugger.graphPicker")}
                    value={
                        ctx.viewBlueprintId && ctx.viewGraphId
                            ? `${ctx.viewBlueprintId}\u0000${ctx.viewGraphId}`
                            : undefined
                    }
                    options={graphOptions}
                    onChange={next => {
                        const [blueprintId, graphId] = String(next).split("\u0000");
                        ctx.setView(blueprintId ?? null, graphId ?? null);
                    }}
                />
                <ToolbarButton
                    size="sm"
                    aria-label={t("common.close")}
                    data-tip={t("common.close")}
                    onClick={ctx.closeGraphBrowser}
                    disabled={paused}
                >
                    <X className="h-3.5 w-3.5" aria-hidden />
                </ToolbarButton>
            </div>

            {!ctx.viewPausable ? (
                <p className="shrink-0 border-b border-edge bg-warning/10 px-2 py-1 text-2xs text-warning">
                    {t("devMode.debugger.syncGraphNotice")}
                </p>
            ) : null}

            <div className="min-h-0 flex-1">
                {ctx.viewIr ? (
                    <BlueprintReadonlyGraphView
                        ir={ctx.viewIr}
                        blueprintId={ctx.viewBlueprintId ?? ""}
                        graphId={ctx.viewGraphId ?? ""}
                        breakpointsByKey={ctx.breakpointsByKey}
                        pausable={ctx.viewPausable}
                        pausedNodeId={paused ? ctx.snapshot.pausedNodeId : undefined}
                        focusNonce={ctx.snapshot.pausedFrameId}
                        onNodeContextMenu={ctx.openContextMenu}
                    />
                ) : (
                    <div className="flex h-full items-center justify-center text-2xs text-fg-subtle">
                        {t("devMode.debugger.pickGraph")}
                    </div>
                )}
            </div>

            {ctx.contextMenu ? (
                <ContextMenu
                    items={menuItems}
                    position={ctx.contextMenu.position}
                    visible
                    onClose={ctx.closeContextMenu}
                />
            ) : null}

            <BlueprintBreakpointDialog
                open={Boolean(editing)}
                breakpoint={editingBreakpoint}
                variables={ctx.viewVariables}
                nodeLabel={editing ? nodeLabelOf(ctx, editing.nodeId, t) : undefined}
                onClose={ctx.closeBreakpointEditor}
                onSubmit={next => {
                    if (editing) {
                        ctx.configureBreakpoint(editing, next);
                    }
                }}
            />
        </div>
    );
}

function nodeLabelOf(
    ctx: NonNullable<ReturnType<typeof useBlueprintDebuggerContext>>,
    nodeId: string,
    t: Parameters<typeof resolveBlueprintNodeTitle>[1],
): string | undefined {
    const type = ctx.viewIr?.nodes?.[nodeId]?.type;
    if (!type) {
        return undefined;
    }
    const catalog = getBlueprintNodeEditorCatalogEntry(type);
    return catalog ? resolveBlueprintNodeTitle(catalog.displayName, t) : type;
}
