import type { StoryActionPayload, StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import { getTextSegment } from "./storySceneBlockUtils";

/**
 * Staging lens (M7): a bar-timeline projection of a `parallel` / `race` control container. Each direct
 * child of the container becomes one horizontal track whose bar shows the child's temporal footprint —
 * a leading delay, its own animation duration, or an equal-width "unknown" stub when no duration can be
 * derived from the payload. This is a PURE projection over the existing document: it reads durations
 * that already live on payloads (transition/transform `durationMs`, wait/displayable/screen-effect
 * timings, audio fade) and invents no new document fields.
 *
 * A text-carrying child is the one exception to "a track is a bar": it is prose, not staging, and it
 * keeps its ordinary row inside the lens (see `LensTrackKind["text"]`).
 *
 * Two engine facts shape the visuals and are honoured here, not editorialised away:
 *  - A `parallel` (`Control.all` / `allAsync`) runs every direct child from t=0 simultaneously, so a
 *    child's track is its own footprint and a `wait` child is dead time on ITS track alone — never an
 *    offset imposed on the others.
 *  - A `race` (`Control.any`) resolves when the first child settles, but the losers are NOT aborted -
 *    they run their side effects to completion (engine裁决 2026-07-23). So `winnerFinishMs` marks only
 *    WHERE the race is decided; the renderer must keep every bar drawn to its full length past it, so
 *    the lens never implies "winner cuts the rest off".
 */

/**
 * The kind of footprint a track shows — a plain animated action, a pure wait (delay), a nested
 * container, or `text` for a prose child (narration / dialogue / note). A `text` track draws no bar at
 * all: the row keeps its ordinary rendering, which is where the in-place text editor, the voice
 * indicator and the row actions live. The lens must not swallow that arm — a row that opens for
 * editing has to show an editor (`docs/story-editor-interaction-model.md`, "Editing in place").
 */
export type LensTrackKind = "action" | "wait" | "subgroup" | "text";

/** One track's derived timing. `finishMs` is `delayMs + durationMs`; meaningless when `unknown`. */
export type LensTrackSegment = {
    blockId: StoryBlockId;
    kind: LensTrackKind;
    /** Leading dead time before the bar's own duration (a `wait` child's whole span lands here). */
    delayMs: number;
    /** The action's own animated duration; 0 for a pure wait or an instant/unknown action. */
    durationMs: number;
    /** No duration could be derived from the payload — render an equal-width dashed stub, not a bar. */
    unknown: boolean;
    /** `delayMs + durationMs`; used for the scale and the race decision marker. Ignore when `unknown`. */
    finishMs: number;
    /** The child is compiled out (disabled itself or under a disabled ancestor) — excluded from scale. */
    disabled: boolean;
    /** This is the container's last direct child — the tail "+" affordance hangs off it. */
    isLast: boolean;
};

export type LensProjection = {
    mode: "parallel" | "race";
    /** Longest known track footprint, floored to 1ms so bar widths never divide by zero. */
    scaleMs: number;
    tracks: LensTrackSegment[];
    /**
     * Earliest known finish among the tracks — the point a `race` resolves. Null for `parallel`, and
     * null for a `race` whose tracks are all unknown-duration. Bars still extend past it (losers run on).
     */
    winnerFinishMs: number | null;
};

/**
 * One track's segment plus the container-level context a row needs to draw its bar to scale — attached
 * to the direct-child rows of a lensed container so the row renderer stays a pure function of its row.
 */
export type StoryLensRowTrack = {
    segment: LensTrackSegment;
    scaleMs: number;
    mode: "parallel" | "race";
    winnerFinishMs: number | null;
};

/**
 * Whether a track swaps the row's content column for a bar. False for a prose track: that row keeps
 * the ordinary content — badge, preview, in-place text editor, voice indicator, row actions — so the
 * lens never leaves an editable row without an editor. The row still belongs to the lens (it keeps its
 * `isLast` tail "+"), it just is not drawn as a bar.
 */
export function lensTrackRendersBar(track: StoryLensRowTrack): boolean {
    return track.segment.kind !== "text";
}

/** True for the two container flavours the lens renders (the others keep their normal list rendering). */
export function isLensContainer(block: StoryBlock): block is Extract<StoryBlock, { kind: "control" }> {
    return block.kind === "control" && (block.payload.control === "parallel" || block.payload.control === "race");
}

/** Whether a container mode runs its children one-after-another (sum durations) vs. together (max). */
function isSequentialControl(block: Extract<StoryBlock, { kind: "control" }>): boolean {
    if (block.payload.control !== "sequence" && block.payload.control !== "repeat"
        && block.payload.control !== "parallel" && block.payload.control !== "race") {
        return false;
    }
    const mode = block.payload.mode ?? (block.payload.control === "parallel" ? "all" : block.payload.control === "race" ? "any" : "do");
    return mode === "do" || mode === "doAsync";
}

/** The primary animated duration an action payload carries, or undefined when it has none we can read. */
function actionDurationMs(payload: StoryActionPayload): number | undefined {
    switch (payload.action) {
        case "displayable":
            return payload.durationMs;
        // The camera's whole point in a `parallel` is running against a sprite move, so its bar has to
        // be drawn to scale rather than as an unknown-width stub (2026-07-24-006 §12.7).
        case "camera":
            return payload.durationMs;
        // A vfx fade is the same case: "the rain fades in while the camera pushes past" is the typical
        // parallel, and the engine's show/hide WAIT for the fade, so the bar is a real footprint. Its
        // instant operations (pause/resume/setRate) carry no duration and stay unknown.
        case "vfx":
            return payload.operation === "show" || payload.operation === "hide" || payload.operation === "create"
                ? payload.durationMs
                : undefined;
        case "screenEffect":
            return payload.durationMs === undefined && payload.holdMs === undefined
                ? undefined
                : (payload.durationMs ?? 0) + (payload.holdMs ?? 0);
        case "audio":
            return payload.fadeMs;
        case "setBackground":
            return payload.transition?.durationMs;
        case "character":
            return payload.transition?.durationMs ?? payload.transform?.durationMs;
        case "image":
            return payload.transition?.durationMs ?? payload.transform?.durationMs;
        case "text":
            return payload.transform?.durationMs;
        case "layer":
            return payload.transform?.durationMs;
        case "nvl":
            return payload.transition?.durationMs;
        // setVariable / video / wait / blueprint carry no duration we can project — treated as unknown.
        default:
            return undefined;
    }
}

/** A single block's timing, before container aggregation. `wait` is the only source of a leading delay. */
function deriveBlockTiming(block: StoryBlock): { delayMs: number; durationMs: number; unknown: boolean } {
    if (block.kind === "action") {
        const payload = block.payload;
        if (payload.action === "wait") {
            // A click-wait is indeterminate; a timed wait is pure dead time on its own track.
            if (payload.mode === "click") {
                return { delayMs: 0, durationMs: 0, unknown: true };
            }
            return { delayMs: Math.max(0, payload.durationMs ?? 0), durationMs: 0, unknown: false };
        }
        const duration = actionDurationMs(payload);
        return duration === undefined
            ? { delayMs: 0, durationMs: 0, unknown: true }
            : { delayMs: 0, durationMs: Math.max(0, duration), unknown: false };
    }
    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        const pauseAfter = block.payload.pauseAfter;
        return typeof pauseAfter === "number"
            ? { delayMs: 0, durationMs: Math.max(0, pauseAfter), unknown: false }
            : { delayMs: 0, durationMs: 0, unknown: true };
    }
    return { delayMs: 0, durationMs: 0, unknown: true };
}

/**
 * The finish time of any block, recursing through nested containers so a subgroup track shows a
 * meaningful aggregate. Sequential modes sum their known children; parallel modes take the max; a
 * repeat multiplies by its count. Unknown iff no descendant contributes a known duration.
 */
function blockFinishMs(scene: StoryScene, block: StoryBlock, seen: Set<StoryBlockId> = new Set()): { ms: number; unknown: boolean } {
    // Cycle guard: a well-formed document is a tree, but a corrupted `childrenIds` cycle must not spin
    // the render thread — a re-seen block contributes nothing rather than recursing forever.
    if (seen.has(block.id)) {
        return { ms: 0, unknown: true };
    }
    seen.add(block.id);
    if (block.kind === "control"
        && (block.payload.control === "sequence" || block.payload.control === "parallel"
            || block.payload.control === "race" || block.payload.control === "repeat")) {
        const parts = block.childrenIds
            .map(id => scene.blocks[id])
            .filter((child): child is StoryBlock => Boolean(child) && !child!.disabled)
            .map(child => blockFinishMs(scene, child, seen));
        const known = parts.filter(part => !part.unknown);
        if (known.length === 0) {
            return { ms: 0, unknown: true };
        }
        let ms = isSequentialControl(block)
            ? known.reduce((sum, part) => sum + part.ms, 0)
            : known.reduce((max, part) => Math.max(max, part.ms), 0);
        if (block.payload.control === "repeat") {
            ms *= Math.max(1, block.payload.times ?? 1);
        }
        return { ms, unknown: false };
    }
    const timing = deriveBlockTiming(block);
    return { ms: timing.delayMs + timing.durationMs, unknown: timing.unknown };
}

/** The track segment for one direct child of a lens container. */
function deriveTrackSegment(scene: StoryScene, child: StoryBlock, isLast: boolean): LensTrackSegment {
    const disabled = Boolean(child.disabled);
    // Prose first: a narration / dialogue / note child (reachable through the lens's own tail "+")
    // renders as an ordinary editable row, not a bar. It therefore contributes no footprint either —
    // an invisible track must never set the scale nor decide a race, which is why a dialogue's
    // `pauseAfter` is read only when it sits deeper, inside a subgroup's aggregate.
    if (getTextSegment(child)) {
        return { blockId: child.id, kind: "text", delayMs: 0, durationMs: 0, unknown: true, finishMs: 0, disabled, isLast };
    }
    if (child.kind === "control"
        && (child.payload.control === "sequence" || child.payload.control === "parallel"
            || child.payload.control === "race" || child.payload.control === "repeat")) {
        const finish = blockFinishMs(scene, child);
        return {
            blockId: child.id,
            kind: "subgroup",
            delayMs: 0,
            durationMs: finish.unknown ? 0 : finish.ms,
            unknown: finish.unknown,
            finishMs: finish.unknown ? 0 : finish.ms,
            disabled,
            isLast,
        };
    }
    const timing = deriveBlockTiming(child);
    const isWait = child.kind === "action" && child.payload.action === "wait";
    return {
        blockId: child.id,
        kind: isWait ? "wait" : "action",
        delayMs: timing.delayMs,
        durationMs: timing.durationMs,
        unknown: timing.unknown,
        finishMs: timing.delayMs + timing.durationMs,
        disabled,
        isLast,
    };
}

/**
 * Project a parallel/race container into its bar-timeline model. Every direct child yields one track
 * (in document order); the scale and the race decision marker are computed only over enabled tracks
 * with a known duration, so a disabled or unknown child never distorts the proportions.
 */
export function projectStagingLens(scene: StoryScene, container: StoryBlock): LensProjection {
    const mode: "parallel" | "race" = container.kind === "control" && container.payload.control === "race" ? "race" : "parallel";
    const childIds = container.kind === "control" ? container.childrenIds : [];
    const tracks = childIds
        .map(id => scene.blocks[id])
        .filter((child): child is StoryBlock => Boolean(child))
        .map((child, index, all) => deriveTrackSegment(scene, child, index === all.length - 1));

    const contributing = tracks.filter(track => !track.disabled && !track.unknown);
    const scaleMs = Math.max(1, ...contributing.map(track => track.finishMs));
    const winnerFinishMs = mode === "race" && contributing.length > 0
        ? Math.min(...contributing.map(track => track.finishMs))
        : null;

    return { mode, scaleMs, tracks, winnerFinishMs };
}

/**
 * The containers that actually render as a lens right now: those the author enabled AND that still
 * exist as parallel/race, minus any nested inside another enabled lens (a nested one shows as a single
 * subgroup track of its parent's lens, so it does not render its own). Deleted-container ids and
 * since-changed control kinds silently drop out.
 */
export function resolveEffectiveLensContainers(scene: StoryScene, requested: ReadonlySet<StoryBlockId>): Set<StoryBlockId> {
    const active = new Set<StoryBlockId>();
    for (const id of requested) {
        const block = scene.blocks[id];
        if (block && isLensContainer(block)) {
            active.add(id);
        }
    }
    const effective = new Set<StoryBlockId>();
    for (const id of active) {
        let ancestorId = scene.blocks[id]?.parentId ?? null;
        let nestedInLens = false;
        const seen = new Set<StoryBlockId>();
        while (ancestorId && !seen.has(ancestorId)) {
            seen.add(ancestorId);
            if (active.has(ancestorId)) {
                nestedInLens = true;
                break;
            }
            ancestorId = scene.blocks[ancestorId]?.parentId ?? null;
        }
        if (!nestedInLens) {
            effective.add(id);
        }
    }
    return effective;
}

/**
 * Rewrite a flat visible-row list so each effective-lens container's subtree becomes [header + one
 * track per direct child]: a direct child gets its `lensTrack` annotation, and every deeper descendant
 * is dropped (a nested container stands in for its own subtree as one subgroup track). Rows outside any
 * lens pass through untouched. The container must be expanded upstream so its direct children are
 * present in `rows` — this pass only annotates and prunes, it never re-expands.
 */
export function applyStagingLensToRows<R extends { block: StoryBlock; lensTrack?: StoryLensRowTrack }>(
    scene: StoryScene,
    rows: R[],
    effectiveLensIds: ReadonlySet<StoryBlockId>,
): R[] {
    if (effectiveLensIds.size === 0) {
        return rows;
    }
    const projections = new Map<StoryBlockId, LensProjection>();
    const projectionFor = (containerId: StoryBlockId): LensProjection => {
        let projection = projections.get(containerId);
        if (!projection) {
            projection = projectStagingLens(scene, scene.blocks[containerId]);
            projections.set(containerId, projection);
        }
        return projection;
    };
    return rows.flatMap(row => {
        const parentId = row.block.parentId;
        if (!parentId) {
            return [row];
        }
        // Nearest ancestor that renders as a lens (outermost enabled) decides this row's fate.
        let ancestorId: StoryBlockId | null = parentId;
        let nearestLensId: StoryBlockId | null = null;
        const seen = new Set<StoryBlockId>();
        while (ancestorId && !seen.has(ancestorId)) {
            seen.add(ancestorId);
            if (effectiveLensIds.has(ancestorId)) {
                nearestLensId = ancestorId;
                break;
            }
            ancestorId = scene.blocks[ancestorId]?.parentId ?? null;
        }
        if (!nearestLensId) {
            return [row];
        }
        if (parentId !== nearestLensId) {
            // A deeper descendant of the lens container — hidden; its own container shows as one track.
            return [];
        }
        const projection = projectionFor(nearestLensId);
        const segment = projection.tracks.find(track => track.blockId === row.block.id);
        if (!segment) {
            return [row];
        }
        return [{ ...row, lensTrack: { segment, scaleMs: projection.scaleMs, mode: projection.mode, winnerFinishMs: projection.winnerFinishMs } }];
    });
}
