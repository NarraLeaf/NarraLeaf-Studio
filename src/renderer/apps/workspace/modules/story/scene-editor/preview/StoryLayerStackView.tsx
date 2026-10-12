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
    layerFollowAtDistance,
    normalizeStageObjectName,
    STORY_LAYER_DISTANCE_MIN,
    placeSceneLayer,
    removeSceneLayer,
    renameSceneLayer,
    sameSceneLayerStack,
    sceneLayerDistance,
    sceneLayerFollow,
    sceneLayerFollowBetween,
    sceneLayerLevels,
    sceneLayerNameProblem,
    sceneLayerStack,
    setSceneLayerFollow,
    setSceneLayerFollows,
    type SceneLayerLevel,
} from "@shared/types/story";
import { DropIndicator } from "@/lib/components/elements/DropIndicator";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { GAME_STAGE_BASE_CLASS_NAME } from "@/lib/ui-editor/runtime/app/gameStageBase";
import { useTranslation } from "@/lib/i18n";
import { formatLayerDistance, parseLayerDistance, storySceneLayerLabel } from "@/lib/story/storyLayerLabel";
import { cn } from "@/lib/utils/cn";
import {
    layerDepthAt,
    layerDistanceAtDepth,
    layerStackDepths,
    layerSwayOffset,
    layerSwayTransform,
    roundLayerDistance,
    sceneLayerKey,
} from "./storyLayerStackModel";

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
/** How near, on screen, a dragged plane has to come to a level to join it. */
const LEVEL_SNAP_PX = 9;
/** How far apart the layers of one level are drawn, so they draw in stack order on their one plane. */
const LEVEL_HAIR_PX = 0.4;
/** The gap kept between two name tags that would otherwise sit on each other. */
const TAG_GAP_PX = 2;
/**
 * How the planes are turned, in degrees, and how far apart one unit of the view's depth draws them, as
 * a fraction of a plane's width: from the side in a wide view, so the stack runs off to the right; from
 * below in a tall one, so it climbs and uses the height the view has.
 */
const WIDE_LAYOUT = { x: 8, y: -50, depth: 0.6 };
const TALL_LAYOUT = { x: -38, y: -18, depth: 0.75 };
/** The moving preview's camera: a sway a little wider than the zoom hides at the characters' distance. */
const SWAY_ZOOM = 1.08;
const SWAY_AMPLITUDE = 0.04;

/** Where a dragged row would land: inside a level, or between two as a level of its own. */
type RowDrop = {
    /** The stack once it lands. */
    next: StorySceneLayer[];
    /** The level it joins, by the key of the level's first layer; null for a new level. */
    joins: string | null;
    /** The gap the line is drawn at, or null when the drop is onto a level as a whole. */
    gap: number | null;
    /** The distance a new level would be at. */
    distance: number | null;
};

function levelKey(stack: readonly StorySceneLayer[], level: SceneLayerLevel): string {
    return sceneLayerKey(stack[level.start]);
}

/**
 * Follow one press to its end, and return what ends it early (`false`: nothing is kept).
 *
 * The moves and the release are read off the window, in the capture phase, rather than off the
 * element pressed: a drag that listened on the element alone stopped dead the moment the element
 * lost its pointer capture - which a drag here causes itself, because the stack's new order moves
 * elements in the page, and a moved element loses its capture - and then never ended, so the next
 * time the pointer merely passed over that element the old drag moved its layer again. The view's
 * root stops pointerup from bubbling, hence the capture phase.
 *
 * A move with the button no longer down ends the press as a release the window did not see (one
 * outside the window), and the window losing focus ends it with nothing kept.
 */
function followPress(
    event: ReactPointerEvent,
    onMove: (move: PointerEvent) => void,
    onEnd: (released: boolean) => void,
): () => void {
    const pointerId = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture?.(pointerId);
    let ended = false;
    const finish = (released: boolean) => {
        if (ended) {
            return;
        }
        ended = true;
        window.removeEventListener("pointermove", handleMove, true);
        window.removeEventListener("pointerup", handleUp, true);
        window.removeEventListener("pointercancel", handleCancel, true);
        window.removeEventListener("blur", handleBlur);
        onEnd(released);
    };
    function handleMove(move: PointerEvent) {
        if (move.pointerId !== pointerId) {
            return;
        }
        if ((move.buttons & 1) === 0) {
            finish(true);
            return;
        }
        onMove(move);
    }
    function handleUp(up: PointerEvent) {
        if (up.pointerId === pointerId) {
            finish(true);
        }
    }
    function handleCancel(cancel: PointerEvent) {
        if (cancel.pointerId === pointerId) {
            finish(false);
        }
    }
    function handleBlur() {
        finish(false);
    }
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleCancel, true);
    window.addEventListener("blur", handleBlur);
    return () => finish(false);
}

/**
 * The live preview's layer view: the shot the preview shows, taken apart into the scene's layers.
 *
 * Three parts, one stack:
 *  - the stack itself, front to back, in levels: the layers at one distance are one level, with the
 *    distance written once beside them - click it to type another, drag a row onto another level to
 *    join it or between two to make a level of its own;
 *  - the same frame turned to the side, each level a plane at its distance from the camera, holding
 *    what the preview shows on its layers - drag a layer's name along the stack to move it nearer or
 *    farther, onto another level to join it;
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
    const [draggingKey, setDraggingKey] = useState<string | null>(null);
    const stack = draft && draggingKey !== null ? draft : stored;
    // The press being followed, ended with nothing kept if the view goes away first.
    const endPressRef = useRef<(() => void) | null>(null);
    useEffect(() => () => endPressRef.current?.(), []);
    const levels = useMemo(() => sceneLayerLevels(stack), [stack]);
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [hoveredKey, setHoveredKey] = useState<string | null>(null);
    // A level the pointer is on as a whole: its card in the turned view, or its block in the list.
    const [hoveredLevel, setHoveredLevel] = useState<string | null>(null);
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
    // While a plane is dragged the view holds still at the stack the drag found, so the plane under the
    // pointer is the only thing that moves; it settles to the new stack once the drag ends.
    const [heldStack, setHeldStack] = useState<StorySceneLayer[] | null>(null);
    const layoutDepths = useMemo(() => layerStackDepths(heldStack ?? stack), [heldStack, stack]);
    const depths = useMemo(() => layerStackDepths(stack), [stack]);
    // The dragged plane, drawn where the pointer has it rather than at the distance it rounds to.
    const [dragDepth, setDragDepth] = useState<{ key: string; depth: number } | null>(null);
    const listWidth = Math.min(184, Math.max(140, box.width * 0.3));
    const rigLeft = listWidth;
    const rigWidth = Math.max(0, box.width - rigLeft);
    const aspect = designSize.height / Math.max(1, designSize.width);
    // The moving preview in the lower right corner, and the planes kept clear of its height.
    const insetWidth = Math.max(96, Math.min(200, box.width * 0.26, (box.height * 0.34) / aspect));
    const rigHeight = Math.max(0, box.height - insetWidth * aspect * 0.7);
    const angles = rigHeight > rigWidth * 0.9 ? TALL_LAYOUT : WIDE_LAYOUT;
    const radians = { x: (angles.x * Math.PI) / 180, y: (angles.y * Math.PI) / 180 };
    const nearest = Math.max(...layoutDepths, 0);
    const farthest = Math.min(...layoutDepths, 0);
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

    // Level cards, inset planes and probes are moved every frame without a render.
    const cardRefs = useRef(new Map<string, HTMLElement>());
    const anchorRefs = useRef(new Map<string, HTMLElement>());
    const swayRefs = useRef(new Map<string, HTMLElement>());
    const probeNearRef = useRef<HTMLDivElement | null>(null);
    const probeFarRef = useRef<HTMLDivElement | null>(null);
    // The rail's points in the turned view, and the line and dots drawn over the view through them.
    const railPointsRef = useRef<HTMLDivElement | null>(null);
    const railDrawingRef = useRef<SVGSVGElement | null>(null);
    const stackRef = useRef(stack);
    stackRef.current = stack;
    const levelKeysRef = useRef<string[]>([]);
    levelKeysRef.current = levels.map(level => levelKey(stack, level));
    useEffect(() => {
        let frame = 0;
        const tick = (time: number) => {
            const element = boxRef.current;
            if (element) {
                const origin = element.getBoundingClientRect();
                // Each level's card over its plane's top edge, nearest level first; a card that would cover
                // one already placed moves up past it while the view has room above, beside it after.
                const placed: { left: number; right: number; top: number; bottom: number }[] = [];
                for (const key of levelKeysRef.current) {
                    const card = cardRefs.current.get(key);
                    const anchor = anchorRefs.current.get(key);
                    if (!card || !anchor) {
                        continue;
                    }
                    const point = anchor.getBoundingClientRect();
                    const width = card.offsetWidth;
                    const height = card.offsetHeight;
                    let x = point.left + point.width / 2 - origin.left - width / 2;
                    let bottom = point.top - origin.top - TAG_GAP_PX;
                    for (let guard = 0; guard <= placed.length; guard += 1) {
                        const hit = placed.find(other => x < other.right && x + width > other.left && bottom - height < other.bottom && bottom > other.top);
                        if (!hit) {
                            break;
                        }
                        if (hit.top - TAG_GAP_PX - height >= TAG_GAP_PX) {
                            bottom = hit.top - TAG_GAP_PX;
                        } else {
                            x = hit.right + TAG_GAP_PX;
                        }
                    }
                    placed.push({ left: x, right: x + width, top: bottom - height, bottom });
                    card.style.transform = `translate(${x.toFixed(1)}px, ${(bottom - height).toFixed(1)}px)`;
                }
                const points = railPointsRef.current ? [...railPointsRef.current.children] as HTMLElement[] : [];
                const drawing = railDrawingRef.current;
                if (drawing && points.length >= 2) {
                    const at = (element: HTMLElement) => {
                        const rect = element.getBoundingClientRect();
                        return { x: rect.left + rect.width / 2 - origin.left, y: rect.top + rect.height / 2 - origin.top };
                    };
                    const [near, far, ...stops] = points.map(at);
                    const line = drawing.querySelector("line[data-rail-line]");
                    line?.setAttribute("x1", near.x.toFixed(1));
                    line?.setAttribute("y1", near.y.toFixed(1));
                    line?.setAttribute("x2", far.x.toFixed(1));
                    line?.setAttribute("y2", far.y.toFixed(1));
                    drawing.querySelectorAll("circle").forEach((dot, index) => {
                        const stop = stops[index];
                        if (stop) {
                            dot.setAttribute("cx", stop.x.toFixed(1));
                            dot.setAttribute("cy", stop.y.toFixed(1));
                        }
                    });
                    // The background's stop: a bar across the rail at the base layer.
                    const bar = drawing.querySelector("line[data-rail-limit]");
                    const base = stops[points.slice(2).findIndex(point => point.dataset.base === "true")];
                    if (bar && base) {
                        const length = Math.hypot(far.x - near.x, far.y - near.y) || 1;
                        const across = { x: (-(far.y - near.y) / length) * 9, y: ((far.x - near.x) / length) * 9 };
                        bar.setAttribute("x1", (base.x - across.x).toFixed(1));
                        bar.setAttribute("y1", (base.y - across.y).toFixed(1));
                        bar.setAttribute("x2", (base.x + across.x).toFixed(1));
                        bar.setAttribute("y2", (base.y + across.y).toFixed(1));
                    }
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

    /**
     * A press on a layer's name: a click selects it, a drag along the stack moves it nearer or farther.
     * The distance follows the pointer in steps an author can read, and a plane that comes close to
     * another level joins it.
     */
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
        // One unit of depth on screen, read off two points of the turned view one unit apart: a drag
        // along it, toward the near point, is a layer coming nearer.
        const axis = near && far ? { x: near.left - far.left, y: near.top - far.top } : { x: -depthUnit, y: 0 };
        const axisLength = axis.x * axis.x + axis.y * axis.y;
        if (axisLength < 1) {
            return;
        }
        const unitPx = Math.sqrt(axisLength);
        const base = stored;
        const startDepth = layerDepthAt(sceneLayerDistance(layer));
        // The levels the plane can join: every other layer's distance, once each.
        const targets = new Map<number, number>();
        for (const other of base) {
            if (sceneLayerKey(other) !== key) {
                targets.set(sceneLayerFollow(other), layerDepthAt(sceneLayerDistance(other)));
            }
        }
        const startX = event.clientX;
        const startY = event.clientY;
        let moved = false;
        let latest: StorySceneLayer[] | null = null;
        const handleMove = (move: PointerEvent) => {
            const dx = move.clientX - startX;
            const dy = move.clientY - startY;
            if (!moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) {
                return;
            }
            if (!moved) {
                moved = true;
                setDraggingKey(key);
                setHeldStack(base);
            }
            let depth = Math.min(layerDepthAt(STORY_LAYER_DISTANCE_MIN), Math.max(layerDepthAt(Infinity), startDepth + (dx * axis.x + dy * axis.y) / axisLength));
            // The background stays behind the characters.
            if (layer.kind === "background") {
                depth = Math.min(depth, 0);
            }
            let follow: number | null = null;
            let drawn = depth;
            let closest = LEVEL_SNAP_PX;
            for (const [share, at] of targets) {
                const gap = Math.abs(at - depth) * unitPx;
                if (gap <= closest && (layer.kind !== "background" || share <= 1)) {
                    closest = gap;
                    follow = share;
                    drawn = at;
                }
            }
            if (follow === null) {
                const distance = roundLayerDistance(layerDistanceAtDepth(depth));
                follow = layerFollowAtDistance(distance);
                if (distance === Infinity) {
                    drawn = layerDepthAt(Infinity);
                }
            }
            latest = setSceneLayerFollow(base, indexOfKey(base, key), follow);
            setDraft(latest);
            setDragDepth({ key, depth: drawn });
        };
        const handleEnd = (released: boolean) => {
            endPressRef.current = null;
            setDraggingKey(null);
            setDragDepth(null);
            setHeldStack(null);
            setDraft(null);
            if (released && moved && latest && !sameSceneLayerStack(latest, base)) {
                api.setSceneLayers(latest);
            }
        };
        endPressRef.current?.();
        endPressRef.current = followPress(event, handleMove, handleEnd);
    };

    // The list: a row dragged onto a level joins it; dragged between two levels it becomes a level of
    // its own, at a distance between theirs. A gap index and one line, as every list does.
    const rowsRef = useRef<HTMLDivElement | null>(null);
    const [rowDrop, setRowDrop] = useState<RowDrop | null>(null);
    const beginRowDrag = (event: ReactPointerEvent, layer: StorySceneLayer) => {
        if (event.button !== 0 || readOnly || layer.kind === "displayable") {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const key = sceneLayerKey(layer);
        const base = stored;
        const from = indexOfKey(base, key);
        const baseLevels = sceneLayerLevels(base);
        const startY = event.clientY;
        let moved = false;
        let drop: RowDrop | null = null;
        const landed = (next: StorySceneLayer[] | null): StorySceneLayer[] | null => (next && !sameSceneLayerStack(next, base) ? next : null);
        const onLevel = (level: SceneLayerLevel): RowDrop | null => {
            // Onto the edge of the level nearest where the row came from.
            if (from >= level.start && from < level.end) {
                return null;
            }
            const next = landed(placeSceneLayer(base, from, from < level.start ? level.start - 1 : level.end, level.follow));
            return next ? { next, joins: levelKey(base, level), gap: null, distance: null } : null;
        };
        const atGap = (gap: number): RowDrop | null => {
            // The neighbours the row would land between, itself aside.
            let front = gap - 1;
            if (front === from) front -= 1;
            let behind = gap;
            if (behind === from) behind += 1;
            const frontShare = front >= 0 ? sceneLayerFollow(base[front]) : undefined;
            const behindShare = behind < base.length ? sceneLayerFollow(base[behind]) : undefined;
            const to = gap > from ? gap - 1 : gap;
            if (frontShare !== undefined && frontShare === behindShare) {
                const level = baseLevels.find(candidate => candidate.follow === frontShare && front >= candidate.start && front < candidate.end);
                const next = landed(placeSceneLayer(base, from, to, frontShare));
                return next ? { next, joins: level ? levelKey(base, level) : null, gap, distance: null } : null;
            }
            let share = sceneLayerFollowBetween(frontShare, behindShare);
            if (share === null) {
                const next = landed(placeSceneLayer(base, from, to, frontShare ?? behindShare ?? 1));
                return next ? { next, joins: null, gap, distance: null } : null;
            }
            // At a round distance where one lies between the two.
            const round = roundLayerDistance(1 / Math.max(share, 1e-9));
            const roundShare = share === 0 ? 0 : layerFollowAtDistance(round);
            if ((frontShare === undefined || roundShare < frontShare) && (behindShare === undefined || roundShare > behindShare)) {
                share = roundShare;
            }
            const next = landed(placeSceneLayer(base, from, to, share));
            return next ? { next, joins: null, gap, distance: share === 0 ? Infinity : 1 / share } : null;
        };
        const dropAt = (clientY: number): RowDrop | null => {
            const rows = rowsRef.current ? [...rowsRef.current.querySelectorAll<HTMLElement>("[data-layer-row]")] : [];
            for (let at = 0; at < rows.length; at += 1) {
                const rect = rows[at].getBoundingClientRect();
                if (clientY >= rect.bottom) {
                    continue;
                }
                const share = (clientY - rect.top) / Math.max(1, rect.height);
                if (share < 0.28) {
                    return atGap(at);
                }
                if (share > 0.72) {
                    return atGap(at + 1);
                }
                const level = baseLevels.find(candidate => at >= candidate.start && at < candidate.end);
                return level ? onLevel(level) : null;
            }
            return atGap(rows.length);
        };
        const handleMove = (move: PointerEvent) => {
            if (!moved && Math.abs(move.clientY - startY) < CLICK_SLOP_PX) {
                return;
            }
            if (!moved) {
                moved = true;
                setDraggingKey(key);
            }
            drop = dropAt(move.clientY);
            setRowDrop(drop);
        };
        const handleEnd = (released: boolean) => {
            endPressRef.current = null;
            setDraggingKey(null);
            setRowDrop(null);
            if (released && moved && drop) {
                api.setSceneLayers(drop.next);
            } else if (released && !moved) {
                setSelectedKey(key);
            }
        };
        endPressRef.current?.();
        endPressRef.current = followPress(event, handleMove, handleEnd);
    };

    /** A level at a typed distance: its layers go together, the characters' layer staying where it is. */
    const setLevelDistance = (level: SceneLayerLevel, distance: number) => {
        let follow = layerFollowAtDistance(distance);
        // A distance that reads as another level's is that level.
        const typed = formatLayerDistance(distance);
        const same = sceneLayerLevels(stored).find(other => other.follow !== level.follow && formatLayerDistance(other.follow === 0 ? Infinity : 1 / other.follow) === typed);
        if (same) {
            follow = same.follow;
        }
        const indices: number[] = [];
        for (let index = level.start; index < level.end; index += 1) {
            indices.push(index);
        }
        const next = setSceneLayerFollows(stored, indices, follow);
        if (!sameSceneLayerStack(next, stored)) {
            api.setSceneLayers(next);
        }
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
    const levelOf = (index: number) => levels.find(level => index >= level.start && index < level.end) ?? { follow: 1, start: index, end: index + 1 };
    const emphasizedIndex = emphasized ? indexOfKey(stack, emphasized) : -1;
    // The level lit as a whole: the one the pointer is on, else the one holding the lit layer.
    const emphasizedLevel = hoveredLevel ?? (emphasizedIndex >= 0 ? levelKey(stack, levelOf(emphasizedIndex)) : null);
    // The level a dragged name has joined: in the drag's stack its level holds other layers too.
    const draggedIndex = dragDepth ? indexOfKey(stack, dragDepth.key) : -1;
    const draggedLevel = draggedIndex >= 0 ? levelOf(draggedIndex) : null;
    const joinedLevel = draggedLevel && draggedLevel.end - draggedLevel.start > 1 ? levelKey(stack, draggedLevel) : null;
    // The layer whose range the rail along the stack shows: the one dragged, or the one whose name the
    // pointer is on - for the background, from the base layer back, which is how far it may come.
    const railKey = draggingKey && dragDepth ? draggingKey : hoveredKey && !readOnly ? hoveredKey : null;
    const railLayer = railKey ? stack.find(layer => sceneLayerKey(layer) === railKey && layer.kind !== "displayable") : undefined;
    const showsBackgroundLimit = railLayer?.kind === "background";
    const railNear = (railLayer?.kind === "background" ? 0 : layerDepthAt(STORY_LAYER_DISTANCE_MIN)) * depthUnit;
    const railFar = layerDepthAt(Infinity) * depthUnit;
    const railStops = railLayer
        ? levels
            .filter(level => !(level.end - level.start === 1 && sceneLayerKey(stack[level.start]) === railKey))
            .map(level => ({ z: depths[level.start] * depthUnit, base: stack.slice(level.start, level.end).some(layer => layer.kind === "displayable") }))
        : [];

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
                        const level = levelOf(index);
                        const dragged = dragDepth?.key === key;
                        // The layers of one level a hair apart, back to front, so they draw in stack order.
                        const z = !exploded
                            ? 0
                            : dragged
                                ? dragDepth.depth * depthUnit
                                : depths[index] * depthUnit + (level.end - 1 - index) * LEVEL_HAIR_PX;
                        const lit = emphasized === key;
                        const ofLevel = levelKey(stack, level);
                        const isBase = layer.kind === "displayable";
                        return (
                            <div
                                key={key}
                                className={cn(
                                    "pointer-events-auto absolute inset-0 rounded-sm outline",
                                    isBase && showsBackgroundLimit
                                        // The line the background stops at.
                                        ? "bg-primary/10 outline-2 outline-primary"
                                        : lit
                                            ? "outline-2 outline-primary"
                                            : joinedLevel === ofLevel || emphasizedLevel === ofLevel
                                                ? "outline-1 outline-primary/70"
                                                : isBase
                                                    ? "outline-1 outline-dashed outline-primary/60"
                                                    : "outline-1 outline-white/20",
                                )}
                                data-story-layer-plane={key}
                                style={{
                                    transform: `translateZ(${z.toFixed(1)}px)`,
                                    transition: dragged ? "none" : "transform 520ms cubic-bezier(0.2, 0.7, 0.2, 1)",
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
                                {index === level.start ? (
                                    <div
                                        ref={element => {
                                            if (element) anchorRefs.current.set(ofLevel, element);
                                            else anchorRefs.current.delete(ofLevel);
                                        }}
                                        className="absolute left-1/2 top-0 h-px w-px"
                                    />
                                ) : null}
                            </div>
                        );
                    })}
                    {/* The range the dragged (or pointed-at) layer may take, along the stack under the planes,
                        with a dot at every level it would join; the background's stops at the base layer. */}
                    {exploded && railLayer ? (
                        // In the turned view's own space: without preserve-3d the points would flatten onto one.
                        <div ref={railPointsRef} aria-hidden className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
                            {[railNear, railFar, ...railStops.map(stop => stop.z)].map((z, index) => (
                                <div
                                    key={index}
                                    className="pointer-events-none absolute left-1/2 top-full h-px w-px"
                                    style={{ transform: `translateZ(${z.toFixed(1)}px)` }}
                                    data-base={index >= 2 && railStops[index - 2].base ? "true" : undefined}
                                />
                            ))}
                        </div>
                    ) : null}
                    {/* Two points one unit of depth apart, read when a drag starts to turn screen pixels into depth. */}
                    <div ref={probeNearRef} className="absolute left-1/2 top-0 h-px w-px" style={{ transform: "translateZ(0px)" }} />
                    <div ref={probeFarRef} className="absolute left-1/2 top-0 h-px w-px" style={{ transform: `translateZ(${(-depthUnit).toFixed(1)}px)` }} />
                </div>
            </div>

            {/* The rail along the stack, drawn through its points over the planes. */}
            {exploded && railLayer ? (
                <svg ref={railDrawingRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
                    <line data-rail-line className={draggingKey ? "stroke-primary/80" : "stroke-primary/45"} strokeWidth={2} strokeLinecap="round" />
                    {railStops.map((stop, index) => (
                        <circle key={index} r={stop.base ? 4 : 3} className={stop.base ? "fill-primary" : "fill-primary/80"} />
                    ))}
                    {railLayer.kind === "background" ? <line data-rail-limit className="stroke-primary" strokeWidth={3} strokeLinecap="round" /> : null}
                </svg>
            ) : null}

            {/* A card over each level's plane: its distance, and the name of every layer on it - drag a
                name along the stack to move that layer. A level of several layers is one card, lit as one. */}
            <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-300", exploded ? "opacity-100" : "opacity-0")}>
                {levels.map(level => {
                    const key = levelKey(stack, level);
                    const members = stack.slice(level.start, level.end);
                    const holdsBase = members.some(layer => layer.kind === "displayable");
                    const joined = joinedLevel === key;
                    return (
                        <div
                            key={key}
                            ref={element => {
                                if (element) cardRefs.current.set(key, element);
                                else cardRefs.current.delete(key);
                            }}
                            className={cn(
                                "pointer-events-auto absolute left-0 top-0 flex items-stretch overflow-hidden rounded-md border text-2xs shadow-sm",
                                joined
                                    ? "border-primary bg-surface-raised ring-2 ring-primary/40"
                                    : emphasizedLevel === key
                                        ? "border-primary/70 bg-surface-raised"
                                        : holdsBase
                                            ? "border-primary/45 bg-surface-raised/90"
                                            : "border-edge bg-surface-raised/90",
                            )}
                            data-story-layer-card={key}
                            onPointerEnter={() => setHoveredLevel(key)}
                            onPointerLeave={() => setHoveredLevel(current => (current === key ? null : current))}
                        >
                            <span
                                className={cn(
                                    "flex items-center gap-0.5 border-r px-1 tabular-nums",
                                    holdsBase ? "border-primary/30 bg-primary/10 text-primary" : "border-edge text-fg-subtle",
                                )}
                                data-tip={holdsBase ? t("story.sceneLayers.fixedTip") : t("story.sceneLayers.distanceTip")}
                            >
                                {holdsBase ? <Lock className="h-2.5 w-2.5" /> : null}
                                {formatLayerDistance(level.follow === 0 ? Infinity : 1 / level.follow)}
                            </span>
                            <span className="flex flex-col p-0.5">
                                {members.map(layer => {
                                    const layerKey = sceneLayerKey(layer);
                                    const fixed = layer.kind === "displayable";
                                    return (
                                        <button
                                            key={layerKey}
                                            type="button"
                                            className={cn(
                                                "flex items-center gap-1 whitespace-nowrap rounded-sm px-1 py-px text-left",
                                                emphasized === layerKey ? "bg-primary/20 text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                                                fixed || readOnly ? "cursor-default" : "cursor-move",
                                            )}
                                            style={{ touchAction: "none" }}
                                            data-tip={fixed
                                                ? t("story.sceneLayers.fixedTip")
                                                : readOnly
                                                    ? api.readOnlyReason ?? undefined
                                                    : layer.kind === "background"
                                                        ? t("story.sceneLayers.backgroundDragTip")
                                                        : t("story.sceneLayers.dragTip")}
                                            data-story-layer-tag={layerKey}
                                            onPointerDown={event => beginDepthDrag(event, layer)}
                                            onPointerEnter={() => setHoveredKey(layerKey)}
                                            onPointerLeave={() => setHoveredKey(current => (current === layerKey ? null : current))}
                                        >
                                            <span className="max-w-[9rem] truncate">{storySceneLayerLabel(layer)}</span>
                                        </button>
                                    );
                                })}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* The stack, front to back, in levels. */}
            <div
                className={cn(
                    "absolute inset-y-0 left-0 flex flex-col border-r border-edge bg-surface/95 transition-opacity duration-300",
                    exploded ? "opacity-100" : "opacity-0",
                )}
                style={{ width: listWidth }}
            >
                <div className="flex items-center justify-between px-2.5 pb-1 pt-2 text-2xs text-fg-subtle">
                    <span>{t("story.sceneLayers.frontToBack")}</span>
                    <span data-tip={t("story.sceneLayers.distanceTip")}>{t("story.sceneLayers.distanceColumn")}</span>
                </div>
                <div ref={rowsRef} className="min-h-0 flex-1 overflow-y-auto px-1">
                    {levels.map((level, levelIndex) => {
                        const key = levelKey(stack, level);
                        const members = stack.slice(level.start, level.end);
                        const movable = members.some(layer => layer.kind !== "displayable");
                        const holdsBase = members.some(layer => layer.kind === "displayable");
                        return (
                            <div
                                key={key}
                                className={cn(
                                    "relative flex rounded-md",
                                    levelIndex > 0 && "mt-0.5",
                                    (rowDrop?.joins === key && rowDrop.gap === null) || joinedLevel === key
                                        ? "bg-primary/10 ring-1 ring-inset ring-primary/40"
                                        : hoveredLevel === key && "bg-fill/60",
                                )}
                                data-layer-level={key}
                                onPointerEnter={() => setHoveredLevel(key)}
                                onPointerLeave={() => setHoveredLevel(current => (current === key ? null : current))}
                            >
                                <div className="min-w-0 flex-1">
                                    {members.map((layer, offset) => {
                                        const index = level.start + offset;
                                        const layerKey = sceneLayerKey(layer);
                                        const fixed = layer.kind === "displayable";
                                        const uses = layer.kind === "custom" ? api.layerUses(layer.id) : 0;
                                        return (
                                            <div
                                                key={layerKey}
                                                data-layer-row={layerKey}
                                                className={cn(
                                                    "group relative flex h-7 items-center gap-1 rounded-md pl-0.5 pr-1 text-xs",
                                                    selectedKey === layerKey ? "bg-primary/15 text-fg" : hoveredKey === layerKey ? "bg-fill text-fg" : "text-fg-muted",
                                                    draggingKey === layerKey && "opacity-60",
                                                )}
                                                onPointerEnter={() => setHoveredKey(layerKey)}
                                                onPointerLeave={() => setHoveredKey(current => (current === layerKey ? null : current))}
                                                onPointerDown={event => {
                                                    if (event.button === 0) setSelectedKey(layerKey);
                                                }}
                                            >
                                                {rowDrop?.gap === index ? <RowDropLine distance={rowDrop.distance} edge="before" /> : null}
                                                {rowDrop?.gap === stack.length && index === stack.length - 1 ? <RowDropLine distance={rowDrop.distance} edge="after" /> : null}
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
                                            </div>
                                        );
                                    })}
                                </div>
                                <LevelDistance
                                    base={holdsBase}
                                    distance={level.follow === 0 ? Infinity : 1 / level.follow}
                                    span={members.length}
                                    editable={!readOnly && movable && draggingKey === null}
                                    tip={!movable
                                        ? t("story.sceneLayers.fixedTip")
                                        : readOnly
                                            ? api.readOnlyReason ?? undefined
                                            : holdsBase
                                                ? t("story.sceneLayers.levelKeepsBase")
                                                : t("story.sceneLayers.distanceTip")}
                                    onCommit={distance => setLevelDistance(level, distance)}
                                />
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

/** The line a dragged row would land at, with the distance it would take there when that is a new level. */
function RowDropLine(props: { edge: "before" | "after"; distance: number | null }) {
    return (
        <>
            <DropIndicator edge={props.edge} />
            {props.distance !== null ? (
                <span
                    className={cn(
                        "pointer-events-none absolute right-0 z-10 rounded-sm bg-surface-raised px-1 text-2xs tabular-nums text-primary shadow-sm",
                        props.edge === "before" ? "-top-2" : "-bottom-2",
                    )}
                >
                    {formatLayerDistance(props.distance)}
                </span>
            ) : null}
        </>
    );
}

/**
 * A level's distance, written once beside its layers: click it to type another. Enter keeps a
 * distance within range, Escape keeps the old one.
 */
function LevelDistance(props: {
    /** Whether the level holds the base layer, whose distance every other is measured from. */
    base: boolean;
    distance: number;
    /** How many rows the level holds, which a bracket spans. */
    span: number;
    editable: boolean;
    tip: string | undefined;
    onCommit: (distance: number) => void;
}) {
    const { t } = useTranslation();
    const [editing, setEditing] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    useLayoutEffect(() => {
        if (editing !== null) {
            inputRef.current?.focus();
            inputRef.current?.select();
        }
        // Only on entering the field, not on every keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editing !== null]);
    const label = formatLayerDistance(props.distance);
    const parsed = editing === null ? null : parseLayerDistance(editing);
    const commit = () => {
        if (parsed !== null) {
            props.onCommit(parsed);
        }
        setEditing(null);
    };
    const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            if (parsed !== null) commit();
        } else if (event.key === "Escape") {
            event.preventDefault();
            setEditing(null);
        }
    };
    return (
        <div className="relative flex w-10 shrink-0 items-center justify-end pr-1">
            {props.span > 1 ? <span aria-hidden className="pointer-events-none absolute bottom-1.5 left-0.5 top-1.5 w-1 rounded-l-sm border-y border-l border-edge" /> : null}
            {editing !== null ? (
                <input
                    ref={inputRef}
                    value={editing}
                    onChange={event => setEditing(event.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={commit}
                    onPointerDown={event => event.stopPropagation()}
                    aria-invalid={parsed === null}
                    data-tip={parsed === null ? t("story.sceneLayers.distanceInvalid") : undefined}
                    className={cn(
                        "h-6 w-8 rounded-md border bg-surface-raised px-1 text-right text-2xs tabular-nums text-fg outline-none",
                        parsed === null ? "border-danger" : "border-primary/50",
                    )}
                    data-story-layer-distance-input=""
                />
            ) : (
                <button
                    type="button"
                    className={cn(
                        "flex h-6 min-w-[1.75rem] items-center justify-end gap-0.5 rounded-md px-1 text-2xs tabular-nums",
                        props.base ? "text-primary" : props.editable ? "text-fg-muted" : "text-fg-subtle",
                        props.editable ? "hover:bg-fill" : "cursor-default",
                    )}
                    aria-disabled={!props.editable}
                    data-tip={props.tip}
                    data-story-layer-distance={label}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={() => {
                        if (props.editable) setEditing(label);
                    }}
                >
                    {props.base ? <Lock className="h-2.5 w-2.5" /> : null}
                    {label}
                </button>
            )}
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
