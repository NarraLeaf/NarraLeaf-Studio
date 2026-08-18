import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import type { CSSProperties } from "react";
import type { Translator } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { SCENE_FLOW_CONNECTABLE_HANDLE_CLASS, SCENE_FLOW_HANDLE_CLASS } from "./SceneFlowNode";
import {
  SCENE_FLOW_BRANCH_HEADER_HEIGHT,
  SCENE_FLOW_BRANCH_ROW_HEIGHT,
  SCENE_FLOW_NODE_WIDTH,
  type SceneFlowBranchKind,
  type SceneFlowBranchNodeModel
} from "./sceneFlowModel";

/**
 * How one arm reads, for the line that leaves it and for the row it leaves from.
 *
 * One function for both on purpose: an `else` is worded "otherwise" and an `else if` is prefixed
 * with its container's wording, and two copies of that reasoning drift the first time a branch kind
 * is added — after which the row and the edge that starts on it word the same fork two ways.
 *
 * An empty label means the arm carries no text of its own (a bare `else`, an option nobody has
 * typed into yet), never that the text was lost — see `SceneFlowBranchNodeModel.label`.
 */
export function formatSceneFlowArmLabel(
  arm: { kind: SceneFlowBranchKind; label: string },
  t: Translator["t"]
): string {
  if (arm.kind === "conditionElse") {
    return t("story.containerHeader.else");
  }
  if (arm.kind === "conditionElseIf") {
    const elseIf = t("story.containerHeader.elseIf");
    return arm.label ? `${elseIf} ${arm.label}` : elseIf;
  }
  return arm.label || t("story.containerHeader.option");
}

export type SceneFlowBranchNodeData = SceneFlowBranchNodeModel & {
  /**
   * This arm opens its fork, so it carries the fork's header row above its own. The header is
   * part of the first arm rather than a node of its own: the model already budgeted one
   * `SCENE_FLOW_BRANCH_HEADER_HEIGHT` per fork, and folding it in keeps the rows of a scene
   * adding up to exactly the height the layout packed its neighbours against.
   */
  showForkHeader?: boolean;
  /** Short text from `SceneFlowCanvasProps.branchChips` — a delta, a count, a `?`. */
  chip?: string;
  /** Outside the emphasis mask (`SceneFlowCanvasProps.highlight`). */
  dimmed?: boolean;
} & Record<string, unknown>;

/**
 * `text-2xs`-ish, written out so the canvas's type scale reaches it the way it reaches the scene
 * title (`--nl-scene-flow-type-scale`). The line box is deliberately shorter than the row it sits
 * in, so the largest scale the canvas allows still fits inside `SCENE_FLOW_BRANCH_ROW_HEIGHT`.
 */
const BRANCH_ROW_STYLE: CSSProperties = {
  fontSize: "calc(0.6875rem * var(--nl-scene-flow-type-scale, 1))",
  lineHeight: "calc(0.875rem * var(--nl-scene-flow-type-scale, 1))"
};
const FORK_HEADER_STYLE: CSSProperties = {
  fontSize: "calc(0.625rem * var(--nl-scene-flow-type-scale, 1))",
  lineHeight: "calc(0.75rem * var(--nl-scene-flow-type-scale, 1))"
};

/**
 * One arm of one fork, drawn as a row inside its scene's box.
 *
 * The row exists for its handle: five options must leave from five distinct points, which a single
 * scene-level source handle cannot do however the lines are labelled. Everything else here — the
 * wording, the fall-through marker, the broken-jump badge — is the scene node's vocabulary applied
 * one level down, so the map reads as one map.
 */
export function SceneFlowBranchNode({ data, isConnectable }: NodeProps) {
  const { t, tn } = useTranslation();
  const arm = data as SceneFlowBranchNodeData;
  const headerHeight = arm.showForkHeader ? SCENE_FLOW_BRANCH_HEADER_HEIGHT : 0;
  const label = formatSceneFlowArmLabel(arm, t);

  return (
    // `group` for the handle's hover reveal: React Flow renders a child node as a DOM sibling of
    // its parent, not inside it, so the scene box's own group never reaches this row.
    <div
      style={{ width: SCENE_FLOW_NODE_WIDTH, height: headerHeight + SCENE_FLOW_BRANCH_ROW_HEIGHT }}
      className={cn("group relative flex flex-col", arm.dimmed && "opacity-30")}
    >
      {arm.showForkHeader && (
        <div
          style={{ height: SCENE_FLOW_BRANCH_HEADER_HEIGHT, ...FORK_HEADER_STYLE }}
          className="flex items-center overflow-hidden border-t border-edge px-3 uppercase tracking-wide text-fg-subtle"
        >
          <span className="truncate">
            {t(
              arm.forkKind === "choice"
                ? "story.flow.branch.forkChoice"
                : "story.flow.branch.forkCondition"
            )}
          </span>
        </div>
      )}

      <div
        style={{ height: SCENE_FLOW_BRANCH_ROW_HEIGHT, ...BRANCH_ROW_STYLE }}
        className="flex min-w-0 items-center gap-1.5 overflow-hidden px-3 text-fg-muted"
        data-tip={label}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {arm.chip && (
          <span className="shrink-0 rounded-sm bg-surface-sunken px-1 text-fg tabular-nums">
            {arm.chip}
          </span>
        )}
        {arm.danglingJumpCount > 0 && (
          <span
            className="flex shrink-0 items-center gap-0.5 text-warning"
            data-tip={tn("story.flow.badge.dangling", arm.danglingJumpCount)}
          >
            <AlertTriangle className="h-3 w-3" />
            <span className="tabular-nums">{arm.danglingJumpCount}</span>
          </span>
        )}
        {arm.fallsThrough && (
          <span
            className="shrink-0 text-fg-subtle"
            data-tip={t("story.flow.branch.fallsThroughTitle")}
          >
            {t("story.flow.branch.fallsThrough")}
          </span>
        )}
      </div>

      {/* Keyed by the arm's own id, so the edges the model attributed to this arm start on
                this row rather than on the scene's single rim handle — and so a line dragged from
                this row proposes its jump INSIDE this option, which is the only reason an arm-level
                handle is worth having over the scene's. */}
      <Handle
        type="source"
        id={arm.id}
        position={Position.Right}
        style={{ top: headerHeight + SCENE_FLOW_BRANCH_ROW_HEIGHT / 2 }}
        className={cn(
          isConnectable ? SCENE_FLOW_CONNECTABLE_HANDLE_CLASS : SCENE_FLOW_HANDLE_CLASS,
          "!right-0"
        )}
      />
    </div>
  );
}
