/**
 * The blueprint canvas toolbar: which gesture a drag is, where the view is, and the two edits that
 * act on the whole graph rather than on one card.
 *
 * Parked in the canvas's free corner rather than added as a bar under the editor header: a second
 * full-width strip above a canvas is chrome the graph pays for on every screen, and the editor
 * header already occupies that row.
 *
 * It is built out of the surface editor's toolbar parts, in the same corner, at the same size, in
 * the same order - tools, zoom, then the actions. The two canvases are the same kind of thing, so
 * an author who learned the toolbar on one has learned it for both, and there is no second set of
 * button styles here to drift away from that one.
 *
 * Comments in English per project convention.
 */

import { ChevronDown, Group, Hand, MoveDown, MoveRight, MousePointer2, Wand2 } from "lucide-react";
import { TooltipGroup } from "@/lib/tooltip";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import {
    SurfaceEditorToolbarButton,
    SurfaceEditorToolbarButtonGroup,
    SurfaceEditorToolbarSegButton,
} from "@/apps/workspace/modules/ui-editor/editors/SurfaceEditorToolbarButtonGroup";
import {
    SurfaceToolbarPopoverPanel,
    SurfaceToolbarPopoverRow,
    useSurfaceToolbarPopover,
} from "@/apps/workspace/modules/ui-editor/editors/SurfaceEditorToolbarPopover";
import { BLUEPRINT_COMMENT_COLORS, blueprintCommentColorLabel } from "@/lib/ui-editor/blueprint-comment-colors";
import { BlueprintZoomMenu } from "./BlueprintZoomMenu";
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
            className="absolute right-3 top-3 z-[5] flex items-center gap-2 rounded-md border border-edge-strong bg-surface-canvas/80 px-2 py-1"
            // The canvas underneath treats a press as the start of a marquee or a pan.
            onPointerDown={e => e.stopPropagation()}
        >
            <SurfaceEditorToolbarButton
                active={tool === "select"}
                aria-label={t("blueprint.tool.select")}
                data-tip={t("blueprint.tool.select")}
                aria-pressed={tool === "select"}
                onClick={() => onToolChange("select")}
            >
                <MousePointer2 className="h-4 w-4" />
            </SurfaceEditorToolbarButton>
            <SurfaceEditorToolbarButton
                active={tool === "pan"}
                aria-label={t("blueprint.tool.pan")}
                data-tip={t("blueprint.tool.pan")}
                aria-pressed={tool === "pan"}
                onClick={() => onToolChange("pan")}
            >
                <Hand className="h-4 w-4" />
            </SurfaceEditorToolbarButton>
            <BlueprintZoomMenu />
            {/* The button groups in the colour the author last chose, and the chevron is where a
                different one is picked - the same bargain the zoom control makes with its
                percentage: the common answer costs one click, the rest cost two. */}
            <SurfaceEditorToolbarButtonGroup aria-label={t("blueprint.group.create")}>
                <SurfaceEditorToolbarSegButton
                    aria-label={t("blueprint.group.create")}
                    {...freeze.writes(!canGroup, t("blueprint.group.create"))}
                    onClick={() => onCreateGroup(groupColor)}
                >
                    <Group className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
                <SurfaceEditorToolbarSegButton
                    ref={colors.triggerRef}
                    active={colors.open}
                    aria-label={t("blueprint.group.color")}
                    aria-expanded={colors.open}
                    aria-haspopup="dialog"
                    {...freeze.writes(!canGroup, t("blueprint.group.color"))}
                    onClick={colors.toggle}
                >
                    <ChevronDown className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
            </SurfaceEditorToolbarButtonGroup>
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
            {/* Same bargain as the group button beside it: the direction the author last formatted
                in costs one click, the other one costs two. */}
            <SurfaceEditorToolbarButtonGroup aria-label={t("blueprint.format.graph")}>
                <SurfaceEditorToolbarSegButton
                    aria-label={t("blueprint.format.graph")}
                    {...freeze.writes(!canFormat, t("blueprint.format.graph"))}
                    onClick={() => onFormat(formatDirection)}
                >
                    <Wand2 className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
                <SurfaceEditorToolbarSegButton
                    ref={directions.triggerRef}
                    active={directions.open}
                    aria-label={t("blueprint.format.direction")}
                    aria-expanded={directions.open}
                    aria-haspopup="dialog"
                    {...freeze.writes(!canFormat, t("blueprint.format.direction"))}
                    onClick={directions.toggle}
                >
                    <ChevronDown className="h-4 w-4" />
                </SurfaceEditorToolbarSegButton>
            </SurfaceEditorToolbarButtonGroup>
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
