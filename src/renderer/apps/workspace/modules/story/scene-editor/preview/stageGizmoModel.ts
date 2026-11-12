import type {
    StoryActionPayload,
    StoryAlignPositionValue,
    StoryBlock,
    StoryScene,
    StoryTransformProps,
    StoryTransformRef,
} from "@shared/types/story";
import {
    characterStageObjectName,
    normalizeStageObjectName,
    resolveDisplayableTargetRef,
} from "@shared/types/story";
import { clampToAlignReach } from "../commands/transformVocabulary";
import { withTransformProps } from "../transformChannels";

/**
 * The stage gizmo's half that the tests hold: which row it may write, how a press on the preview
 * becomes a position or a size, and how that lands back on the row.
 *
 * **Coordinates.** Everything here works in the box of the element's containing stage, in screen
 * pixels measured from that box's top-left corner. The engine places an element by its centre:
 * `left = xalign` of the stage width and `bottom = yalign` of its height, with the element translated
 * by half its own size (`nlr-displayable-css-mapping`). So the centre of the element's drawn box,
 * read off the screen, IS its position - whatever the camera, the layer, the stage's letterboxing or
 * Studio's own zoom did to it, because all of them scale the box and its container together.
 *
 * That is why the gizmo never needs the design resolution: a share of the container on screen is the
 * same share of the design stage.
 */

/** The element's drawn box, centre and size, in container pixels. */
export type GizmoBox = { cx: number; cy: number; width: number; height: number };

/** The size of the element's containing stage on screen. */
export type GizmoContainer = { width: number; height: number };

/** Which corner a scale handle sits on: -1 is left / top, 1 is right / bottom. */
export type GizmoCorner = { sx: -1 | 1; sy: -1 | 1 };

export type StageGizmoBlockedReason =
    /** The scene cannot be edited right now (a freeze, a read-only agent lock). */
    | "readOnly"
    /** The row addresses the object but does not place it: a hide, an expression, a loop. */
    | "operation"
    /** The row plays a Story Motion asset, whose keyframes own the transform. */
    | "motion"
    /** A text object: the engine gives it no identity on the stage to measure. */
    | "text"
    /** A layer, the scene background or a built-in layer: not a sprite to move. */
    | "notSprite";

export type StageGizmoRow =
    | {
        kind: "editable";
        blockId: string;
        /** The compiler's element-registry key for the object. */
        stageKey: string;
        payload: StageGizmoPayload;
    }
    | { kind: "blocked"; blockId: string; reason: StageGizmoBlockedReason };

/** The three row shapes that can carry a placement. */
export type StageGizmoPayload = Extract<StoryActionPayload, { action: "character" | "image" | "displayable" }>;

function isMotionDriven(transform: StoryTransformRef | undefined): boolean {
    return Boolean(transform && (transform.mode === "animation" || transform.animationId));
}

/**
 * What the gizmo may do with the row the cursor is on, or null when the row has nothing on the stage
 * to point at - a line of dialogue, a jump - and the gizmo should simply stay out of the way.
 *
 * The answer is deliberately narrow. A row that places an object states where it ends up, and that is
 * what a drag rewrites; a row that only mentions the object (a hide, an expression change, a loop)
 * has no placement to rewrite, and writing one onto it would change what the row means. Those are
 * reported, so the author is told why nothing moves rather than watching a drag do nothing.
 */
export function resolveStageGizmoRow(
    scene: StoryScene | null | undefined,
    block: StoryBlock | null | undefined,
    readOnly: boolean,
): StageGizmoRow | null {
    if (!block || block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    const blocked = (reason: StageGizmoBlockedReason): StageGizmoRow => ({ kind: "blocked", blockId: block.id, reason });
    const editable = (stageKey: string, row: StageGizmoPayload): StageGizmoRow => {
        if (isMotionDriven(row.transform)) {
            return blocked("motion");
        }
        if (readOnly) {
            return blocked("readOnly");
        }
        return { kind: "editable", blockId: block.id, stageKey, payload: row };
    };
    switch (payload.action) {
        case "character":
            if (!payload.characterId) {
                return null;
            }
            if (payload.operation === "enter" || payload.operation === "move") {
                return editable(characterStageObjectName(payload), payload);
            }
            return payload.operation === "setName" ? null : blocked("operation");
        case "image": {
            const name = payload.operation === "create" || !payload.target
                ? normalizeStageObjectName(payload.objectName)
                : normalizeStageObjectName(resolveDisplayableTargetRef(scene, payload.target).name);
            if (payload.operation === "create" || payload.operation === "show") {
                return editable(name, payload);
            }
            return blocked("operation");
        }
        case "displayable": {
            if (payload.target.builtin) {
                return blocked("notSprite");
            }
            const resolved = resolveDisplayableTargetRef(scene, payload.target);
            if (resolved.kind === "layer") {
                return blocked("notSprite");
            }
            if (resolved.kind === "text") {
                return blocked("text");
            }
            if (payload.operation === "show" || payload.operation === "transform") {
                return editable(normalizeStageObjectName(resolved.name), payload);
            }
            return blocked("operation");
        }
        case "text":
            return blocked("text");
        default:
            return null;
    }
}

// ---------------------------------------------------------------------------------------------
// Screen <-> position
// ---------------------------------------------------------------------------------------------

/** Three decimals: a thousandth of a 1920-wide stage is about two pixels, below what a drag can aim. */
export function roundAlign(value: number): number {
    return Math.round(value * 1000) / 1000;
}

/** Two decimals for a size factor, which is what the inspector's own fields show. */
export function roundScale(value: number): number {
    return Math.round(value * 100) / 100;
}

/** The position a box's centre names, as shares of the stage measured up from its bottom-left. */
export function alignFromBox(box: Pick<GizmoBox, "cx" | "cy">, container: GizmoContainer): { xalign: number; yalign: number } {
    return {
        xalign: container.width > 0 ? box.cx / container.width : 0.5,
        yalign: container.height > 0 ? 1 - box.cy / container.height : 0.5,
    };
}

// ---------------------------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------------------------

/** How far inside each edge the safe area runs, as a share of the stage: the broadcast action-safe 5%. */
export const STAGE_SAFE_INSET = 0.05;

/** How near, on screen, an edge or centre has to come to a guide to land on it. */
export const SNAP_DISTANCE_PX = 6;

export type GizmoGuideKind = "center" | "third" | "safe" | "edge";

/** A guide line the box landed on: `at` is a share of the container along `axis`, from the top-left. */
export type GizmoGuide = { axis: "x" | "y"; at: number; kind: GizmoGuideKind };

/** Where the centre may land: the stage's middle and its thirds. */
const CENTER_GUIDES: readonly { at: number; kind: GizmoGuideKind }[] = [
    { at: 1 / 3, kind: "third" },
    { at: 0.5, kind: "center" },
    { at: 2 / 3, kind: "third" },
];

/** Where an edge may land: the stage's own edges and the safe area inside them. */
const EDGE_GUIDES: readonly { at: number; kind: GizmoGuideKind }[] = [
    { at: 0, kind: "edge" },
    { at: STAGE_SAFE_INSET, kind: "safe" },
    { at: 1 - STAGE_SAFE_INSET, kind: "safe" },
    { at: 1, kind: "edge" },
];

/**
 * Pull one axis of a box onto the nearest guide within reach.
 *
 * The centre is tried against the middle and thirds, each edge against the stage edges and safe
 * area, and the single closest candidate wins - so a box never jumps between two guides that are both
 * in reach, and a centre on the middle line beats an edge one pixel further from its safe line.
 */
function snapAxis(
    center: number,
    half: number,
    length: number,
    axis: "x" | "y",
    distancePx: number,
): { center: number; guide: GizmoGuide | null } {
    if (length <= 0) {
        return { center, guide: null };
    }
    let best: { delta: number; guide: GizmoGuide } | null = null;
    const consider = (point: number, at: number, kind: GizmoGuideKind) => {
        const delta = at * length - point;
        if (Math.abs(delta) <= distancePx && (!best || Math.abs(delta) < Math.abs(best.delta))) {
            best = { delta, guide: { axis, at, kind } };
        }
    };
    for (const guide of CENTER_GUIDES) {
        consider(center, guide.at, guide.kind);
    }
    for (const guide of EDGE_GUIDES) {
        consider(center - half, guide.at, guide.kind);
        consider(center + half, guide.at, guide.kind);
    }
    const found = best as { delta: number; guide: GizmoGuide } | null;
    return found ? { center: center + found.delta, guide: found.guide } : { center, guide: null };
}

export function snapBox(box: GizmoBox, container: GizmoContainer, distancePx = SNAP_DISTANCE_PX): { box: GizmoBox; guides: GizmoGuide[] } {
    const x = snapAxis(box.cx, box.width / 2, container.width, "x", distancePx);
    const y = snapAxis(box.cy, box.height / 2, container.height, "y", distancePx);
    return {
        box: { ...box, cx: x.center, cy: y.center },
        guides: [x.guide, y.guide].filter((guide): guide is GizmoGuide => guide !== null),
    };
}

// ---------------------------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------------------------

export type GizmoMoveOptions = {
    snap: boolean;
    /** Keep the move to whichever axis it has travelled further along (Shift). */
    axisLock: boolean;
};

export function moveGizmo(
    start: GizmoBox,
    dx: number,
    dy: number,
    container: GizmoContainer,
    options: GizmoMoveOptions,
): { box: GizmoBox; guides: GizmoGuide[] } {
    let moveX = dx;
    let moveY = dy;
    if (options.axisLock) {
        if (Math.abs(dx) >= Math.abs(dy)) {
            moveY = 0;
        } else {
            moveX = 0;
        }
    }
    const moved: GizmoBox = { ...start, cx: start.cx + moveX, cy: start.cy + moveY };
    if (!options.snap) {
        return { box: moved, guides: [] };
    }
    const snapped = snapBox(moved, container);
    if (options.axisLock) {
        // A locked axis stays where it was even when a guide is in reach of it.
        const lockedX = moveX === 0;
        return {
            box: lockedX ? { ...snapped.box, cx: moved.cx } : { ...snapped.box, cy: moved.cy },
            guides: snapped.guides.filter(guide => guide.axis === (lockedX ? "y" : "x")),
        };
    }
    return snapped;
}

export type GizmoScaleOptions = {
    /** Each axis on its own rather than the picture's proportions held (Shift). */
    free: boolean;
    /** Grow about the centre rather than about the opposite corner (Alt). */
    fromCenter: boolean;
};

/** The smallest share of its start size a drag may shrink a box to, so it never folds through itself. */
const MIN_SCALE_FACTOR = 0.05;

/**
 * Resize a box from one of its corners.
 *
 * Proportional by default, because a sprite is a picture and stretching one is rarely what a drag
 * means: the factor is how far the pointer has travelled along the line from the anchor through the
 * corner. The anchor is the opposite corner, which stays put, unless the gesture asks for the centre.
 *
 * Returns the factor each axis grew by; the caller multiplies the row's own zoom (or scale) by it.
 */
export function scaleGizmo(
    start: GizmoBox,
    corner: GizmoCorner,
    dx: number,
    dy: number,
    options: GizmoScaleOptions,
): { box: GizmoBox; factorX: number; factorY: number } {
    const halfW = start.width / 2;
    const halfH = start.height / 2;
    // From the anchor to the dragged corner: half the box from the centre, the whole box from the
    // opposite corner.
    const reach = options.fromCenter ? 1 : 2;
    let factorX: number;
    let factorY: number;
    if (options.free) {
        factorX = halfW > 0 ? 1 + corner.sx * dx / (reach * halfW) : 1;
        factorY = halfH > 0 ? 1 + corner.sy * dy / (reach * halfH) : 1;
    } else {
        const lengthSq = halfW * halfW + halfH * halfH;
        const along = corner.sx * dx * halfW + corner.sy * dy * halfH;
        factorX = factorY = lengthSq > 0 ? 1 + along / (reach * lengthSq) : 1;
    }
    factorX = Math.max(MIN_SCALE_FACTOR, factorX);
    factorY = Math.max(MIN_SCALE_FACTOR, factorY);
    const width = start.width * factorX;
    const height = start.height * factorY;
    if (options.fromCenter) {
        return { box: { cx: start.cx, cy: start.cy, width, height }, factorX, factorY };
    }
    const anchorX = start.cx - corner.sx * halfW;
    const anchorY = start.cy - corner.sy * halfH;
    return {
        box: { cx: anchorX + corner.sx * width / 2, cy: anchorY + corner.sy * height / 2, width, height },
        factorX,
        factorY,
    };
}

// ---------------------------------------------------------------------------------------------
// Writing back
// ---------------------------------------------------------------------------------------------

/** The size channels of the element as the drag began: the row's own value, else the live stage's. */
export type GizmoStartScale = { zoom: number; scaleX: number; scaleY: number };

/**
 * The props one finished drag states.
 *
 * Position is the box's centre as shares, with any pixel offsets the row already carries kept as
 * they are (the share absorbs the move, so the centre still lands where it was dropped). A
 * proportional resize writes `zoom` alone and leaves the axes' own scale - a mirror, a squash - as
 * the author set it; a free resize writes the two axes and leaves `zoom`.
 */
export function gizmoTransformPatch(input: {
    box: GizmoBox;
    container: GizmoContainer;
    /** The row's current position, for its offsets. */
    position: StoryAlignPositionValue | undefined;
    /** The design stage's size, to turn the offsets back into shares. */
    designSize: { width: number; height: number };
    moved: boolean;
    scale?: { factorX: number; factorY: number; free: boolean; start: GizmoStartScale };
}): Partial<StoryTransformProps> {
    const patch: Partial<StoryTransformProps> = {};
    if (input.moved) {
        const align = alignFromBox(input.box, input.container);
        const xoffset = input.position?.xoffset ?? 0;
        const yoffset = input.position?.yoffset ?? 0;
        const xalign = align.xalign - (input.designSize.width > 0 ? xoffset / input.designSize.width : 0);
        const yalign = align.yalign - (input.designSize.height > 0 ? yoffset / input.designSize.height : 0);
        patch.position = {
            ...(input.position ?? {}),
            xalign: roundAlign(clampToAlignReach(xalign)),
            yalign: roundAlign(clampToAlignReach(yalign)),
        };
    }
    if (input.scale) {
        const { start, factorX, factorY, free } = input.scale;
        if (free) {
            patch.scaleX = roundScale(start.scaleX * factorX);
            patch.scaleY = roundScale(start.scaleY * factorY);
        } else {
            patch.zoom = roundScale(start.zoom * factorX);
        }
    }
    return patch;
}

/** The row with the drag's props merged into its transform, every other field untouched. */
export function writeGizmoTransform<T extends StageGizmoPayload>(payload: T, patch: Partial<StoryTransformProps>): T {
    return { ...payload, transform: withTransformProps(payload.transform ?? {}, patch) };
}

/** A number read off the live stage's props, when it is one. */
function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The size the element stands at as the drag begins: the row's own statement first, then the stage. */
export function gizmoStartScale(row: StoryTransformProps | undefined, live: Record<string, unknown> | null): GizmoStartScale {
    return {
        zoom: row?.zoom ?? finiteNumber(live?.zoom) ?? 1,
        scaleX: row?.scaleX ?? finiteNumber(live?.scaleX) ?? 1,
        scaleY: row?.scaleY ?? finiteNumber(live?.scaleY) ?? 1,
    };
}
