import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, EyeOff, Flag, RotateCcw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { SCENE_FLOW_NODE_HEIGHT, SCENE_FLOW_NODE_WIDTH, type SceneFlowNodeModel } from "./sceneFlowModel";

export type SceneFlowNodeData = SceneFlowNodeModel & Record<string, unknown>;

const HANDLE_CLASS = "!h-2 !w-2 !border !border-edge-strong !bg-surface-raised";

/**
 * One scene. Everything that could be wrong with it (dangling jump, never reached) is a badge, so
 * the map doubles as a lint pass over the story's structure.
 */
export function SceneFlowNode({ data, selected }: NodeProps) {
    const { t, tn } = useTranslation();
    const scene = data as SceneFlowNodeData;

    return (
        <div
            style={{ width: SCENE_FLOW_NODE_WIDTH, height: SCENE_FLOW_NODE_HEIGHT }}
            className={cn(
                "flex flex-col justify-center gap-1 rounded-md border bg-surface-raised px-3 py-2 shadow-sm transition-colors",
                selected ? "border-primary ring-1 ring-primary/40" : "border-edge hover:border-edge-strong",
                scene.isEntry && !selected && "border-l-2 border-l-primary",
                !scene.reachable && "opacity-70",
            )}
            title={scene.name}
        >
            <Handle type="target" position={Position.Left} className={cn(HANDLE_CLASS, "!left-0")} />

            <div className="flex min-w-0 items-center gap-1.5">
                {scene.isEntry && (
                    <Flag className="h-3 w-3 shrink-0 text-primary" aria-label={t("story.flow.badge.entry")} />
                )}
                <span className="truncate text-xs font-medium text-fg">{scene.name}</span>
            </div>

            <div className="flex items-center gap-2 text-2xs text-fg-subtle">
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
            </div>

            <Handle type="source" position={Position.Right} className={cn(HANDLE_CLASS, "!right-0")} />
        </div>
    );
}
