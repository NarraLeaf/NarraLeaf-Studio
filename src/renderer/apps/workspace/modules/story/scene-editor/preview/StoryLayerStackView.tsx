import { GripVertical, Lock, Plus, Trash2 } from "lucide-react";
import {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";
import type { StoryScene, StorySceneLayer } from "@shared/types/story";
import {
    moveSceneLayer,
    normalizeStageObjectName,
    removeSceneLayer,
    renameSceneLayer,
    sceneLayerFollow,
    sceneLayerNameProblem,
    sceneLayerStack,
    setSceneLayerFollow,
} from "@shared/types/story";
import { DropIndicator } from "@/lib/components/elements/DropIndicator";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { GAME_STAGE_BASE_CLASS_NAME } from "@/lib/ui-editor/runtime/app/gameStageBase";
import { useTranslation } from "@/lib/i18n";
import { storyLayerFollowPercent, storySceneLayerLabel } from "@/lib/story/storyLayerLabel";
import { cn } from "@/lib/utils/cn";
import { layerStackDepths, layerSwayOffset, layerSwayTransform, sceneLayerKey, snapLayerFollow } from "./storyLayerStackModel";

/** What the layer view needs from the scene's editor. */
export type StoryPreviewLayersApi = {
    /** The scene the preview shows, as it stands. */
    scene: StoryScene;
    /** Why the scene's layers cannot be changed right now, or null when they can. */
    readOnlyReason: string | null;
    setSceneLayers: (layers: StorySceneLayer[]) => boolean;
    /** Add a layer just behind the characters; returns its id. */
    createSceneLayer: () => string | null;
    /** How many rows of the scene use one of its own layers. */
    layerUses: (layerId: string) => number;
};

/** How far a press may travel and still be a click rather than a drag (Windows' `SM_CXDRAG`). */
const CLICK_SLOP_PX = 4;
/** How far apart layers at the same distance are drawn, in shares. */
const TIE_STEP = 0.12;
/** The gap kept between two name tags that would otherwise sit on each other. */
const TAG_GAP_PX = 2;
/**
 * How the planes are turned, in degrees, and how far apart one share of the camera draws them, as a
 * fraction of a plane's width: from the side in a wide view, so the stack runs off to the right; from
 * below in a tall one, so it climbs and uses the height the view has.
 */
const WIDE_LAYOUT = { x: 8, y: -50, depth: 0.75 };
const TALL_LAYOUT = { x: -38, y: -18, depth: 0.95 };
/** The moving preview's camera: a sway a little wider than the zoom hides at the characters' distance. */
const SWAY_ZOOM = 1.08;
const SWAY_AMPLITUDE = 0.04;

/**
 * The live preview's layer view: the shot the preview shows, taken apart into the scene's layers.
 *
 * Three parts, one stack:
 *  - the stack itself, front to back, which is the order the stage draws its layers in - drag a row
 *    to another place to put the layer there;
 *  - the same frame turned to the side, each layer a plane at its distance from the camera, holding
 *    what the preview shows on it - drag a plane's name along the stack to move it nearer or farther,
 *    and past another layer to change places with it;
 *  - the frame from the front with the camera swaying, which is what the distances do to the shot.
 *
 * What the planes hold is copied from the preview's own stage, so they show exactly what the row
 * shows, without the camera; a layer with nothing on it at this row is an empty frame.
 */
export function StoryLayerStackView(props: {
    api: StoryPreviewLayersApi;
    /** The preview's stage element, whose frames hold the engine's layers. */
    stageRoot: HTMLElement | null;
    /** Changes whenever the preview shows a new frame. */
    frameKey: string;
    designSize: { width: number; height: number };
}) {
    const { t } = useTranslation();
    const { api, designSize } = props;
    const readOnly = api.readOnlyReason !== null;
    const stored = sceneLayerStack(api.scene);
    // The stack as a drag leaves it, until the drag ends and writes it.
    const [draft, setDraft] = useState<StorySceneLayer[] | null>(null);
    const stack = draft ?? stored;
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    const [draggingKey, setDraggingKey] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    // Drawn flat for one frame, then taken apart: the turn is the view saying the shot is these layers.
    const [exploded, setExploded] = useState(false);
    useEffect(() => {
        const frame = requestAnimationFrame(() => requestAnimationFrame(() => setExploded(true)));
        return () => cancelAnimationFrame(frame);
    }, []);

    const boxRef = useRef<HTMLDivElement | null>(null);
    const [box, setBox] = useState({ width: 0, height: 0 });
    useLayoutEffect(() => {
        const element = boxRef.current;
        if (!element) {
            return;
        }
        const measure = () => {
            const rect = element.getBoundingClientRect();
            setBox(current => (current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height }));
        };
        measure();
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        observer?.observe(element);
        return () => observer?.disconnect();
    }, []);

    const sources = useStageLayerSources(props.stageRoot, api.scene.id, props.frameKey, stack);

    // Geometry. The list keeps the left of the view; the planes turn in the rest of it, sized so the
    // whole stack - from its nearest layer to its farthest - fits, and centred on the middle of it.
    const depths = useMemo(() => layerStackDepths(stack, TIE_STEP), [stack]);
    const listWidth = Math.min(164, Math.max(124, box.width * 0.28));
    const rigLeft = listWidth;
    const rigWidth = Math.max(0, box.width - rigLeft);
    const aspect = designSize.height / Math.max(1, designSize.width);
    // The moving preview in the lower right corner, and the planes kept clear of its height.
    const insetWidth = Math.max(96, Math.min(200, box.width * 0.26, (box.height * 0.34) / aspect));
    const rigHeight = Math.max(0, box.height - insetWidth * aspect * 0.7);
    const angles = rigHeight > rigWidth * 0.9 ? TALL_LAYOUT : WIDE_LAYOUT;
    const radians = { x: (angles.x * Math.PI) / 180, y: (angles.y * Math.PI) / 180 };
    const nearest = Math.max(...depths, 0);
    const farthest = Math.min(...depths, 0);
    const span = nearest - farthest;
    const fitWidth = (rigWidth * 0.84) / (Math.abs(Math.cos(radians.y)) + Math.abs(Math.sin(radians.y)) * angles.depth * span);
    const fitHeight = (rigHeight * 0.8) / (
        Math.abs(Math.sin(radians.y) * Math.sin(radians.x))
        + aspect * Math.abs(Math.cos(radians.x))
        + Math.abs(Math.cos(radians.y) * Math.sin(radians.x)) * angles.depth * span
    );
    const planeWidth = Math.max(40, Math.min(fitWidth, fitHeight));
    const planeHeight = planeWidth * aspect;
    const depthUnit = planeWidth * angles.depth;
    const centerX = rigLeft + rigWidth * 0.5;
    const centerY = rigHeight * 0.54;
    const flatScale = Math.min(box.width / planeWidth, box.height / planeHeight);
    const middle = ((nearest + farthest) / 2) * depthUnit;
    const worldTransform = exploded
        ? `rotateX(${angles.x}deg) rotateY(${angles.y}deg) translateZ(${(-middle).toFixed(1)}px)`
        : `translate(${(box.width / 2 - centerX).toFixed(1)}px, ${(box.height / 2 - centerY).toFixed(1)}px) scale(${flatScale.toFixed(3)})`;

    // Tags, inset planes and probes are moved every frame without a render.
    const tagRefs = useRef(new Map<string, HTMLElement>());
    const anchorRefs = useRef(new Map<string, HTMLElement>());
    const swayRefs = useRef(new Map<string, HTMLElement>());
    const probeNearRef = useRef<HTMLDivElement | null>(null);
    const probeFarRef = useRef<HTMLDivElement | null>(null);
    const stackRef = useRef(stack);
    stackRef.current = stack;
    useEffect(() => {
        let frame = 0;
        const tick = (time: number) => {
            const element = boxRef.current;
            if (element) {
                const origin = element.getBoundingClientRect();
                // Each tag over its plane's top edge, nearest layer first; a tag that would cover one
                // already placed moves up past it, so layers at one distance keep readable names.
                const placed: { left: number; right: number; top: number; bottom: number }[] = [];
                for (const layer of stackRef.current) {
                    const key = sceneLayerKey(layer);
                    const tag = tagRefs.current.get(key);
                    const anchor = anchorRefs.current.get(key);
                    if (!tag || !anchor) {
                        continue;
                    }
                    const point = anchor.getBoundingClientRect();
                    const width = tag.offsetWidth;
                    const height = tag.offsetHeight;
                    const left = point.left + point.width / 2 - origin.left - width / 2;
                    let bottom = point.top - origin.top;
                    let x = left;
                    for (let guard = 0; guard <= placed.length; guard += 1) {
                        const hit = placed.find(other => x < other.right && x + width > other.left && bottom - height < other.bottom && bottom > other.top);
                        if (!hit) {
                            break;
                        }
                        // Up past it while the view has room above, beside it once it has none.
                        if (hit.top - TAG_GAP_PX - height >= TAG_GAP_PX) {
                            bottom = hit.top - TAG_GAP_PX;
                        } else {
                            x = hit.right + TAG_GAP_PX;
                        }
                    }
                    placed.push({ left: x, right: x + width, top: bottom - height, bottom });
                    tag.style.transform = `translate(${x.toFixed(1)}px, ${(bottom - height).toFixed(1)}px)`;
                }
                const offset = layerSwayOffset(time, 4200, SWAY_AMPLITUDE);
                for (const layer of stackRef.current) {
                    const plane = swayRefs.current.get(sceneLayerKey(layer));
                    if (plane) {
                        plane.style.transform = layerSwayTransform(sceneLayerFollow(layer), offset, SWAY_ZOOM, insetWidth);
                    }
                }
            }
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [insetWidth]);

    const indexOfKey = (layers: readonly StorySceneLayer[], key: string) => layers.findIndex(layer => sceneLayerKey(layer) === key);

    /** A press on a plane's name: a click selects it, a sideways drag moves it nearer or farther. */
    const beginDepthDrag = (event: ReactPointerEvent, layer: StorySceneLayer) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const key = sceneLayerKey(layer);
        setSelectedKey(key);
        if (readOnly || layer.kind === "displayable") {
            return;
        }
        const near = probeNearRef.current?.getBoundingClientRect();
        const far = probeFarRef.current?.getBoundingClientRect();
        // One share of the camera on screen, read off two points of the turned view one share apart:
        // a drag along it, toward the near point, is a layer coming nearer.
        const axis = near && far ? { x: near.left - far.left, y: near.top - far.top } : { x: -depthUnit, y: 0 };
        const axisLength = axis.x * axis.x + axis.y * axis.y;
        if (axisLength < 1) {
            return;
        }
        const startX = event.clientX;
        const startY = event.clientY;
        const startFollow = sceneLayerFollow(layer);
        const base = stored;
        let moved = false;
        let latest: StorySceneLayer[] | null = null;
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture?.(event.pointerId);
        const handleMove = (move: PointerEvent) => {
            const dx = move.clientX - startX;
            const dy = move.clientY - startY;
            if (!moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) {
                return;
            }
            if (!moved) {
                moved = true;
                setDraggingKey(key);
            }
            const follow = snapLayerFollow(base, key, startFollow + (dx * axis.x + dy * axis.y) / axisLength);
            const from = latest ?? base;
            latest = setSceneLayerFollow(from, indexOfKey(from, key), follow);
            setDraft(latest);
        };
        const handleUp = () => {
            target.removeEventListener("pointermove", handleMove);
            target.removeEventListener("pointerup", handleUp);
            target.removeEventListener("pointercancel", handleUp);
            setDraggingKey(null);
            if (moved && latest) {
                api.setSceneLayers(latest);
            }
            setDraft(null);
        };
        target.addEventListener("pointermove", handleMove);
        target.addEventListener("pointerup", handleUp);
        target.addEventListener("pointercancel", handleUp);
    };

    // The list: a row dragged to another place in the stack. A gap index, one line, as every list does.
    const rowsRef = useRef<HTMLDivElement | null>(null);
    const [dropGap, setDropGap] = useState<number | null>(null);
    const beginRowDrag = (event: ReactPointerEvent, layer: StorySceneLayer) => {
        if (event.button !== 0 || readOnly || layer.kind === "displayable") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const key = sceneLayerKey(layer);
        const from = indexOfKey(stored, key);
        const startY = event.clientY;
        let moved = false;
        let gap: number | null = null;
        const target = event.currentTarget as HTMLElement;
        target.setPointerCapture?.(event.pointerId);
        const gapAt = (clientY: number): number | null => {
            const rows = rowsRef.current ? [...rowsRef.current.querySelectorAll<HTMLElement>("[data-layer-row]")] : [];
            let index = rows.length;
            for (let at = 0; at < rows.length; at += 1) {
                const rect = rows[at].getBoundingClientRect();
                if (clientY < rect.top + rect.height / 2) {
                    index = at;
                    break;
                }
            }
            // The gaps either side of the row itself put it where it already is.
            if (index === from || index === from + 1) {
                return null;
            }
            return moveSceneLayer(stored, from, index > from ? index - 1 : index) ? index : null;
        };
        const handleMove = (move: PointerEvent) => {
            if (!moved && Math.abs(move.clientY - startY) < CLICK_SLOP_PX) {
                return;
            }
            if (!moved) {
                moved = true;
                setDraggingKey(key);
            }
            gap = gapAt(move.clientY);
            setDropGap(gap);
        };
        const handleUp = () => {
            target.removeEventListener("pointermove", handleMove);
            target.removeEventListener("pointerup", handleUp);
            target.removeEventListener("pointercancel", handleUp);
            setDraggingKey(null);
            setDropGap(null);
            if (moved && gap !== null) {
                const next = moveSceneLayer(stored, from, gap > from ? gap - 1 : gap);
                if (next) {
                    api.setSceneLayers(next);
                }
            } else if (!moved) {
                setSelectedKey(key);
            }
        };
        target.addEventListener("pointermove", handleMove);
        target.addEventListener("pointerup", handleUp);
        target.addEventListener("pointercancel", handleUp);
    };

    const addLayer = () => {
        const id = api.createSceneLayer();
        if (id) {
            setSelectedKey(`custom:${id}`);
            setRenamingId(id);
        }
    };
    const removeLayer = (layer: Extract<StorySceneLayer, { kind: "custom" }>) => {
        if (api.setSceneLayers(removeSceneLayer(stored, layer.id)) && selectedKey === sceneLayerKey(layer)) {
            setSelectedKey(null);
        }
    };
    const commitRename = (layer: Extract<StorySceneLayer, { kind: "custom" }>, name: string) => {
        setRenamingId(null);
        if (name.trim() && name.trim() !== layer.name && sceneLayerNameProblem(stored, name, layer.id) === null) {
            api.setSceneLayers(renameSceneLayer(stored, layer.id, name));
        }
    };

    const emphasized = draggingKey ?? hoveredKey ?? selectedKey;

    return (
        <div
            ref={boxRef}
            className="absolute inset-0 z-10 select-none overflow-hidden bg-surface-sunken"
            data-story-layer-view=""
            // The view is the editor's, not the stage's: a press here is never the reader's "next".
            onPointerDown={event => event.stopPropagation()}
            onPointerUp={event => event.stopPropagation()}
        >
            {/* The planes, turned to the side. */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{ perspective: `${Math.round(planeWidth * 4)}px`, perspectiveOrigin: `${centerX}px ${centerY}px` }}
            >
                <div
                    className="absolute"
                    style={{
                        left: centerX - planeWidth / 2,
                        top: centerY - planeHeight / 2,
                        width: planeWidth,
                        height: planeHeight,
                        transformStyle: "preserve-3d",
                        transform: worldTransform,
                        transition: "transform 520ms cubic-bezier(0.2, 0.7, 0.2, 1)",
                    }}
                >
                    {stack.map((layer, index) => {
                        const key = sceneLayerKey(layer);
                        const z = exploded ? depths[index] * depthUnit : 0;
                        const lit = emphasized === key;
                        return (
                            <div
                                key={key}
                                className={cn(
                                    "pointer-events-auto absolute inset-0 rounded-sm outline outline-1",
                                    lit ? "outline-primary" : "outline-white/20",
                                )}
                                style={{
                                    transform: `translateZ(${z.toFixed(1)}px)`,
                                    transition: draggingKey === key ? "none" : "transform 520ms cubic-bezier(0.2, 0.7, 0.2, 1)",
                                    // Back to front, as the stage draws them, for the moment the planes are flat.
                                    zIndex: stack.length - index,
                                    backgroundColor: layer.kind === "background" && !sources.get(key) ? "rgba(255,255,255,0.04)" : undefined,
                                }}
                                onPointerEnter={() => setHoveredKey(key)}
                                onPointerLeave={() => setHoveredKey(current => (current === key ? null : current))}
                                onPointerDown={event => {
                                    event.stopPropagation();
                                    setSelectedKey(key);
                                }}
                            >
                                <LayerContents source={sources.get(key)} version={sources.version} designSize={designSize} width={planeWidth} />
                                <div
                                    ref={element => {
                                        if (element) anchorRefs.current.set(key, element);
                                        else anchorRefs.current.delete(key);
                                    }}
                                    className="absolute left-1/2 top-0 h-px w-px"
                                />
                            </div>
                        );
                    })}
                    {/* Two points one share apart, read when a drag starts to turn screen pixels into shares. */}
                    <div ref={probeNearRef} className="absolute left-1/2 top-0 h-px w-px" style={{ transform: "translateZ(0px)" }} />
                    <div ref={probeFarRef} className="absolute left-1/2 top-0 h-px w-px" style={{ transform: `translateZ(${(-depthUnit).toFixed(1)}px)` }} />
                </div>
            </div>

            {/* Each plane's name, over the plane: drag it sideways to move the layer. */}
            <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-300", exploded ? "opacity-100" : "opacity-0")}>
                {stack.map(layer => {
                    const key = sceneLayerKey(layer);
                    const fixed = layer.kind === "displayable";
                    return (
                        <button
                            key={key}
                            type="button"
                            ref={element => {
                                if (element) tagRefs.current.set(key, element);
                                else tagRefs.current.delete(key);
                            }}
                            className={cn(
                                "pointer-events-auto absolute left-0 top-0 mb-1 flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs shadow-sm",
                                emphasized === key ? "border-primary/60 bg-surface-raised text-fg" : "border-edge bg-surface-raised/90 text-fg-muted",
                                fixed || readOnly ? "cursor-default" : "cursor-move",
                            )}
                            style={{ touchAction: "none" }}
                            data-tip={fixed ? t("story.sceneLayers.fixedTip") : readOnly ? api.readOnlyReason ?? undefined : t("story.sceneLayers.dragTip")}
                            data-story-layer-tag={key}
                            onPointerDown={event => beginDepthDrag(event, layer)}
                            onPointerEnter={() => setHoveredKey(key)}
                            onPointerLeave={() => setHoveredKey(current => (current === key ? null : current))}
                        >
                            <span className="max-w-[9rem] truncate">{storySceneLayerLabel(layer)}</span>
                            {/* The share where the author is looking at this layer; the list carries every one. */}
                            {emphasized === key ? (
                                <span className="tabular-nums text-fg-subtle">{t("story.sceneLayers.follow", { percent: String(storyLayerFollowPercent(layer)) })}</span>
                            ) : null}
                        </button>
                    );
                })}
            </div>

            {/* The stack, front to back. */}
            <div
                className={cn(
                    "absolute inset-y-0 left-0 flex flex-col border-r border-edge bg-surface/95 transition-opacity duration-300",
                    exploded ? "opacity-100" : "opacity-0",
                )}
                style={{ width: listWidth }}
            >
                <div className="flex items-center justify-between px-2.5 pb-1 pt-2 text-2xs text-fg-subtle">
                    <span>{t("story.sceneLayers.frontToBack")}</span>
                    <span>{t("story.sceneLayers.followColumn")}</span>
                </div>
                <div ref={rowsRef} className="min-h-0 flex-1 overflow-y-auto px-1">
                    {stack.map((layer, index) => {
                        const key = sceneLayerKey(layer);
                        const fixed = layer.kind === "displayable";
                        const uses = layer.kind === "custom" ? api.layerUses(layer.id) : 0;
                        return (
                            <div
                                key={key}
                                data-layer-row={key}
                                className={cn(
                                    "group relative flex h-7 items-center gap-1 rounded-md pl-0.5 pr-1.5 text-xs",
                                    selectedKey === key ? "bg-primary/15 text-fg" : hoveredKey === key ? "bg-fill text-fg" : "text-fg-muted",
                                    draggingKey === key && "opacity-60",
                                )}
                                onPointerEnter={() => setHoveredKey(key)}
                                onPointerLeave={() => setHoveredKey(current => (current === key ? null : current))}
                                onPointerDown={event => {
                                    if (event.button === 0) setSelectedKey(key);
                                }}
                            >
                                {dropGap === index ? <DropIndicator edge="before" /> : null}
                                {dropGap === stack.length && index === stack.length - 1 ? <DropIndicator edge="after" /> : null}
                                <span
                                    className={cn("grid h-6 w-4 shrink-0 place-items-center text-fg-subtle", !fixed && !readOnly && "cursor-grab")}
                                    style={{ touchAction: "none" }}
                                    onPointerDown={event => beginRowDrag(event, layer)}
                                    data-tip={fixed ? t("story.sceneLayers.fixedTip") : undefined}
                                >
                                    {fixed ? <Lock className="h-3 w-3" /> : <GripVertical className="h-3.5 w-3.5" />}
                                </span>
                                {layer.kind === "custom" && renamingId === layer.id ? (
                                    <LayerNameInput
                                        layer={layer}
                                        stack={stored}
                                        onCommit={name => commitRename(layer, name)}
                                        onCancel={() => setRenamingId(null)}
                                    />
                                ) : (
                                    <span
                                        className="min-w-0 flex-1 truncate"
                                        onDoubleClick={() => {
                                            if (layer.kind === "custom" && !readOnly) setRenamingId(layer.id);
                                        }}
                                    >
                                        {storySceneLayerLabel(layer)}
                                    </span>
                                )}
                                {layer.kind === "custom" && !readOnly && renamingId !== layer.id ? (
                                    <ToolbarButton
                                        size="xs"
                                        className="hidden h-5 w-5 shrink-0 group-hover:grid"
                                        aria-label={t("story.sceneLayers.remove")}
                                        data-tip={uses > 0 ? (uses === 1 ? t("story.sceneLayers.inUseOne") : t("story.sceneLayers.inUseMany", { count: String(uses) })) : t("story.sceneLayers.remove")}
                                        disabled={uses > 0}
                                        onPointerDown={event => event.stopPropagation()}
                                        onClick={() => removeLayer(layer)}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </ToolbarButton>
                                ) : null}
                                <span className="shrink-0 tabular-nums text-2xs text-fg-subtle">{storyLayerFollowPercent(layer)}%</span>
                            </div>
                        );
                    })}
                </div>
                <div className="border-t border-edge p-1">
                    <button
                        type="button"
                        className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-xs text-fg-muted transition-colors hover:bg-fill hover:text-fg disabled:opacity-50"
                        disabled={readOnly}
                        data-tip={api.readOnlyReason ?? undefined}
                        onClick={addLayer}
                        data-story-layer-add=""
                    >
                        <Plus className="h-3.5 w-3.5" />
                        {t("story.layerField.createNew")}
                    </button>
                </div>
            </div>

            {/* The shot from the front, the camera swaying: what the distances do. */}
            <div
                className={cn(
                    "pointer-events-none absolute bottom-2 right-2 overflow-hidden rounded-md border border-edge shadow-lg transition-opacity duration-300",
                    exploded ? "opacity-100" : "opacity-0",
                    GAME_STAGE_BASE_CLASS_NAME,
                )}
                style={{ width: insetWidth, height: insetWidth * aspect }}
                data-story-layer-sway=""
            >
                {[...stack].reverse().map(layer => {
                    const key = sceneLayerKey(layer);
                    return (
                        <div
                            key={key}
                            ref={element => {
                                if (element) swayRefs.current.set(key, element);
                                else swayRefs.current.delete(key);
                            }}
                            className="absolute inset-0"
                            style={{ transformOrigin: "50% 50%" }}
                        >
                            <LayerContents source={sources.get(key)} version={sources.version} designSize={designSize} width={insetWidth} />
                        </div>
                    );
                })}
                <div className="absolute left-1.5 top-1 text-2xs text-white/70 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">{t("story.sceneLayers.swayCaption")}</div>
            </div>
        </div>
    );
}

/** A layer's name being edited in place. Enter keeps it, Escape or a name another layer has does not. */
function LayerNameInput(props: {
    layer: Extract<StorySceneLayer, { kind: "custom" }>;
    stack: readonly StorySceneLayer[];
    onCommit: (name: string) => void;
    onCancel: () => void;
}) {
    const { t } = useTranslation();
    const [value, setValue] = useState(props.layer.name);
    const inputRef = useRef<HTMLInputElement | null>(null);
    useLayoutEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);
    const problem = sceneLayerNameProblem(props.stack, value, props.layer.id);
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            if (problem === null) props.onCommit(value);
        } else if (event.key === "Escape") {
            event.preventDefault();
            props.onCancel();
        }
    };
    return (
        <input
            ref={inputRef}
            value={value}
            onChange={event => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => (problem === null ? props.onCommit(value) : props.onCancel())}
            onPointerDown={event => event.stopPropagation()}
            aria-invalid={problem !== null}
            data-tip={problem === "taken" ? t("story.sceneLayers.nameTaken") : problem === "reserved" ? t("story.sceneLayers.nameReserved") : undefined}
            className={cn(
                "h-6 min-w-0 flex-1 rounded-md border bg-surface-raised px-1.5 text-xs text-fg outline-none",
                problem === null ? "border-primary/50" : "border-danger",
            )}
        />
    );
}

/**
 * A copy of what the preview's stage shows on one layer, at a plane's width.
 *
 * The copy is laid out at the size the stage lays its layers out at - the preview draws the game at
 * the pane's size, not at the design size - and scaled from there, so it is the frame the stage shows.
 */
function LayerContents(props: {
    source: HTMLElement | undefined;
    version: number;
    designSize: { width: number; height: number };
    width: number;
}) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        host.replaceChildren();
        const source = props.source;
        const layoutWidth = source?.offsetWidth || props.designSize.width;
        const layoutHeight = source?.offsetHeight || props.designSize.height;
        host.style.width = `${layoutWidth}px`;
        host.style.height = `${layoutHeight}px`;
        host.style.transform = `scale(${(props.width / Math.max(1, layoutWidth)).toFixed(5)})`;
        if (source) {
            host.appendChild(inertCopy(source));
        }
    }, [props.source, props.version, props.width, props.designSize.width, props.designSize.height]);
    return (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div ref={hostRef} className="absolute left-0 top-0 text-white" style={{ transformOrigin: "0 0" }} />
        </div>
    );
}

/**
 * A copy of an engine layer that nothing can mistake for the stage: no ids, no element-type marks for
 * the preview's own readers to find, and nothing that takes a press.
 */
function inertCopy(source: HTMLElement): HTMLElement {
    const copy = source.cloneNode(true) as HTMLElement;
    for (const element of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) {
        element.removeAttribute("id");
        element.removeAttribute("data-element-type");
        element.removeAttribute("data-layer-id");
    }
    copy.style.pointerEvents = "none";
    return copy;
}

type StageLayerSources = Map<string, HTMLElement> & { version: number };

/**
 * The engine's layer elements in the frame the preview shows, keyed as the stack keys its layers, and
 * a number that moves whenever that frame changes - a rebuild, a picture that finished loading.
 *
 * The scene's own layers carry the names the compiler gave them (`nl:layer:<scene>:<name>`); the two
 * built-ins carry none, and are the two others in the order the stage draws them: background, then
 * characters.
 */
function useStageLayerSources(
    stageRoot: HTMLElement | null,
    sceneId: string,
    frameKey: string,
    stack: readonly StorySceneLayer[],
): StageLayerSources {
    const [version, setVersion] = useState(0);
    useEffect(() => {
        if (!stageRoot || typeof MutationObserver === "undefined") {
            return;
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        const observer = new MutationObserver(records => {
            // The view's own copies are inside the stage element too, and are not the stage.
            if (records.every(record => (record.target as Element).closest?.("[data-story-layer-view]"))) {
                return;
            }
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => setVersion(current => current + 1), 120);
        });
        observer.observe(stageRoot, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "style", "class"] });
        return () => {
            observer.disconnect();
            if (timer) clearTimeout(timer);
        };
    }, [stageRoot]);
    const names = stack.map(layer => (layer.kind === "custom" ? `${layer.id}=${layer.name}` : layer.kind)).join("|");
    return useMemo(() => {
        const sources = new Map<string, HTMLElement>() as StageLayerSources;
        sources.version = version;
        const frames = stageRoot?.querySelectorAll<HTMLElement>(":scope > [data-story-preview-frame]");
        // The frame on top: during a rebuild the held one, which is the one on screen.
        const frame = frames && frames.length > 0 ? frames[frames.length - 1] : null;
        const scenes = frame?.querySelectorAll<HTMLElement>("[data-element-type=\"scene\"]");
        const scene = scenes && scenes.length > 0 ? scenes[scenes.length - 1] : null;
        if (!scene) {
            return sources;
        }
        const prefix = `nl:layer:${sceneId}:`;
        const builtins: HTMLElement[] = [];
        for (const element of scene.querySelectorAll<HTMLElement>("[data-element-type=\"layer\"]")) {
            const id = element.getAttribute("data-layer-id") ?? "";
            if (!id.startsWith(prefix)) {
                builtins.push(element);
                continue;
            }
            const name = id.slice(prefix.length);
            const layer = stack.find(candidate => candidate.kind === "custom" && normalizeStageObjectName(candidate.name) === name);
            if (layer) {
                sources.set(sceneLayerKey(layer), element);
            }
        }
        if (builtins[0]) sources.set("background", builtins[0]);
        if (builtins[1]) sources.set("displayable", builtins[1]);
        return sources;
        // `names` stands for the stack's names, which is all the lookup reads of it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stageRoot, sceneId, frameKey, version, names]);
}
