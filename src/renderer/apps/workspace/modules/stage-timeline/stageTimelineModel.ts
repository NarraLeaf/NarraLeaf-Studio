/**
 * The stage timeline's model: a scene's walk turned into lanes, cells and column widths.
 *
 * Pure on purpose. The walk ({@link walkStoryStageTimeline}) says what is on the stage after every
 * row; everything here only reads those frames, so the rules for "where does a lane start", "which
 * row set this" and "how wide is this column" are all testable without a workspace.
 *
 * Comments in English per project convention.
 */

import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import { soundStageObjectName } from "@shared/types/story";
import { authoredNameOrNull } from "@shared/utils/generatedId";
import type {
    StageSnapshotImageSource,
    StageTimelineFrame,
    StageTimelineWalk,
} from "@/lib/ui-editor/runtime/game/storyStageSnapshot";

export type StageTimelineLaneKind = "background" | "character" | "image" | "text" | "vfx" | "camera" | "music" | "sound";

/** One lane at one column. */
export type StageTimelineCell = {
    /** On the stage (or, for audio, playing) once this column's row has run. */
    present: boolean;
    /** What the lane shows here: a pose, a picture, a track. Null when there is nothing to name. */
    label: string | null;
    /** The column whose row put the lane in this state - the row a click on the cell goes to. */
    since: number;
    /** This column's row changed the lane while it was already present. */
    changed: boolean;
};

export type StageTimelineLane = {
    id: string;
    kind: StageTimelineLaneKind;
    name: string;
    /** The character a character lane belongs to, for its colour. */
    characterId?: string;
    cells: StageTimelineCell[];
};

/** Where a column's length comes from. */
export type StageTimelineTimingSource = "voice" | "estimate" | "action" | "choice" | "instant";

export type StageTimelineTiming = {
    durationMs: number;
    source: StageTimelineTimingSource;
};

export type StageTimelineModel = {
    /** The row behind each column, in play order. */
    blockIds: StoryBlockId[];
    lanes: StageTimelineLane[];
    timings: StageTimelineTiming[];
    choices: StageTimelineWalk["choices"];
};

/** What the model needs to put names on things; supplied by the panel, which has the services. */
export type StageTimelineNames = {
    asset: (assetId: string) => string | null;
    character: (characterId: string) => string | null;
    /** Seconds of the take recorded for a line, when there is one. */
    voiceSeconds: (textId: string) => number | undefined;
};

/** How long a menu holds a column, which nothing in the scene can say: the player decides. */
export const STAGE_TIMELINE_CHOICE_MS = 2000;

export function buildStageTimelineModel(input: {
    walk: StageTimelineWalk;
    scene: StoryScene;
    names: StageTimelineNames;
}): StageTimelineModel {
    const { walk, scene, names } = input;
    const frames = walk.frames;
    const lanes: StageTimelineLane[] = [
        backgroundLane(frames, names),
        ...displayableLanes(frames, names),
        ...vfxLanes(frames, scene, names),
        cameraLane(frames),
        musicLane(frames, scene, names),
        ...soundLanes(frames, scene, names),
    ].filter((lane): lane is StageTimelineLane => lane !== null && lane.cells.some(cell => cell.present));
    return {
        blockIds: frames.map(frame => frame.blockId),
        lanes,
        timings: frames.map(frame => stageTimelineTiming(scene.blocks[frame.blockId], names)),
        choices: walk.choices,
    };
}

/**
 * Fold one lane's per-column states into cells. `state` answers what the lane is at a column - null
 * when absent - plus a key that changes exactly when the row changed it.
 */
function foldCells(
    count: number,
    state: (index: number) => { label: string | null; key: string } | null,
): StageTimelineCell[] {
    const cells: StageTimelineCell[] = [];
    let since = 0;
    let previous: { label: string | null; key: string } | null = null;
    for (let index = 0; index < count; index += 1) {
        const current = state(index);
        const entered = current !== null && previous === null;
        const changed = current !== null && previous !== null && current.key !== previous.key;
        const left = current === null && previous !== null;
        if (entered || changed || left) {
            since = index;
        }
        cells.push({ present: current !== null, label: current?.label ?? null, since, changed });
        previous = current;
    }
    return cells;
}

function backgroundLane(frames: readonly StageTimelineFrame[], names: StageTimelineNames): StageTimelineLane {
    return {
        id: "background",
        kind: "background",
        name: "",
        cells: foldCells(frames.length, index => {
            const background = frames[index].background;
            if (!background) {
                return null;
            }
            const label = background.assetId ? names.asset(background.assetId) : background.color ?? null;
            return { label, key: JSON.stringify(background) };
        }),
    };
}

function displayableLanes(frames: readonly StageTimelineFrame[], names: StageTimelineNames): StageTimelineLane[] {
    const order: string[] = [];
    const seen = new Map<string, StageTimelineFrame["displayables"][number]>();
    for (const frame of frames) {
        for (const record of frame.displayables) {
            const key = `${record.kind}:${record.objectName}`;
            if (!seen.has(key)) {
                order.push(key);
            }
            seen.set(key, record);
        }
    }
    const characters: StageTimelineLane[] = [];
    const others: StageTimelineLane[] = [];
    for (const key of order) {
        const last = seen.get(key)!;
        const characterId = characterOf(frames, key);
        const cells = foldCells(frames.length, index => {
            const record = frames[index].displayables.find(candidate => `${candidate.kind}:${candidate.objectName}` === key);
            if (!record || !record.visible) {
                return null;
            }
            return { label: displayableLabel(record.source, record.text, names), key: record.signature };
        });
        const lane: StageTimelineLane = characterId
            ? { id: `d:${key}`, kind: "character", name: names.character(characterId) ?? last.objectName, characterId, cells }
            : {
                id: `d:${key}`,
                kind: last.kind === "text" ? "text" : "image",
                name: authoredNameOrNull(last.objectName) ?? sourceName(last.source, names) ?? last.objectName,
                cells,
            };
        (characterId ? characters : others).push(lane);
    }
    return [...characters, ...others];
}

/** The character an image lane shows, read off any frame that sourced it from one. */
function characterOf(frames: readonly StageTimelineFrame[], key: string): string | undefined {
    for (const frame of frames) {
        const record = frame.displayables.find(candidate => `${candidate.kind}:${candidate.objectName}` === key);
        if (record?.source?.type === "character" && record.source.characterId) {
            return record.source.characterId;
        }
    }
    return undefined;
}

function displayableLabel(source: StageSnapshotImageSource | undefined, text: string | undefined, names: StageTimelineNames): string | null {
    if (text !== undefined) {
        return text;
    }
    if (!source) {
        return null;
    }
    if (source.type === "character") {
        if (source.pose) {
            return source.pose;
        }
        const tags = Object.values(source.tags ?? {}).filter((value): value is string => typeof value === "string" && value.length > 0);
        return tags.length > 0 ? tags.join(" · ") : null;
    }
    return sourceName(source, names);
}

function sourceName(source: StageSnapshotImageSource | undefined, names: StageTimelineNames): string | null {
    if (source?.type === "asset") {
        return names.asset(source.assetId);
    }
    if (source?.type === "color") {
        return source.color;
    }
    return null;
}

function vfxLanes(frames: readonly StageTimelineFrame[], scene: StoryScene, names: StageTimelineNames): StageTimelineLane[] {
    const declared = frames.at(-1)?.vfx ?? [];
    return declared.map(record => ({
        id: `vfx:${record.objectName}`,
        kind: "vfx" as const,
        name: authoredNameOrNull(record.objectName) ?? rowAssetName(scene.blocks[record.sourceBlockId], names) ?? record.objectName,
        cells: foldCells(frames.length, index => {
            const current = frames[index].vfx.find(candidate => candidate.objectName === record.objectName);
            return current?.showing ? { label: null, key: "" } : null;
        }),
    }));
}

function cameraLane(frames: readonly StageTimelineFrame[]): StageTimelineLane {
    return {
        id: "camera",
        kind: "camera",
        name: "",
        cells: foldCells(frames.length, index => {
            const camera = frames[index].camera;
            if (!camera || isNeutralCamera(camera.props, camera.effects)) {
                return null;
            }
            const zoom = camera.props.zoom;
            const label = typeof zoom === "number" && zoom !== 1 ? `${Math.round(zoom * 100) / 100}×` : null;
            return { label, key: JSON.stringify([camera.props, camera.effects, camera.loop]) };
        }),
    };
}

/**
 * Whether a settled camera pose is the neutral one. A `/camera` row back to the start leaves a
 * record whose numbers are all at rest; the lane treats that the same as no record at all.
 */
export function isNeutralCamera(props: Record<string, unknown>, effects: Record<string, unknown>): boolean {
    const atRest = (key: string, value: unknown): boolean => {
        if (value === undefined || value === null) {
            return true;
        }
        if (typeof value === "number") {
            return /zoom|scale/i.test(key) ? value === 1 : value === 0;
        }
        if (typeof value === "object") {
            return Object.entries(value as Record<string, unknown>).every(([inner, innerValue]) => atRest(inner, innerValue));
        }
        return false;
    };
    return Object.entries(props).every(([key, value]) => atRest(key, value))
        && Object.entries(effects).every(([key, value]) => key === "darkness" ? !value : value === undefined || value === "clear");
}

function musicLane(frames: readonly StageTimelineFrame[], scene: StoryScene, names: StageTimelineNames): StageTimelineLane {
    return {
        id: "music",
        kind: "music",
        name: "",
        cells: foldCells(frames.length, index => {
            const music = frames[index].music;
            if (!music || !music.playing || music.paused) {
                return null;
            }
            const assetId = music.setBy ? rowAssetId(scene.blocks[music.setBy]) : scene.bgm?.assetId;
            return { label: assetId ? names.asset(assetId) : null, key: music.setBy ?? "" };
        }),
    };
}

/**
 * One lane per sound handle. A looping sound is a span, from its start to its stop. A one-shot is a
 * mark on each row that starts it: the walk keeps a played clip "playing" until a row stops it, but
 * a clip that does not loop ends by itself after a time no row records, and a span to the end of
 * the scene would say it never stops.
 */
function soundLanes(frames: readonly StageTimelineFrame[], scene: StoryScene, names: StageTimelineNames): StageTimelineLane[] {
    const handles = frames.at(-1)?.sounds ?? [];
    return handles.map(handle => {
        const source = scene.blocks[handle.sourceBlockId];
        const loops = source?.kind === "action" && source.payload.action === "audio" && source.payload.loop === true;
        const label = rowAssetName(source, names);
        return {
            id: `sound:${handle.objectName}`,
            kind: "sound" as const,
            name: authoredNameOrNull(handle.objectName) ?? label ?? handle.objectName,
            cells: foldCells(frames.length, index => {
                if (loops) {
                    const current = frames[index].sounds.find(candidate => candidate.objectName === handle.objectName);
                    return current?.playing && !current.paused ? { label, key: "" } : null;
                }
                const block = scene.blocks[frames[index].blockId];
                const starts = block?.kind === "action" && block.payload.action === "audio"
                    && block.payload.operation === "playSound" && soundStageObjectName(block.payload) === handle.objectName;
                // Keyed by column so two starts in a row read as two marks rather than one span.
                return starts ? { label, key: String(index) } : null;
            }),
        };
    });
}

function rowAssetId(block: StoryBlock | undefined): string | undefined {
    if (block?.kind !== "action") {
        return undefined;
    }
    const payload = block.payload as { assetId?: unknown };
    return typeof payload.assetId === "string" && payload.assetId ? payload.assetId : undefined;
}

function rowAssetName(block: StoryBlock | undefined, names: StageTimelineNames): string | null {
    const assetId = rowAssetId(block);
    return assetId ? names.asset(assetId) : null;
}

/** Base reading time of a line, before its words. */
const ESTIMATE_BASE_MS = 400;
/** Reading time of one full-width character; a Latin letter counts for a third of one. */
const ESTIMATE_CHAR_MS = 160;
const ESTIMATE_LATIN_WEIGHT = 0.35;

/** How long a row holds the stage, and where that number comes from. */
export function stageTimelineTiming(block: StoryBlock | undefined, names: StageTimelineNames): StageTimelineTiming {
    if (!block) {
        return { durationMs: 0, source: "instant" };
    }
    if (block.kind === "nodeAction") {
        const payload = block.payload;
        if (payload.action === "choice") {
            return { durationMs: STAGE_TIMELINE_CHOICE_MS, source: "choice" };
        }
        if (payload.action === "narration" || payload.action === "dialogue") {
            const seconds = names.voiceSeconds(payload.text.textId);
            if (seconds !== undefined && seconds > 0) {
                return { durationMs: Math.round(seconds * 1000), source: "voice" };
            }
            const pauses = (payload.text.rich ?? []).reduce((sum, run) => (
                "pause" in run && typeof run.pause === "number" ? sum + run.pause : sum
            ), 0);
            return { durationMs: estimateReadingMs(payload.text.value) + pauses, source: "estimate" };
        }
        return { durationMs: 0, source: "instant" };
    }
    if (block.kind === "action") {
        const durationMs = actionDurationMs(block.payload as Record<string, unknown>);
        return durationMs > 0 ? { durationMs, source: "action" } : { durationMs: 0, source: "instant" };
    }
    return { durationMs: 0, source: "instant" };
}

export function estimateReadingMs(text: string): number {
    let weight = 0;
    for (const char of text) {
        if (/\s/.test(char)) {
            continue;
        }
        weight += char.charCodeAt(0) > 0x2e7f ? 1 : ESTIMATE_LATIN_WEIGHT;
    }
    return Math.round(ESTIMATE_BASE_MS + weight * ESTIMATE_CHAR_MS);
}

/** The longest timed thing an action row names: its wait, its transition, or its movement. */
function actionDurationMs(payload: Record<string, unknown>): number {
    const read = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
    const nested = (value: unknown): number => {
        if (!value || typeof value !== "object") {
            return 0;
        }
        const record = value as Record<string, unknown>;
        return read(record.durationMs) + read(record.delayMs);
    };
    return Math.max(read(payload.durationMs), nested(payload.transition), nested(payload.transform));
}

export type StageTimelineLayoutMode = "equal" | "timed";

/** Width of a column in the equal layout. */
export const STAGE_TIMELINE_EQUAL_PX = 28;
/** Width of one second in the timed layout. */
export const STAGE_TIMELINE_SECOND_PX = 48;
/** The narrowest a column gets, so an instant row can still be seen and clicked. */
export const STAGE_TIMELINE_MIN_PX = 8;

export type StageTimelineColumn = { x: number; width: number };

export function stageTimelineColumns(
    timings: readonly StageTimelineTiming[],
    mode: StageTimelineLayoutMode,
    zoom: number,
): StageTimelineColumn[] {
    let x = 0;
    return timings.map(timing => {
        const width = mode === "equal"
            ? STAGE_TIMELINE_EQUAL_PX * zoom
            : Math.max(STAGE_TIMELINE_MIN_PX, (timing.durationMs / 1000) * STAGE_TIMELINE_SECOND_PX * zoom);
        const column = { x, width };
        x += width;
        return column;
    });
}

/** Every block of a scene in document order, each row before the rows nested under it. */
export function sceneBlockOrder(scene: StoryScene): Map<StoryBlockId, number> {
    const order = new Map<StoryBlockId, number>();
    const visit = (blockIds: readonly StoryBlockId[]) => {
        for (const blockId of blockIds) {
            const block = scene.blocks[blockId];
            if (!block || order.has(blockId)) {
                continue;
            }
            order.set(blockId, order.size);
            visit(block.childrenIds ?? []);
        }
    };
    visit(scene.rootBlockIds);
    return order;
}

/**
 * The column the editor's cursor stands at: its own row's column, or the last column before it in
 * the document (a cursor on a condition or a note sits between the rows that run). -1 before the
 * first column or with no cursor.
 */
export function stageTimelineCursorColumn(
    blockIds: readonly StoryBlockId[],
    cursor: StoryBlockId | null | undefined,
    order: ReadonlyMap<StoryBlockId, number>,
): number {
    if (!cursor) {
        return -1;
    }
    const exact = blockIds.indexOf(cursor);
    if (exact >= 0) {
        return exact;
    }
    const at = order.get(cursor);
    if (at === undefined) {
        return -1;
    }
    let found = -1;
    blockIds.forEach((blockId, index) => {
        const position = order.get(blockId);
        if (position !== undefined && position <= at) {
            found = index;
        }
    });
    return found;
}

/**
 * The rows to walk the scene through: the row being read, and the option picked at every menu the
 * row is not inside. The row being read wins its own menus, so moving the cursor into an option
 * shows that option's stage without picking it first.
 */
export function stageTimelineThrough(
    scene: StoryScene,
    cursor: StoryBlockId | null | undefined,
    picks: ReadonlyMap<StoryBlockId, StoryBlockId>,
): StoryBlockId[] {
    const ancestors = new Set<StoryBlockId>();
    // Only a cursor inside an option or a branch changes the walk; anywhere else it is left off, so
    // the path - and the walk behind it - stays the same while the cursor moves down plain rows.
    let decides = false;
    let current = cursor ? scene.blocks[cursor] : undefined;
    while (current) {
        ancestors.add(current.id);
        decides ||= (current.kind === "nodeAction" && current.payload.action === "choiceOption")
            || (current.kind === "control" && current.payload.control === "conditionBranch");
        current = current.parentId ? scene.blocks[current.parentId] : undefined;
    }
    const through: StoryBlockId[] = cursor && decides ? [cursor] : [];
    for (const [choiceId, optionId] of picks) {
        if (!ancestors.has(choiceId) && scene.blocks[optionId]?.parentId === choiceId) {
            through.push(optionId);
        }
    }
    return through;
}
