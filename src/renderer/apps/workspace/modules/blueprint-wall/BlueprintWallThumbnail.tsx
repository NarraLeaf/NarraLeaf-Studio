import { memo } from "react";
import { FileCode2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
    BLUEPRINT_COMMENT_COLORS,
    resolveBlueprintCommentColorKey,
} from "@/lib/ui-editor/blueprint-comment-colors";
import type {
    BlueprintLayerPreviewModel,
    MiniPreviewRole,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/blueprintLayerPreviewModel";

/**
 * A blueprint's first layer drawn as plain SVG: one rectangle per node, one curve per wire.
 *
 * The thumbnail beside a control (`BlueprintLayerPreview`) mounts a React Flow canvas of its own,
 * which is right for one card and far too heavy for a page of them. This draws the same model -
 * the same positions, the same estimated sizes, the same choice of layer - so a tile here and the
 * card in the inspector show the same picture.
 */

/** Below this the graph is padded out, so one node reads as one node rather than a filled box. */
const MIN_VIEW_WIDTH = 1100;
const MIN_VIEW_HEIGHT = 560;
const VIEW_PADDING = 60;

const ROLE_FILL: Record<MiniPreviewRole, string> = {
    event: "fill-primary/70",
    function: "fill-binding/70",
    data: "fill-warning/70",
    comment: "fill-transparent",
    normal: "fill-fg-muted/45",
};

function EmptyCaption({ children }: { children: string }) {
    return (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-2xs text-fg-subtle">
            {children}
        </div>
    );
}

export const BlueprintWallThumbnail = memo(function BlueprintWallThumbnail({
    model,
}: {
    /** Null until the tile has been on screen once. */
    model: BlueprintLayerPreviewModel | null;
}) {
    const { t } = useTranslation();
    if (!model) {
        return null;
    }
    if (model.emptyReason === "script") {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-fg-muted">
                <FileCode2 className="h-5 w-5" />
                <span className="max-w-full truncate text-2xs">{model.scriptFileName ?? t("blueprint.frontend.script")}</span>
            </div>
        );
    }
    if (model.emptyReason === "noLayer") {
        return <EmptyCaption>{t("widgetChrome.blueprint.noLayer")}</EmptyCaption>;
    }
    if (model.emptyReason === "emptyLayer" || model.nodes.length === 0) {
        return <EmptyCaption>{t("widgetChrome.blueprint.emptyLayer")}</EmptyCaption>;
    }

    const boxes = new Map(model.nodes.map(node => [node.id, {
        x: node.position.x,
        y: node.position.y,
        width: node.data.width,
        height: node.data.height,
    }]));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const box of boxes.values()) {
        minX = Math.min(minX, box.x);
        minY = Math.min(minY, box.y);
        maxX = Math.max(maxX, box.x + box.width);
        maxY = Math.max(maxY, box.y + box.height);
    }
    const width = Math.max(maxX - minX + VIEW_PADDING * 2, MIN_VIEW_WIDTH);
    const height = Math.max(maxY - minY + VIEW_PADDING * 2, MIN_VIEW_HEIGHT);
    const viewX = (minX + maxX) / 2 - width / 2;
    const viewY = (minY + maxY) / 2 - height / 2;

    return (
        <svg
            viewBox={`${viewX} ${viewY} ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
            className="h-full w-full"
            aria-hidden
        >
            {model.nodes.filter(node => node.data.role === "comment").map(node => {
                const color = BLUEPRINT_COMMENT_COLORS[resolveBlueprintCommentColorKey(node.data.colorKey)]!;
                return (
                    <rect
                        key={node.id}
                        x={node.position.x}
                        y={node.position.y}
                        width={node.data.width}
                        height={node.data.height}
                        rx={14}
                        fill={color.background}
                        stroke={color.border}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                    />
                );
            })}
            {model.edges.map(edge => {
                const from = boxes.get(edge.source);
                const to = boxes.get(edge.target);
                if (!from || !to) {
                    return null;
                }
                const sx = from.x + from.width;
                const sy = from.y + from.height / 2;
                const tx = to.x;
                const ty = to.y + to.height / 2;
                const bend = Math.max(40, Math.abs(tx - sx) / 2);
                return (
                    <path
                        key={edge.id}
                        d={`M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`}
                        className="fill-none stroke-fg-subtle"
                        strokeOpacity={0.7}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                    />
                );
            })}
            {model.nodes.filter(node => node.data.role !== "comment").map(node => (
                <rect
                    key={node.id}
                    x={node.position.x}
                    y={node.position.y}
                    width={node.data.width}
                    height={node.data.height}
                    rx={12}
                    className={ROLE_FILL[node.data.role]}
                />
            ))}
        </svg>
    );
});
