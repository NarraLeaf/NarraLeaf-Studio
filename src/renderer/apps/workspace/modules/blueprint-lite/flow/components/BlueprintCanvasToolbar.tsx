/**
 * The blueprint canvas toolbar: which gesture a drag is, and the two edits that act on the whole
 * graph rather than on one card.
 *
 * Parked in the canvas's free corner rather than added as a bar under the editor header, for the
 * same reason the zoom control is: a second full-width strip above a canvas is chrome the graph
 * pays for on every screen, and the editor header already occupies that row. It borrows the zoom
 * control's shell exactly - the two are the same kind of thing sitting on the same canvas, so they
 * have no business looking different.
 *
 * Comments in English per project convention.
 */

import { ChevronDown, Group, Hand, MoveDown, MoveRight, MousePointer2, Wand2 } from "lucide-react";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { TooltipGroup } from "@/lib/tooltip";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
    SurfaceToolbarPopoverPanel,
    SurfaceToolbarPopoverRow,
    useSurfaceToolbarPopover,
} from "@/apps/workspace/modules/ui-editor/editors/SurfaceEditorToolbarPopover";
import { BLUEPRINT_COMMENT_COLORS, blueprintCommentColorLabel } from "../blueprintCommentColors";
import type { BlueprintLayoutDirection } from "../blueprintAutoLayout";

/** What a drag on empty canvas does. */
export type BlueprintCanvasTool = "select" | "pan";

/** The two ways a graph can be laid out, in the order the menu offers them. */
const FORMAT_DIRECTIONS = [
    { key: "horizontal", icon: MoveRight, labelKey: "blueprint.format.horizontal" },
    { key: "vertical", icon: MoveDown, labelKey: "blueprint.format.vertical" },
] as const satisfies readonly { key: BlueprintLayoutDirection; icon: typeof MoveRight; labelKey: string }[];

export type BlueprintCanvasToolbarProps = {
    tool: BlueprintCanvasTool;
    onToolChange: (tool: BlueprintCanvasTool) => void;
    /** The colour the plain Group button uses - the last one the author picked. */
    groupColor: string;
    onCreateGroup: (color: string) => void;
    /** False with nothing selected: a group has to be a group of something. */
    canGroup: boolean;
    /** The direction the plain Format button uses - the last one the author picked. */
    formatDirection: BlueprintLayoutDirection;
    onFormat: (direction: BlueprintLayoutDirection) => void;
    /** False on an empty graph, where formatting has nothing to arrange. */
    canFormat: boolean;
};

export function BlueprintCanvasToolbar({
    tool,
    onToolChange,
    groupColor,
    onCreateGroup,
    canGroup,
    formatDirection,
    onFormat,
    canFormat,
}: BlueprintCanvasToolbarProps) {
    const { t } = useTranslation();
    const freeze = useFreezeGuard();
    const colors = useSurfaceToolbarPopover();
    const directions = useSurfaceToolbarPopover();

    return (
        <TooltipGroup
            // Below, not above: the toolbar sits against the top of the canvas, and a tip opening
            // upwards from here would be drawn over the editor's own header.
            side="bottom"
            className="absolute right-3 top-3 z-[5] flex items-center gap-0.5 rounded-lg border border-edge bg-surface-overlay p-0.5 shadow-lg"
            // The canvas underneath treats a press as the start of a marquee or a pan.
            onPointerDown={e => e.stopPropagation()}
        >
            <ToolbarButton
                size="sm"
                active={tool === "select"}
                aria-label={t("blueprint.tool.select")}
                data-tip={t("blueprint.tool.select")}
                aria-pressed={tool === "select"}
                onClick={() => onToolChange("select")}
            >
                <MousePointer2 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                size="sm"
                active={tool === "pan"}
                aria-label={t("blueprint.tool.pan")}
                data-tip={t("blueprint.tool.pan")}
                aria-pressed={tool === "pan"}
                onClick={() => onToolChange("pan")}
            >
                <Hand className="h-3.5 w-3.5" />
            </ToolbarButton>
            <div className="mx-0.5 h-5 w-px bg-edge" />
            {/* The button groups in the colour the author last chose, and the chevron is where a
                different one is picked - the same bargain the zoom control makes with its
                percentage: the common answer costs one click, the rest cost two. */}
            <ToolbarButton
                size="sm"
                aria-label={t("blueprint.group.create")}
                {...freeze.writes(!canGroup, t("blueprint.group.create"))}
                onClick={() => onCreateGroup(groupColor)}
            >
                <Group className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                ref={colors.triggerRef}
                size="sm"
                aria-label={t("blueprint.group.color")}
                aria-expanded={colors.open}
                aria-haspopup="dialog"
                {...freeze.writes(!canGroup, t("blueprint.group.color"))}
                onClick={colors.toggle}
            >
                <ChevronDown className="h-3.5 w-3.5" />
            </ToolbarButton>
            <SurfaceToolbarPopoverPanel popover={colors} dataAttribute="blueprint-group-color">
                {Object.entries(BLUEPRINT_COMMENT_COLORS).map(([key, color]) => (
                    <SurfaceToolbarPopoverRow
                        key={key}
                        icon={
                            <span
                                className="h-3 w-3 rounded-full border border-edge-strong"
                                style={{ background: color.swatch }}
                            />
                        }
                        label={blueprintCommentColorLabel(key, t)}
                        onClick={() => {
                            colors.close();
                            onCreateGroup(key);
                        }}
                    />
                ))}
            </SurfaceToolbarPopoverPanel>
            <div className="mx-0.5 h-5 w-px bg-edge" />
            {/* Same bargain as the group button beside it: the direction the author last formatted
                in costs one click, the other one costs two. */}
            <ToolbarButton
                size="sm"
                aria-label={t("blueprint.format.graph")}
                {...freeze.writes(!canFormat, t("blueprint.format.graph"))}
                onClick={() => onFormat(formatDirection)}
            >
                <Wand2 className="h-3.5 w-3.5" />
            </ToolbarButton>
            <ToolbarButton
                ref={directions.triggerRef}
                size="sm"
                aria-label={t("blueprint.format.direction")}
                aria-expanded={directions.open}
                aria-haspopup="dialog"
                {...freeze.writes(!canFormat, t("blueprint.format.direction"))}
                onClick={directions.toggle}
            >
                <ChevronDown className="h-3.5 w-3.5" />
            </ToolbarButton>
            <SurfaceToolbarPopoverPanel popover={directions} dataAttribute="blueprint-format-direction">
                {FORMAT_DIRECTIONS.map(({ key, icon: Icon, labelKey }) => (
                    <SurfaceToolbarPopoverRow
                        key={key}
                        icon={<Icon className="h-3.5 w-3.5" />}
                        label={t(labelKey)}
                        selected={formatDirection === key}
                        onClick={() => {
                            directions.close();
                            onFormat(key);
                        }}
                    />
                ))}
            </SurfaceToolbarPopoverPanel>
        </TooltipGroup>
    );
}
