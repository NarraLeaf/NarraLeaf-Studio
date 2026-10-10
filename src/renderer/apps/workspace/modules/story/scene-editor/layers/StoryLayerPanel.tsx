import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Layers, Video } from "lucide-react";
import type { StoryBlockId, StoryLayerDepth, StoryScene } from "@shared/types/story";
import { STORY_LAYER_DEPTHS } from "@shared/types/story";
import { useTranslation } from "@/lib/i18n";
import { Select } from "@/lib/components/elements";
import { useFloatingLayer, useHostDocument } from "@/lib/components/layout";
import { cn } from "@/lib/utils/cn";
import { storyLayerDepthLabel } from "@/lib/story/storyLayerLabel";
import { keepStoryKeysInPopover } from "../PausePopover";
import { buildStoryLayerPanel, type StoryLayerContent, type StoryLayerPanelEntry } from "./storyLayerPanelModel";

const PANEL_WIDTH = 480;
const VIEWPORT_MARGIN = 8;
/** Marks the panel and the menus it opens, so a pick in one of those menus is not a press outside. */
const PANEL_ATTRIBUTE = "data-story-layer-panel";

/** The side view's own coordinates: the camera at the left edge, the lanes running away from it. */
const SIDE_WIDTH = 456;
const SIDE_HEIGHT = 128;
/** Low enough that a lane's names fit above its tallest plane. */
const SIDE_MID = 72;
const LANE_X: Record<StoryLayerDepth, number> = { near: 92, follow: 176, mid: 262, far: 346, farthest: 426 };

/** A plane drawn a little taller the farther it is, which is how the side view reads as depth. */
function planeHalfHeight(x: number): number {
    return 18 + (x / SIDE_WIDTH) * 26;
}

/** A lane's names, short enough to sit over the lane without running into the next one. */
function laneCaption(names: readonly string[]): string {
    const characters = Array.from(names.join("、"));
    return characters.length > 8 ? `${characters.slice(0, 7).join("")}…` : characters.join("");
}

function nearestLane(x: number): StoryLayerDepth {
    let best: StoryLayerDepth = STORY_LAYER_DEPTHS[0];
    for (const depth of STORY_LAYER_DEPTHS) {
        if (Math.abs(LANE_X[depth] - x) < Math.abs(LANE_X[best] - x)) {
            best = depth;
        }
    }
    return best;
}

/**
 * The layers of one scene and how far from the camera each sits.
 *
 * Opened from the scene editor's header. Everything it shows is read off the rows - the layers'
 * `create` rows, the background layer's depth row, the rows that put things on each layer - and
 * everything it changes is written back to those rows, so it is a way of looking at the scene and
 * never a second place a layer is kept.
 *
 * The side view puts the camera at the left and the depths in lanes running away from it; a layer
 * dragged onto another lane takes that depth. The list underneath is the stage's own order, nearest
 * drawn first, with each layer's depth and what stands on it.
 */
export function StoryLayerPanel(props: {
    anchor: { left: number; right: number; bottom: number };
    anchorEl: HTMLElement | null;
    scene: StoryScene;
    characterName: (characterId: string) => string | undefined;
    readOnly: boolean;
    onSetDepth: (entry: StoryLayerPanelEntry, depth: StoryLayerDepth) => void;
    onRevealRow: (blockId: StoryBlockId) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const doc = useHostDocument();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const anchorElRef = useRef<HTMLElement | null>(props.anchorEl);
    anchorElRef.current = props.anchorEl;
    useFloatingLayer({
        open: true,
        onClose: props.onClose,
        panelRef,
        ownerRefs: [anchorElRef],
    });

    useEffect(() => {
        const onDown = (event: MouseEvent) => {
            const target = event.target as Element | null;
            if (!target || panelRef.current?.contains(target) || props.anchorEl?.contains(target) || target.closest?.(`[${PANEL_ATTRIBUTE}]`)) {
                return;
            }
            props.onClose();
        };
        doc.addEventListener("mousedown", onDown, true);
        return () => doc.removeEventListener("mousedown", onDown, true);
    }, [doc, props]);

    // Read afresh on every render rather than memoised on the scene: the story service edits a scene in
    // place, so the object an edit leaves behind is the one it found, and a memo keyed on it would keep
    // showing the layers as they were before the author changed them. The walk is one pass over rows.
    const model = buildStoryLayerPanel(props.scene, props.characterName);
    const layerLabel = (entry: StoryLayerPanelEntry) => entry.kind === "background"
        ? t("story.layerField.backgroundName")
        : entry.kind === "displayable"
            ? t("story.layerField.defaultName")
            : entry.name || t("story.layerPanel.unnamed");
    const contentLabel = (content: StoryLayerContent) => content.kind === "sceneBackground" ? t("story.layerPanel.sceneBackground") : content.name;
    const depthOptions = useMemo(() => STORY_LAYER_DEPTHS.map(depth => ({ value: depth, label: storyLayerDepthLabel(depth) })), []);

    // The plane being dragged, and where along the lanes it is right now.
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [drag, setDrag] = useState<{ key: string; x: number } | null>(null);
    const toSideX = (clientX: number) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) {
            return 0;
        }
        return Math.max(LANE_X.near - 20, Math.min(LANE_X.farthest + 20, ((clientX - rect.left) / rect.width) * SIDE_WIDTH));
    };
    const startDrag = (event: ReactPointerEvent<SVGGElement>, entry: StoryLayerPanelEntry) => {
        if (props.readOnly || entry.fixed || event.button !== 0) {
            return;
        }
        event.preventDefault();
        svgRef.current?.setPointerCapture(event.pointerId);
        setDrag({ key: entry.key, x: toSideX(event.clientX) });
    };
    const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (drag) {
            setDrag({ key: drag.key, x: toSideX(event.clientX) });
        }
    };
    const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (!drag) {
            return;
        }
        const entry = model.entries.find(candidate => candidate.key === drag.key);
        const depth = nearestLane(toSideX(event.clientX));
        setDrag(null);
        if (entry && depth !== entry.depth) {
            props.onSetDepth(entry, depth);
        }
    };

    // Planes sharing a lane sit side by side, nearest-drawn on the left, so none hides another.
    // Planes sharing a lane stand side by side, nearest-drawn first, so none hides another; the lane's
    // names go once above it. The plane being dragged leaves its lane and carries its own name.
    const slots = new Map<StoryLayerDepth, number>();
    const lanes = new Map<StoryLayerDepth, string[]>();
    const planes = model.entries.map(entry => {
        if (drag?.key === entry.key) {
            return { entry, slot: 0 };
        }
        const slot = slots.get(entry.depth) ?? 0;
        slots.set(entry.depth, slot + 1);
        lanes.set(entry.depth, [...(lanes.get(entry.depth) ?? []), layerLabel(entry)]);
        return { entry, slot };
    });

    const view = doc.defaultView ?? window;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(props.anchor.right - PANEL_WIDTH, view.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN));
    const top = props.anchor.bottom + 6;
    const maxHeight = Math.max(200, view.innerHeight - top - VIEWPORT_MARGIN);

    return createPortal(
        <div
            ref={panelRef}
            role="dialog"
            aria-label={t("story.layerPanel.title")}
            {...{ [PANEL_ATTRIBUTE]: "" }}
            className="fixed z-[70] flex flex-col overflow-y-auto rounded-lg border border-edge bg-surface-raised shadow-2xl"
            style={{ top, left, width: PANEL_WIDTH, maxHeight }}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={keepStoryKeysInPopover}
        >
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
                <Layers className="h-4 w-4 shrink-0 text-fg-muted" />
                <span className="text-xs font-medium text-fg">{t("story.layerPanel.title")}</span>
                <span className="ml-auto text-2xs text-fg-subtle">{t("story.layerPanel.resetNote")}</span>
            </div>

            <div className="shrink-0 px-3 pt-3">
                <div className="relative">
                    <Video className="pointer-events-none absolute h-4 w-4 text-fg-muted" style={{ left: 6, top: SIDE_MID - 8 }} aria-hidden />
                    <svg
                        ref={svgRef}
                        viewBox={`0 0 ${SIDE_WIDTH} ${SIDE_HEIGHT}`}
                        className="block w-full touch-none select-none"
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={() => setDrag(null)}
                        aria-hidden
                    >
                        <g className="text-fg-subtle">
                            <path d={`M 30 ${SIDE_MID} L 72 ${SIDE_MID - 26} M 30 ${SIDE_MID} L 72 ${SIDE_MID + 26}`} stroke="currentColor" strokeOpacity={0.35} fill="none" />
                            {STORY_LAYER_DEPTHS.map(depth => {
                                const half = planeHalfHeight(LANE_X[depth]);
                                return (
                                    <line
                                        key={depth}
                                        x1={LANE_X[depth]}
                                        x2={LANE_X[depth]}
                                        y1={SIDE_MID - half - 4}
                                        y2={SIDE_MID + half + 4}
                                        stroke="currentColor"
                                        strokeOpacity={0.35}
                                        strokeDasharray="3 4"
                                    />
                                );
                            })}
                        </g>
                        {[...lanes].map(([depth, names]) => (
                            <text
                                key={`caption-${depth}`}
                                x={LANE_X[depth] + (names.length - 1) * 6}
                                y={SIDE_MID - planeHalfHeight(LANE_X[depth]) - 7}
                                textAnchor="middle"
                                fontSize={11}
                                className="text-fg"
                                fill="currentColor"
                            >
                                {laneCaption(names)}
                            </text>
                        ))}
                        {planes.map(({ entry, slot }) => {
                            const dragging = drag?.key === entry.key;
                            const x = dragging ? drag.x : LANE_X[entry.depth] + slot * 12;
                            const half = planeHalfHeight(x);
                            return (
                                <g
                                    key={entry.key}
                                    className={cn(dragging ? "text-primary" : entry.fixed ? "text-fg-subtle" : "text-fg-muted")}
                                    style={{ cursor: props.readOnly || entry.fixed ? "default" : dragging ? "grabbing" : "grab" }}
                                    onPointerDown={event => startDrag(event, entry)}
                                    data-story-layer-plane={entry.key}
                                >
                                    <rect x={x - 3} y={SIDE_MID - half} width={6} height={half * 2} rx={2} fill="currentColor" />
                                    {/* A wider, invisible hit area: a 6-unit bar is a hard thing to catch. */}
                                    <rect x={x - 10} y={SIDE_MID - half - 4} width={20} height={half * 2 + 8} fill="transparent" />
                                    <title>{layerLabel(entry)}</title>
                                    {dragging ? (
                                        <text x={x} y={SIDE_MID - half - 7} textAnchor="middle" fontSize={11} fill="currentColor">
                                            {laneCaption([layerLabel(entry)])}
                                        </text>
                                    ) : null}
                                </g>
                            );
                        })}
                    </svg>
                </div>
                <div className="relative h-4 text-2xs text-fg-subtle">
                    {STORY_LAYER_DEPTHS.map(depth => (
                        <span
                            key={depth}
                            className="absolute -translate-x-1/2 whitespace-nowrap"
                            style={{ left: `${(LANE_X[depth] / SIDE_WIDTH) * 100}%` }}
                        >
                            {storyLayerDepthLabel(depth)}
                        </span>
                    ))}
                </div>
                <div className="pb-2 pt-1 text-2xs text-fg-subtle">{t("story.layerPanel.depthHint")}</div>
            </div>

            <div className="shrink-0 border-t border-edge">
                <div className="grid grid-cols-[minmax(0,1fr)_128px_minmax(0,1fr)] items-center gap-3 px-3 py-1.5 text-2xs text-fg-subtle">
                    <span>{t("story.layerPanel.frontToBack")}</span>
                    <span>{t("story.layerPanel.depth")}</span>
                    <span>{t("story.layerPanel.contents")}</span>
                </div>
                {model.entries.map(entry => {
                    const label = layerLabel(entry);
                    const contents = entry.contents.map(contentLabel).join("、");
                    const revealable = entry.kind === "custom" ? entry.sourceBlockId : entry.depthRowId;
                    return (
                        <div
                            key={entry.key}
                            className="grid min-h-9 grid-cols-[minmax(0,1fr)_128px_minmax(0,1fr)] items-center gap-3 border-t border-edge-subtle px-3 py-1"
                            data-story-layer-row={entry.key}
                        >
                            <div className="flex min-w-0 items-baseline gap-2">
                                {revealable ? (
                                    <button
                                        type="button"
                                        className="min-w-0 truncate rounded-md text-left text-xs text-fg hover:text-primary"
                                        onClick={() => props.onRevealRow(revealable)}
                                    >
                                        {label}
                                    </button>
                                ) : (
                                    <span className="min-w-0 truncate text-xs text-fg">{label}</span>
                                )}
                                {entry.kind !== "custom" ? <span className="shrink-0 text-2xs text-fg-subtle">{t("story.layerPanel.builtin")}</span> : null}
                            </div>
                            {entry.fixed ? (
                                <span className="truncate text-xs text-fg-muted" data-tip={t("story.layerField.displayableHint")}>
                                    {storyLayerDepthLabel(entry.depth)}
                                    <span className="ml-1.5 text-2xs text-fg-subtle">{t("story.layerPanel.fixed")}</span>
                                </span>
                            ) : (
                                <Select
                                    size="sm"
                                    options={depthOptions}
                                    value={entry.depth}
                                    onChange={value => props.onSetDepth(entry, value as StoryLayerDepth)}
                                    readOnly={props.readOnly}
                                    portalMenu
                                    menuZIndex={80}
                                    menuDataAttributes={{ [PANEL_ATTRIBUTE]: "" }}
                                    ariaLabel={`${label} ${t("story.layerPanel.depth")}`}
                                />
                            )}
                            <span className={cn("min-w-0 truncate text-xs", contents ? "text-fg-muted" : "text-fg-subtle")} data-tip={contents || undefined}>
                                {contents || t("story.layerPanel.empty")}
                            </span>
                        </div>
                    );
                })}
                {model.conflict ? (
                    <div className="flex items-start gap-2 border-t border-edge-subtle px-3 py-2 text-2xs text-warning">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                        <span>
                            {t("story.layerPanel.conflict", {
                                front: layerLabel(model.conflict.front),
                                back: layerLabel(model.conflict.back),
                            })}
                        </span>
                    </div>
                ) : null}
            </div>
        </div>,
        doc.body,
    );
}
