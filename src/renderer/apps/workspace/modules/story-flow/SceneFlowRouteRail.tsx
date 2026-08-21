import { useMemo } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import type { Translator } from "@shared/i18n";
import type { StoryDocument, StorySceneId } from "@shared/types/story";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatSceneFlowArmLabel } from "./SceneFlowBranchNode";
import type { SceneFlowBranchNodeModel, SceneFlowGraph } from "./sceneFlowModel";
import { MAX_ROUTES, type SceneFlowEnding, type SceneFlowRoute, type SceneFlowRouteMap } from "./sceneFlowRoutes";
import {
    foldRouteVariableValue,
    type SceneFlowDelta,
    type SceneFlowNumericVariable,
    type SceneFlowRange,
    type SceneFlowVariableEffect,
} from "./sceneFlowVariables";

/**
 * U+2212 MINUS SIGN, not a hyphen.
 *
 * The chips are `tabular-nums`, and a hyphen is neither the width nor the height of the digits it
 * sits next to — a column of `+2` / `-1` reads as misaligned at the sizes the map is drawn at.
 */
const MINUS_SIGN = "−";

/** How much of a decision sequence a 15rem rail can carry before the `title` has to hold the rest. */
const ROUTE_LABEL_MAX_CHARS = 48;

/**
 * What the rail is currently making a point about. One selection at a time: two masks over one map
 * would need two colours, and the second colour is the one nobody can name.
 */
export type SceneFlowRouteSelection =
    /**
     * One row of the ending list: a {@link SceneFlowEnding.id}, or the scene id of a group of paths
     * that stop somewhere without reaching an ending. Both are rows of the same list, so they share
     * a variant rather than making every consumer ask which sort of row was clicked.
     */
    | { kind: "ending"; endingId: string }
    | { kind: "route"; routeId: string }
    | { kind: "unreachableEndings" }
    | { kind: "deadBranches" };

/**
 * Everything a focused numeric variable needs, gathered once by the tab.
 *
 * Passed in rather than derived here because the same three maps drive the canvas's chips: deriving
 * them twice is how the rail and the map start disagreeing about what a route is worth.
 */
export type SceneFlowVariableFocus = {
    variable: SceneFlowNumericVariable;
    /** {@link collectBranchEffects} — keyed by branch node id. */
    branchEffects: Map<string, SceneFlowVariableEffect[]>;
    /** {@link collectSceneEffects} — a scene's own spine writes. */
    sceneEffects: Map<StorySceneId, SceneFlowVariableEffect[]>;
    /** {@link computeVariableRanges} — the range **on arrival**, before the scene's own writes. */
    ranges: Map<StorySceneId, SceneFlowRange>;
    /**
     * The project registry, both project scopes, so a route's final value is folded from the same
     * declaration list `ranges` was computed against. Without it a registry-declared counter has no
     * default here and every route reads `?` while the scene boxes show real numbers.
     */
    registryVariables: readonly VariableRegistryEntry[];
};

export interface SceneFlowRouteRailProps {
    graph: SceneFlowGraph;
    document: StoryDocument;
    routeMap: SceneFlowRouteMap;
    focus: SceneFlowVariableFocus | null;
    /** Already validated against the current `routeMap` by the tab; a stale one arrives as null. */
    selection: SceneFlowRouteSelection | null;
    onSelect: (selection: SceneFlowRouteSelection | null) => void;
    onClose: () => void;
}

/** A negative number with a real minus sign. */
function formatNumber(value: number): string {
    return value < 0 ? `${MINUS_SIGN}${Math.abs(value)}` : String(value);
}

/**
 * One arm's movement, as the chip on its row and on the line leaving it.
 *
 * `null` never reaches here: an arm that does not touch the variable gets no chip at all, because a
 * chip that says nothing is noise on every other row of the fork.
 */
export function formatSceneFlowDelta(delta: SceneFlowDelta): string {
    if (delta.op === "unknown") {
        return "?";
    }
    if (delta.op === "set") {
        return `=${formatNumber(delta.value)}`;
    }
    return delta.amount < 0 ? `${MINUS_SIGN}${Math.abs(delta.amount)}` : `+${delta.amount}`;
}

/**
 * A range or a single value, carrying the variable's name.
 *
 * The name is not decoration: a bare `0–7` floating on a scene box is a number with no subject, and
 * the picker that chose it is one glance away at the top of the tab rather than on the box.
 */
export function formatSceneFlowVariableChip(
    range: SceneFlowRange,
    name: string,
    t: Translator["t"],
): string {
    if (range.kind === "unknown") {
        return t("story.flow.variable.unknownChip", { name });
    }
    if (range.min === range.max) {
        return t("story.flow.variable.valueChip", { name, value: formatNumber(range.min) });
    }
    return t("story.flow.variable.rangeChip", {
        name,
        min: formatNumber(range.min),
        max: formatNumber(range.max),
    });
}

/** One row of the list: an ending, or a place paths stop without reaching one. */
type SceneFlowRouteGroup = {
    /** {@link SceneFlowEnding.id} for an ending, the scene id for a group of paths that stop. */
    key: string;
    sceneId: StorySceneId;
    /** The ending's name, or the scene's when the row is not an ending. */
    name: string;
    /**
     * The scene this ending is in, when {@link name} is the ending's own name rather than the
     * scene's. Null otherwise, so the row does not print the same word twice — and several endings
     * in one scene each say where they are, which is the whole reason they are separate rows.
     */
    sceneName: string | null;
    routes: SceneFlowRoute[];
    /**
     * An ending. `false` means paths merely *stop* here — cut at a cycle, an option that ran out of
     * continuations, or a scene with no way out in a story that marks its endings elsewhere.
     */
    isEnding: boolean;
    /** Only meaningful for an ending: reachable from the entry scene. */
    reachable: boolean;
};

const ROW_CLASS = "flex w-full min-w-0 cursor-default items-center gap-1.5 px-2 py-1 text-left text-2xs";

/** One string per distinct selection, so "is this already selected" is one comparison. */
function selectionKey(selection: SceneFlowRouteSelection): string {
    switch (selection.kind) {
        case "ending":
            return `ending:${selection.endingId}`;
        case "route":
            return `route:${selection.routeId}`;
        default:
            return selection.kind;
    }
}

/**
 * The list row a route belongs to: the ending it reached, or the scene it stopped in.
 *
 * One function so the rail's grouping and the tab's highlight cannot key the same route two ways.
 */
export function sceneFlowRouteGroupKey(route: SceneFlowRoute): string {
    return route.endingId ?? route.endingSceneId;
}

/**
 * The route map, read as a list.
 *
 * Slim and collapsible because it is a second reading of the same graph, not a second surface: the
 * map answers "what is the shape of this story", the rail answers "and where does each way through
 * it come out". Selecting in one masks the other.
 */
export function SceneFlowRouteRail({
    graph,
    document,
    routeMap,
    focus,
    selection,
    onSelect,
    onClose,
}: SceneFlowRouteRailProps) {
    const { t, tn } = useTranslation();

    const armsById = useMemo(() => {
        const byId = new Map<string, SceneFlowBranchNodeModel>();
        for (const branch of graph.branches) {
            byId.set(branch.id, branch);
        }
        return byId;
    }, [graph]);

    const groups = useMemo<SceneFlowRouteGroup[]>(() => {
        const routesByKey = new Map<string, SceneFlowRoute[]>();
        for (const route of routeMap.routes) {
            const key = sceneFlowRouteGroupKey(route);
            const list = routesByKey.get(key);
            if (list) {
                list.push(route);
            } else {
                routesByKey.set(key, [route]);
            }
        }
        const endingsBySceneId = new Map<StorySceneId, SceneFlowEnding[]>();
        for (const ending of routeMap.endings) {
            const list = endingsBySceneId.get(ending.sceneId);
            if (list) {
                list.push(ending);
            } else {
                endingsBySceneId.set(ending.sceneId, [ending]);
            }
        }

        // Walked in the graph's scene order rather than the routes' discovery order, so re-opening
        // the tab lists the endings the way the outline does, and the several endings of one scene
        // sit together. Scene names come from the document: a route can stop in a scene that holds
        // no ending at all, and a lookup into `endings` would miss it.
        const result: SceneFlowRouteGroup[] = [];
        for (const node of graph.nodes) {
            const sceneName = document.scenes[node.sceneId]?.name ?? node.name;
            const endings = endingsBySceneId.get(node.sceneId) ?? [];
            for (const ending of endings) {
                const authored = ending.source === "authored";
                result.push({
                    key: ending.id,
                    sceneId: node.sceneId,
                    name: authored ? ending.name || t("story.flow.route.endingUnnamed") : sceneName,
                    sceneName: authored ? sceneName : null,
                    routes: routesByKey.get(ending.id) ?? [],
                    isEnding: true,
                    reachable: ending.reachable,
                });
            }
            // Paths that stop in this scene without reaching an ending. Its own row, below the
            // scene's endings, because "some ways through end here and some just run out" is a
            // sentence the rail has to be able to say about one scene.
            const stopped = routesByKey.get(node.sceneId);
            if (stopped && !endings.some(ending => ending.id === node.sceneId)) {
                result.push({
                    key: node.sceneId,
                    sceneId: node.sceneId,
                    name: sceneName,
                    sceneName: null,
                    routes: stopped,
                    isEnding: false,
                    reachable: true,
                });
            }
        }
        return result;
    }, [document, graph, routeMap, t]);

    /**
     * The row whose routes are listed. Derived from the selection rather than held as its own
     * state: selecting a route inside a row must not fold the row shut under it, and a document
     * reload that drops the selection has to drop the open row with it.
     */
    const openKey = useMemo<string | null>(() => {
        if (selection?.kind === "ending") {
            return selection.endingId;
        }
        if (selection?.kind === "route") {
            const route = routeMap.routes.find(item => item.id === selection.routeId);
            return route ? sceneFlowRouteGroupKey(route) : null;
        }
        return null;
    }, [routeMap, selection]);

    const hasEntryScene = Boolean(document.entrySceneId && document.scenes[document.entrySceneId]);

    /** Clicking what is already selected clears it — the second click undoes the first. */
    const toggle = (next: SceneFlowRouteSelection): void => {
        onSelect(selection && selectionKey(selection) === selectionKey(next) ? null : next);
    };

    const routeLabel = (route: SceneFlowRoute): string => {
        const decisions = route.branchIds
            .map(branchId => armsById.get(branchId))
            .filter((arm): arm is SceneFlowBranchNodeModel => Boolean(arm))
            .map(arm => formatSceneFlowArmLabel(arm, t));
        return decisions.length === 0 ? t("story.flow.route.noDecisions") : decisions.join(" → ");
    };

    return (
        <aside className="flex h-full w-60 shrink-0 flex-col border-l border-edge bg-surface">
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-2 py-1.5">
                <span className="truncate text-xs font-medium text-fg">{t("story.flow.route.title")}</span>
                {/* "200+" once the walk hit the cap. The plural key would read "200 routes" and
                    present the cap as the total, which is the one thing the map must never do. */}
                <span className="shrink-0 text-2xs text-fg-subtle tabular-nums">
                    {routeMap.truncated
                        ? t("story.flow.route.countTruncated", { count: routeMap.routes.length })
                        : tn("story.flow.route.count", routeMap.routes.length)}
                </span>
                <button
                    type="button"
                    className="ml-auto shrink-0 cursor-default rounded-sm p-0.5 text-fg-subtle hover:bg-fill hover:text-fg"
                    data-tip={t("story.flow.route.hide")}
                    aria-label={t("story.flow.route.hide")}
                    onClick={onClose}
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {routeMap.truncated && (
                    <p className="border-b border-edge px-2 py-1.5 text-2xs text-warning">
                        {t("story.flow.route.truncated", { count: MAX_ROUTES })}
                    </p>
                )}
                {routeMap.routes.length === 0 && (
                    <p className="px-2 py-1.5 text-2xs text-fg-subtle">
                        {t(hasEntryScene ? "story.flow.route.noRoutes" : "story.flow.route.noEntryScene")}
                    </p>
                )}

                {groups.map(group => {
                    const open = openKey === group.key;
                    const selected = selection?.kind === "ending" && selection.endingId === group.key;
                    const range = focus?.ranges.get(group.sceneId);
                    return (
                        <div key={group.key}>
                            <button
                                type="button"
                                className={cn(
                                    ROW_CLASS,
                                    "items-start",
                                    selected ? "bg-fill text-fg" : "text-fg-muted hover:bg-fill-subtle hover:text-fg",
                                )}
                                aria-expanded={open}
                                onClick={() => toggle({ kind: "ending", endingId: group.key })}
                            >
                                {open
                                    ? <ChevronDown className="mt-px h-3 w-3 shrink-0" />
                                    : <ChevronRight className="mt-px h-3 w-3 shrink-0" />}
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="flex min-w-0 items-center gap-1">
                                        <span className="min-w-0 truncate" data-tip={group.name}>{group.name}</span>
                                        {group.isEnding && !group.reachable && (
                                            <AlertTriangle
                                                className="h-3 w-3 shrink-0 text-warning"
                                                aria-label={t("story.flow.badge.unreachable")}
                                            />
                                        )}
                                        {!group.isEnding && (
                                            <span
                                                className="shrink-0 text-fg-subtle"
                                                data-tip={t("story.flow.route.stopsHereTitle")}
                                            >
                                                {t("story.flow.route.stopsHere")}
                                            </span>
                                        )}
                                    </span>
                                    {group.sceneName && (
                                        <span className="truncate text-fg-subtle" data-tip={group.sceneName}>
                                            {group.sceneName}
                                        </span>
                                    )}
                                    {focus && range && (
                                        <span
                                            className="truncate text-fg-subtle tabular-nums"
                                            data-tip={t("story.flow.variable.arrivalTitle")}
                                        >
                                            {formatSceneFlowVariableChip(range, focus.variable.name, t)}
                                        </span>
                                    )}
                                </span>
                                <span className="shrink-0 text-fg-subtle tabular-nums">{group.routes.length}</span>
                            </button>

                            {open && group.routes.map(route => {
                                const label = routeLabel(route);
                                const active = selection?.kind === "route" && selection.routeId === route.id;
                                return (
                                    <button
                                        key={route.id}
                                        type="button"
                                        className={cn(
                                            ROW_CLASS,
                                            "pl-6",
                                            active
                                                ? "bg-fill text-fg"
                                                : "text-fg-subtle hover:bg-fill-subtle hover:text-fg",
                                        )}
                                        data-tip={label} aria-label={label}
                                        onClick={() => toggle({ kind: "route", routeId: route.id })}
                                    >
                                        <span className="min-w-0 flex-1 truncate">
                                            {label.length > ROUTE_LABEL_MAX_CHARS
                                                ? `${label.slice(0, ROUTE_LABEL_MAX_CHARS - 1)}…`
                                                : label}
                                        </span>
                                        {focus && (
                                            <span
                                                className="shrink-0 rounded-sm bg-surface-sunken px-1 text-fg tabular-nums"
                                                data-tip={t("story.flow.variable.finalTitle")}
                                            >
                                                {routeValueChip(graph, document, route, focus)}
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

            {(routeMap.unreachableEndings.length > 0 || routeMap.deadBranchIds.length > 0) && (
                <div className="shrink-0 border-t border-edge py-0.5">
                    {routeMap.unreachableEndings.length > 0 && (
                        <button
                            type="button"
                            className={cn(
                                ROW_CLASS,
                                selection?.kind === "unreachableEndings"
                                    ? "bg-fill text-fg"
                                    : "text-warning hover:bg-fill-subtle",
                            )}
                            onClick={() => toggle({ kind: "unreachableEndings" })}
                        >
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                                {tn("story.flow.route.diagnostics.unreachableEndings", routeMap.unreachableEndings.length)}
                            </span>
                        </button>
                    )}
                    {routeMap.deadBranchIds.length > 0 && (
                        <button
                            type="button"
                            className={cn(
                                ROW_CLASS,
                                selection?.kind === "deadBranches"
                                    ? "bg-fill text-fg"
                                    : "text-fg-subtle hover:bg-fill-subtle hover:text-fg",
                            )}
                            onClick={() => toggle({ kind: "deadBranches" })}
                        >
                            <span className="min-w-0 flex-1 truncate">
                                {tn("story.flow.route.diagnostics.deadBranches", routeMap.deadBranchIds.length)}
                            </span>
                        </button>
                    )}
                </div>
            )}
        </aside>
    );
}

/** `?` rather than a number the fold had to guess at — see {@link foldRouteVariableValue}. */
function routeValueChip(
    graph: SceneFlowGraph,
    document: StoryDocument,
    route: SceneFlowRoute,
    focus: SceneFlowVariableFocus,
): string {
    const folded = foldRouteVariableValue(graph, document, focus.variable.key, route, focus.registryVariables);
    return folded.kind === "known" ? formatNumber(folded.min) : "?";
}
