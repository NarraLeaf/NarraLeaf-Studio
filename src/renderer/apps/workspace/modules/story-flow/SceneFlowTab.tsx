import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, LayoutGrid, Route } from "lucide-react";
import type { StoryDocument, StorySceneId } from "@shared/types/story";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { Button, Select, type SelectOption } from "@/lib/components/elements";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { createStorySceneEditorTab } from "../story/scene-editor/openStorySceneEditorTab";
import { SceneFlowCanvas, type SceneFlowHighlight } from "./SceneFlowCanvas";
import {
    formatSceneFlowDelta,
    formatSceneFlowVariableChip,
    SceneFlowRouteRail,
    type SceneFlowRouteSelection,
    type SceneFlowVariableFocus,
} from "./SceneFlowRouteRail";
import { buildSceneFlowGraph } from "./sceneFlowModel";
import { buildSceneFlowRouteMap, type SceneFlowRoute } from "./sceneFlowRoutes";
import {
    branchDeltaFor,
    collectBranchEffects,
    collectSceneEffects,
    computeVariableRanges,
    listNumericStoryVariables,
} from "./sceneFlowVariables";
import type { SceneFlowTabPayload, SceneFlowViewport } from "./sceneFlowTabId";

/** The picker's "off" row. Empty string rather than null: `Select` addresses options by value. */
const NO_VARIABLE_FOCUS = "";

/**
 * Read-only map of a story's scenes and the jumps between them. Double-clicking a scene opens its
 * editor, so this is a navigation surface as much as a diagnostic one - nothing here writes to the
 * story. Layout, viewport and which scenes are expanded are the only things the author can move, and
 * all three live on the tab payload rather than in the document.
 */
export function SceneFlowTab({ tabId, payload }: EditorTabComponentProps<SceneFlowTabPayload | undefined>) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const storyId = payload?.storyId;

    const storyService = useMemo(() => {
        if (!context || !isInitialized) {
            return null;
        }
        return context.services.get<StoryService>(Services.Story);
    }, [context, isInitialized]);

    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!storyService || !storyId) {
            return undefined;
        }
        let cancelled = false;
        storyService
            .loadStory(storyId)
            .then(loaded => {
                if (!cancelled) {
                    setDocument(loaded);
                    setError(null);
                }
            })
            .catch((cause: unknown) => {
                if (!cancelled) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                }
            });
        // Edits anywhere in the story (a new jump, a renamed scene) reshape the map. The service
        // mutates its cached document in place and emits that same reference, so this has to clone:
        // handing the identical object back to `setDocument` is a no-op bail-out.
        const dispose = storyService.onDocumentChanged(event => {
            if (event.storyId === storyId) {
                setDocument({ ...event.document });
            }
        });
        return () => {
            cancelled = true;
            dispose();
        };
    }, [storyId, storyService]);

    // Layout, viewport and the open scenes ride on the tab payload, so they survive a restart
    // without touching the story document.
    const [positions, setPositions] = useState<Record<StorySceneId, { x: number; y: number }>>(
        () => payload?.positions ?? {},
    );
    const [expandedSceneIds, setExpandedSceneIds] = useState<ReadonlySet<StorySceneId>>(
        () => new Set(payload?.expandedSceneIds ?? []),
    );
    const initialViewportRef = useRef<SceneFlowViewport | undefined>(payload?.viewport);
    const viewportRef = useRef<SceneFlowViewport | undefined>(payload?.viewport);

    // View state that is nobody's business but this session's: a focus and a selection are a
    // question being asked right now, not a way the author arranged the map.
    const [focusedKey, setFocusedKey] = useState<string>(NO_VARIABLE_FOCUS);
    const [railOpen, setRailOpen] = useState(false);
    const [selection, setSelection] = useState<SceneFlowRouteSelection | null>(null);

    // The SAME set reaches the model and the canvas. Handing the layout one set and the renderer
    // another packs every box against a height it is not drawn at, and the nodes overlap.
    const graph = useMemo(
        () => (document ? buildSceneFlowGraph(document, { expandedSceneIds }) : null),
        [document, expandedSceneIds],
    );
    const routeMap = useMemo(
        () => (graph && document ? buildSceneFlowRouteMap(graph, document) : null),
        [graph, document],
    );

    const numericVariables = useMemo(
        () => (document ? listNumericStoryVariables(document) : []),
        [document],
    );
    const focusedVariable = useMemo(
        () => numericVariables.find(variable => variable.key === focusedKey) ?? null,
        [numericVariables, focusedKey],
    );
    const focus = useMemo<SceneFlowVariableFocus | null>(() => {
        if (!focusedVariable || !graph || !document) {
            return null;
        }
        return {
            variable: focusedVariable,
            branchEffects: collectBranchEffects(graph, document),
            sceneEffects: collectSceneEffects(document),
            ranges: computeVariableRanges(graph, document, focusedVariable.key),
        };
    }, [document, graph, focusedVariable]);

    // A reload can delete the variable the focus names; the picker must not keep showing it.
    useEffect(() => {
        if (focusedKey !== NO_VARIABLE_FOCUS && !focusedVariable) {
            setFocusedKey(NO_VARIABLE_FOCUS);
        }
    }, [focusedKey, focusedVariable]);

    /**
     * The selection, or null when the story no longer contains what it named.
     *
     * Resolved rather than trusted: a jump the author just deleted takes its routes with it, and a
     * selection left pointing at one would mask the whole map against a path that no longer exists —
     * every scene dim, forever, with nothing on screen explaining why.
     */
    const resolvedSelection = useMemo<SceneFlowRouteSelection | null>(() => {
        if (!selection || !routeMap) {
            return null;
        }
        switch (selection.kind) {
            case "route":
                return routeMap.routes.some(route => route.id === selection.routeId) ? selection : null;
            case "ending":
                return routeMap.endings.some(ending => ending.sceneId === selection.sceneId)
                    || routeMap.routes.some(route => route.endingSceneId === selection.sceneId)
                    ? selection
                    : null;
            case "unreachableEndings":
                return routeMap.unreachableEndings.length > 0 ? selection : null;
            case "deadBranches":
                return routeMap.deadBranchIds.length > 0 ? selection : null;
        }
    }, [routeMap, selection]);

    useEffect(() => {
        if (selection && !resolvedSelection) {
            setSelection(null);
        }
    }, [resolvedSelection, selection]);

    const persist = useCallback((next: Partial<SceneFlowTabPayload>) => {
        if (!context || !storyId) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().updateEditorTabPayload<SceneFlowTabPayload>(tabId, {
            storyId,
            positions,
            viewport: viewportRef.current,
            expandedSceneIds: [...expandedSceneIds],
            ...next,
        });
    }, [context, expandedSceneIds, positions, storyId, tabId]);

    const handleMoveScene = useCallback((sceneId: StorySceneId, position: { x: number; y: number }) => {
        setPositions(current => {
            const next = { ...current, [sceneId]: position };
            persist({ positions: next });
            return next;
        });
    }, [persist]);

    const handleViewportChange = useCallback((viewport: SceneFlowViewport) => {
        viewportRef.current = viewport;
        persist({ viewport });
    }, [persist]);

    const handleResetLayout = useCallback(() => {
        setPositions({});
        persist({ positions: {} });
    }, [persist]);

    const handleToggleSceneExpanded = useCallback((sceneId: StorySceneId) => {
        setExpandedSceneIds(current => {
            const next = new Set(current);
            if (!next.delete(sceneId)) {
                next.add(sceneId);
            }
            persist({ expandedSceneIds: [...next] });
            return next;
        });
    }, [persist]);

    /** Scenes that have arms at all — the only ones an expand-all can do anything to. */
    const forkedSceneIds = useMemo(() => {
        const ids = new Set<StorySceneId>();
        for (const branch of graph?.branches ?? []) {
            ids.add(branch.sceneId);
        }
        return ids;
    }, [graph]);
    const allExpanded = forkedSceneIds.size > 0
        && [...forkedSceneIds].every(sceneId => expandedSceneIds.has(sceneId));

    const handleToggleAllExpanded = useCallback(() => {
        const next = allExpanded ? new Set<StorySceneId>() : new Set(forkedSceneIds);
        setExpandedSceneIds(next);
        persist({ expandedSceneIds: [...next] });
    }, [allExpanded, forkedSceneIds, persist]);

    const handleOpenScene = useCallback((sceneId: StorySceneId) => {
        if (!document) {
            return;
        }
        const scene = document.scenes[sceneId];
        if (!scene) {
            return;
        }
        openEditorTab(createStorySceneEditorTab({ storyId: document.id, sceneId }, scene.name));
    }, [document, openEditorTab]);

    const variableOptions = useMemo<SelectOption[]>(() => [
        { value: NO_VARIABLE_FOCUS, label: t("story.flow.variable.none") },
        ...numericVariables.map(variable => ({
            value: variable.key,
            label: variable.name,
            // The scope vocabulary the row badges already use, so "Var" here and "Var" on the
            // declaration row are the same word for the same thing.
            secondaryLabel: t(`story.badge.declare.${variable.scope}`),
        })),
    ], [numericVariables, t]);

    const branchChips = useMemo(() => {
        if (!focus || !graph) {
            return undefined;
        }
        const chips: Record<string, string> = {};
        for (const branch of graph.branches) {
            // `null` is "this arm never touches the variable" and gets NO chip: on a five-option
            // fork where one option moves the counter, four blank chips are what hides the one.
            const delta = branchDeltaFor(focus.branchEffects.get(branch.id) ?? [], focus.variable.key);
            if (delta) {
                chips[branch.id] = formatSceneFlowDelta(delta);
            }
        }
        return chips;
    }, [focus, graph]);

    const sceneChips = useMemo(() => {
        if (!focus) {
            return undefined;
        }
        const chips: Record<StorySceneId, string> = {};
        for (const [sceneId, range] of focus.ranges) {
            chips[sceneId] = formatSceneFlowVariableChip(range, focus.variable.name, t);
        }
        return chips;
    }, [focus, t]);

    /**
     * The 好感度分歧线: what is left bright when a variable is focused.
     *
     * Participation is stated explicitly because getting it wrong makes the feature look *broken*
     * rather than wrong — a mask that dims the wrong half reads as "the map lost my story".
     *
     * - A **scene** participates when it writes the variable on its own spine, when one of its arms
     *   moves it, or when an arm that jumps *into* it moves it. The last one is what keeps the scene
     *   an option's `+2` leads to on the line rather than off it.
     * - An **arm** participates only when it has a delta of its own. Its branch edges light with it,
     *   and so does the arm's own id, so an arm that moves the counter but jumps nowhere still shows.
     *   Falling back to its scene here would light every sibling option of a fork where one option
     *   moves the counter, which is precisely the distinction being drawn.
     * - A **scene edge** participates when *either* endpoint does. A scene-pair edge is not
     *   attributable to an arm, and requiring both ends would cut the line at every scene that
     *   merely carries the counter forward — a divergence "line" drawn as disconnected stubs.
     */
    const variableHighlight = useMemo<SceneFlowHighlight | null>(() => {
        if (!focus || !graph) {
            return null;
        }
        const sceneIds = new Set<StorySceneId>();
        const edgeIds = new Set<string>();
        for (const [sceneId, effects] of focus.sceneEffects) {
            if (effects.some(effect => effect.variableKey === focus.variable.key)) {
                sceneIds.add(sceneId);
            }
        }
        const movingBranchIds = new Set<string>();
        for (const branch of graph.branches) {
            if (!branchDeltaFor(focus.branchEffects.get(branch.id) ?? [], focus.variable.key)) {
                continue;
            }
            movingBranchIds.add(branch.id);
            edgeIds.add(branch.id);
            sceneIds.add(branch.sceneId);
            for (const target of branch.targets) {
                sceneIds.add(target);
            }
        }
        for (const edge of graph.branchEdges) {
            if (movingBranchIds.has(edge.sourceBranchId)) {
                edgeIds.add(edge.id);
            }
        }
        // After every scene is known, or an edge would be judged against a half-built set.
        for (const edge of graph.edges) {
            if (sceneIds.has(edge.source) || sceneIds.has(edge.target)) {
                edgeIds.add(edge.id);
            }
        }
        return { sceneIds, edgeIds };
    }, [focus, graph]);

    /** What the rail is pointing at. Built from `branchIds` too, so fall-through arms light up. */
    const selectionHighlight = useMemo<SceneFlowHighlight | null>(() => {
        if (!resolvedSelection || !routeMap || !graph) {
            return null;
        }
        const sceneIds = new Set<StorySceneId>();
        const edgeIds = new Set<string>();
        const addRoutes = (matches: (route: SceneFlowRoute) => boolean): void => {
            for (const route of routeMap.routes) {
                if (!matches(route)) {
                    continue;
                }
                for (const id of route.sceneIds) {
                    sceneIds.add(id);
                }
                for (const step of route.steps) {
                    edgeIds.add(step.edgeId);
                }
                // Arms as well as edges: the last arm of a route that fell through owns no line,
                // and leaving it out would draw the walkthrough one decision short of itself.
                for (const branchId of route.branchIds) {
                    edgeIds.add(branchId);
                }
            }
        };
        switch (resolvedSelection.kind) {
            case "route":
                addRoutes(route => route.id === resolvedSelection.routeId);
                break;
            case "ending":
                // The ending itself even when no route reaches it: clicking a row must point at
                // something, and an all-dim map is indistinguishable from a broken one.
                sceneIds.add(resolvedSelection.sceneId);
                addRoutes(route => route.endingSceneId === resolvedSelection.sceneId);
                break;
            case "unreachableEndings":
                for (const sceneId of routeMap.unreachableEndings) {
                    sceneIds.add(sceneId);
                }
                break;
            case "deadBranches": {
                const dead = new Set(routeMap.deadBranchIds);
                for (const branch of graph.branches) {
                    if (dead.has(branch.id)) {
                        edgeIds.add(branch.id);
                        sceneIds.add(branch.sceneId);
                    }
                }
                for (const edge of graph.branchEdges) {
                    if (dead.has(edge.sourceBranchId)) {
                        edgeIds.add(edge.id);
                    }
                }
                break;
            }
        }
        return { sceneIds, edgeIds };
    }, [graph, resolvedSelection, routeMap]);

    if (!storyId) {
        return <CenteredNotice text={t("story.flow.empty.noStory")} />;
    }
    if (error) {
        return <CenteredNotice text={error} />;
    }
    if (!graph || !document || !routeMap) {
        return <CenteredNotice text={t("story.panel.loadingStory")} />;
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface">
            <div className="flex shrink-0 items-center gap-3 border-b border-edge px-3 py-1.5">
                <span className="truncate text-xs font-medium text-fg">{document.name}</span>
                <span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
                    {tn("story.flow.summary.scenes", graph.nodes.length)}
                    {" · "}
                    {tn("story.flow.summary.jumps", graph.edges.length)}
                </span>
                {graph.danglingJumpCount > 0 && (
                    <span className="flex shrink-0 items-center gap-1 text-2xs text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        {tn("story.flow.summary.dangling", graph.danglingJumpCount)}
                    </span>
                )}
                {graph.unreachableCount > 0 && (
                    <span className="shrink-0 text-2xs text-fg-subtle">
                        {tn("story.flow.summary.unreachable", graph.unreachableCount)}
                    </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {/* One hint at a time. With a variable focused the thing worth saying is what
                        the numbers on the boxes mean, not how to open a scene. */}
                    <span className="hidden text-2xs text-fg-subtle lg:inline">
                        {t(focus ? "story.flow.variable.hintArrival" : "story.flow.hint.openScene")}
                    </span>
                    {numericVariables.length > 0 && (
                        <Select
                            className="w-40 shrink-0"
                            size="sm"
                            portalMenu
                            // Changes what is SHOWN and writes nothing, so a frozen project must
                            // still be able to ask the question.
                            inspectOnly
                            options={variableOptions}
                            value={focusedKey}
                            onChange={value => setFocusedKey(String(value))}
                        />
                    )}
                    {forkedSceneIds.size > 0 && (
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="!min-h-0 !px-2 !py-1"
                            title={t(allExpanded ? "story.flow.branch.collapse" : "story.flow.branch.expand")}
                            onClick={handleToggleAllExpanded}
                        >
                            {allExpanded
                                ? <ChevronsDownUp className="mr-1 h-3.5 w-3.5 text-fg-muted" />
                                : <ChevronsUpDown className="mr-1 h-3.5 w-3.5 text-fg-muted" />}
                            <span className="text-2xs text-fg-muted">
                                {t(allExpanded ? "story.flow.branch.collapse" : "story.flow.branch.expand")}
                            </span>
                        </Button>
                    )}
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="!min-h-0 !px-2 !py-1"
                        title={t("story.flow.action.resetLayout")}
                        onClick={handleResetLayout}
                    >
                        <LayoutGrid className="mr-1 h-3.5 w-3.5 text-fg-muted" />
                        <span className="text-2xs text-fg-muted">{t("story.flow.action.resetLayout")}</span>
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="!min-h-0 !px-2 !py-1"
                        aria-pressed={railOpen}
                        title={t(railOpen ? "story.flow.route.hide" : "story.flow.route.show")}
                        onClick={() => setRailOpen(open => !open)}
                    >
                        <Route className={railOpen ? "mr-1 h-3.5 w-3.5 text-fg" : "mr-1 h-3.5 w-3.5 text-fg-muted"} />
                        <span className={railOpen ? "text-2xs text-fg" : "text-2xs text-fg-muted"}>
                            {t("story.flow.route.title")}
                        </span>
                    </Button>
                </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-row">
                <div className="min-h-0 min-w-0 flex-1">
                    {graph.nodes.length === 0 ? (
                        <CenteredNotice text={t("story.flow.empty.noScenes")} />
                    ) : (
                        <SceneFlowCanvas
                            graph={graph}
                            positionOverrides={positions}
                            initialViewport={initialViewportRef.current}
                            onOpenScene={handleOpenScene}
                            onMoveScene={handleMoveScene}
                            onViewportChange={handleViewportChange}
                            expandedSceneIds={expandedSceneIds}
                            onToggleSceneExpanded={handleToggleSceneExpanded}
                            branchChips={branchChips}
                            sceneChips={sceneChips}
                            // A rail selection is an answer to a question the author just asked, so
                            // it wins the mask. The chips stay either way - they are what the
                            // selected route is being read *for*.
                            highlight={selectionHighlight ?? variableHighlight}
                        />
                    )}
                </div>
                {railOpen && (
                    <SceneFlowRouteRail
                        graph={graph}
                        document={document}
                        routeMap={routeMap}
                        focus={focus}
                        selection={resolvedSelection}
                        onSelect={setSelection}
                        onClose={() => setRailOpen(false)}
                    />
                )}
            </div>
        </div>
    );
}

function CenteredNotice({ text }: { text: string }) {
    return (
        <div className="flex h-full items-center justify-center bg-surface p-6 text-center text-xs text-fg-subtle">
            {text}
        </div>
    );
}
