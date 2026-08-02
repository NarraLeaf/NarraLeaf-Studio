import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, ChevronDown, ChevronRight, EyeOff, Flag, RotateCcw } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import type { StorySceneId } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { SCENE_FLOW_NODE_HEIGHT, SCENE_FLOW_NODE_WIDTH, type SceneFlowNodeModel } from "./sceneFlowModel";

export type SceneFlowNodeData = SceneFlowNodeModel & {
    /** The running scene when embedded read-only in Dev Mode (SceneFlowCanvas `currentSceneId`). */
    current?: boolean;
    /**
     * The box's real height, straight from `SceneFlowGraph.nodeSizes` — an expanded scene is taller
     * than the constant. Recomputing it here would put the rows outside a box the layout spaced the
     * neighbours against.
     */
    height?: number;
    /** Fork arms this scene has. Zero means there is nothing to expand and no chevron is offered. */
    armCount?: number;
    expanded?: boolean;
    /** Short text from `SceneFlowCanvasProps.sceneChips` — a range, a count. */
    chip?: string;
    /** Outside the emphasis mask (`SceneFlowCanvasProps.highlight`). */
    dimmed?: boolean;
    /** Absent when the surface does not offer expansion at all; then no chevron renders. */
    onToggleExpanded?: (sceneId: StorySceneId) => void;
} & Record<string, unknown>;

/**
 * `text-xs` / `text-2xs` written out so the canvas can scale them (see `--nl-scene-flow-type-scale`).
 * The line-height scales with the size, or a grown title would be clipped by its own line box; with
 * the variable unset the computed values are byte-for-byte the two classes these replaced.
 */
const NODE_TITLE_STYLE: CSSProperties = {
    fontSize: "calc(0.75rem * var(--nl-scene-flow-type-scale, 1))",
    lineHeight: "calc(1rem * var(--nl-scene-flow-type-scale, 1))",
};
const NODE_META_STYLE: CSSProperties = {
    fontSize: "calc(0.6875rem * var(--nl-scene-flow-type-scale, 1))",
    lineHeight: "calc(1rem * var(--nl-scene-flow-type-scale, 1))",
};

/**
 * Edges still need handles to anchor to, but the map is read-only, so they are kept invisible: a
 * visible dot on the rim reads as "drag from here to connect", which is not on offer.
 *
 * Shared with the branch rows so an arm's handle sits exactly where the scene's does, one row down.
 */
export const SCENE_FLOW_HANDLE_CLASS = "!h-2 !w-2 !border-0 !bg-transparent !opacity-0";

/**
 * One scene. Everything that could be wrong with it (dangling jump, never reached) is a badge, so
 * the map doubles as a lint pass over the story's structure.
 *
 * Expanded, the box grows *downward* and its branch rows are separate React Flow children drawn
 * over the space that opens up. The title and meta block keep the top 72px either way, so toggling
 * a scene never moves the thing the author was looking at.
 */
export function SceneFlowNode({ data, selected }: NodeProps) {
    const { t, tn } = useTranslation();
    const scene = data as SceneFlowNodeData;
    const current = scene.current === true;
    const armCount = scene.armCount ?? 0;
    const onToggleExpanded = scene.onToggleExpanded;
    const expanded = scene.expanded === true;
    const canExpand = armCount > 0 && Boolean(onToggleExpanded);

    /**
     * The canvas opens a scene on double-click of the node, and React Flow raises that from the
     * node wrapper this button sits inside. Without the stop, aiming at the chevron would toggle
     * the rows *and* open the scene editor over the map the author was reading.
     */
    const swallow = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };

    const handleToggle = (event: MouseEvent) => {
        swallow(event);
        // `detail` counts the clicks of the current sequence (0 from the keyboard). Aiming twice at
        // a 12px target is easy to do by accident, and toggling on the way out and back in reads as
        // the chevron having done nothing at all.
        if (event.detail > 1) {
            return;
        }
        onToggleExpanded?.(scene.sceneId);
    };

    return (
        <div
            style={{ width: SCENE_FLOW_NODE_WIDTH, height: scene.height ?? SCENE_FLOW_NODE_HEIGHT }}
            className={cn(
                "group flex flex-col rounded-md border bg-surface-raised shadow-sm transition-colors",
                current
                    ? "border-primary ring-2 ring-primary/60"
                    : selected ? "border-primary ring-1 ring-primary/40" : "border-edge hover:border-edge-strong",
                scene.isEntry && !selected && !current && "border-l-2 border-l-primary",
                // Dimming wins over the unreachable tint: both say "look elsewhere", and stacking
                // two opacities would make an unreachable scene invisible rather than quiet.
                scene.dimmed ? "opacity-30" : !scene.reachable && "opacity-70",
            )}
            title={scene.name}
        >
            {/* Pinned to the title row rather than the box's centre, so expanding a scene does not
                drag every line that arrives at it downwards. At the collapsed height this is 50%. */}
            <Handle
                type="target"
                position={Position.Left}
                style={{ top: SCENE_FLOW_NODE_HEIGHT / 2 }}
                className={cn(SCENE_FLOW_HANDLE_CLASS, "!left-0")}
            />

            {/* Fixed at the collapsed node's height so the branch rows below it grow into new space
                instead of pushing the title around. */}
            <div
                style={{ height: SCENE_FLOW_NODE_HEIGHT }}
                className="flex shrink-0 flex-col justify-center gap-1 px-3 py-2"
            >
                <div className="flex min-w-0 items-center gap-1.5">
                    {scene.isEntry && (
                        <Flag className="h-3 w-3 shrink-0 text-primary" aria-label={t("story.flow.badge.entry")} />
                    )}
                    {/* Sized through the canvas's scale variable so a zoomed-out embed can keep the
                        title legible (SceneFlowCanvas `minTitleRenderedPx`). The fallbacks are
                        `text-xs`'s own numbers, so with the variable unset - the workspace tab -
                        nothing moves. */}
                    <span className="truncate font-medium text-fg" style={NODE_TITLE_STYLE}>{scene.name}</span>
                    {canExpand && (
                        <button
                            type="button"
                            // `nodrag`/`nopan`: without them a press on the chevron starts dragging
                            // the scene box, and the click never lands.
                            className={cn(
                                "nodrag nopan ml-auto flex shrink-0 items-center gap-0.5 rounded-sm px-0.5",
                                "text-fg-subtle transition-opacity hover:text-fg focus-visible:opacity-100",
                                expanded ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            )}
                            aria-expanded={expanded}
                            aria-label={t(expanded ? "story.flow.branch.collapse" : "story.flow.branch.expand")}
                            title={tn("story.flow.branch.forkCount", armCount)}
                            onClick={handleToggle}
                            onDoubleClick={swallow}
                        >
                            {expanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />}
                            <span className="tabular-nums" style={NODE_META_STYLE}>{armCount}</span>
                        </button>
                    )}
                </div>

                <div className="flex items-center gap-2 text-fg-subtle" style={NODE_META_STYLE}>
                    <span className="tabular-nums">{tn("story.flow.node.blocks", scene.blockCount)}</span>
                    {scene.selfJumpCount > 0 && (
                        <span
                            className="flex items-center gap-0.5"
                            title={tn("story.flow.badge.selfJump", scene.selfJumpCount)}
                        >
                            <RotateCcw className="h-3 w-3" />
                            <span className="tabular-nums">{scene.selfJumpCount}</span>
                        </span>
                    )}
                    {scene.danglingJumpCount > 0 && (
                        <span
                            className="flex items-center gap-0.5 text-warning"
                            title={tn("story.flow.badge.dangling", scene.danglingJumpCount)}
                        >
                            <AlertTriangle className="h-3 w-3" />
                            <span className="tabular-nums">{scene.danglingJumpCount}</span>
                        </span>
                    )}
                    {!scene.reachable && (
                        <EyeOff className="h-3 w-3" aria-label={t("story.flow.badge.unreachable")} />
                    )}
                    {scene.chip && (
                        <span className="ml-auto truncate rounded-sm bg-surface-sunken px-1 text-fg tabular-nums">
                            {scene.chip}
                        </span>
                    )}
                </div>
            </div>

            {/* Anchored to the collapsed box's rim, not the expanded one's centre: while a scene is
                expanded its lines leave the branch rows, and the few that do not (an unconditional
                jump written outside every fork) keep the position they had. */}
            <Handle
                type="source"
                position={Position.Right}
                style={{ top: SCENE_FLOW_NODE_HEIGHT / 2 }}
                className={cn(SCENE_FLOW_HANDLE_CLASS, "!right-0")}
            />
        </div>
    );
}
