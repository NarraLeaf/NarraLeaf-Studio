/**
 * The stage timeline's model: a scene's walk turned into lanes, cells and column widths.
 *
 * A column is a line: every row of dialogue or narration starts one, and the rows that only act on
 * the stage (a character entering, a background changing) have none of their own. They belong to the
 * line before them - the column runs from a line to the next - and show as a mark on the lane they
 * changed, at their place in that column. Rows before the first line take one column of their own.
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
    /** The picture behind that state, for a preview beside its name. Null when it has none. */
    image: string | null;
    /** For a character: the look it shows, which the preview composes. Null for anything else. */
    sprite: StageTimelineSprite | null;
    /** The column whose row put the lane in this state - the row a click on the cell goes to. */
    since: number;
    /** This column's row changed the lane while it was already present. */
    changed: boolean;
};

/** A row that changed a lane without changing its name: a move, a zoom, an effect. */
export type StageTimelineMark = {
    column: number;
    /** Where in the column, 0 to 1: the row's place among the rows the column holds. */
    at: number;
};

export type StageTimelineSprite = { characterId: string; poseId?: string; tags?: Record<string, string> };

export type StageTimelineLane = {
    id: string;
    kind: StageTimelineLaneKind;
    name: string;
    /** The character a character lane belongs to, for its colour. */
    characterId?: string;
    cells: StageTimelineCell[];
    marks: StageTimelineMark[];
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
    /** The number the editor's gutter prints beside each column's line; null for a column with no line. */
    lineNumbers: (number | null)[];
    /** The words a column's row says - a line of dialogue or narration - or null for any other row. */
    lines: (string | null)[];
    lanes: StageTimelineLane[];
    timings: StageTimelineTiming[];
    /** Each menu the walk passed, placed in its column the way a mark is. */
    choices: (StageTimelineWalk["choices"][number] & { column: number; at: number })[];
    /** Every row the walk ran, in play order, and the column each one belongs to. */
    rowBlockIds: StoryBlockId[];
    rowColumns: number[];
};

/** What the model needs to put names on things; supplied by the panel, which has the services. */
export type StageTimelineNames = {
    asset: (assetId: string) => string | null;
    character: (characterId: string) => string | null;
    /**
     * The name of a pose (preset) or of a tag (layered) a character shows. The rows store ids;
     * null when the id no longer names anything, which leaves the cell unlabelled.
     */
    appearance: (characterId: string, appearanceId: string) => string | null;
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
    const rowLanes = [
        backgroundLane(frames, names),
        ...displayableLanes(frames, names),
        ...vfxLanes(frames, scene, names),
        cameraLane(frames),
        musicLane(frames, scene, names),
        ...soundLanes(frames, scene, names),
    ];
    const groups = groupRowsByLine(frames.map(frame => spokenText(scene.blocks[frame.blockId]) !== null));
    const rowColumns: number[] = [];
    groups.forEach((group, column) => {
        for (let row = group.start; row <= group.end; row += 1) {
            rowColumns[row] = column;
        }
    });
    const placeOf = (row: number) => {
        const group = groups[rowColumns[row]];
        return { column: rowColumns[row], at: (row - group.start + 0.5) / (group.end - group.start + 1) };
    };
    const lanes = rowLanes
        .map(lane => toColumns(lane, groups, rowColumns, placeOf))
        .filter(lane => lane.cells.some(cell => cell.present));
    const order = sceneBlockOrder(scene);
    const rowTimings = frames.map(frame => stageTimelineTiming(scene.blocks[frame.blockId], names));
    const anchors = groups.map(group => frames[group.anchor].blockId);
    return {
        blockIds: anchors,
        lineNumbers: groups.map((group, column) => (group.line ? (order.get(anchors[column]) ?? 0) + 1 : null)),
        lines: anchors.map(blockId => spokenText(scene.blocks[blockId])),
        lanes,
        timings: groups.map(group => columnTiming(rowTimings.slice(group.start, group.end + 1), rowTimings[group.anchor], group.line)),
        choices: walk.choices.flatMap(choice => {
            const row = frames.findIndex(frame => frame.blockId === choice.choiceBlockId);
            return row < 0 ? [] : [{ ...choice, ...placeOf(row) }];
        }),
        rowBlockIds: frames.map(frame => frame.blockId),
        rowColumns,
    };
}

type RowGroup = { start: number; end: number; anchor: number; line: boolean };

/**
 * Split the rows into columns: each line opens a column that holds it and the rows up to the next
 * line; rows before the first line make one more column in front. A scene with no lines at all keeps
 * a column per row, so it still reads as a sequence.
 */
export function groupRowsByLine(isLine: readonly boolean[]): RowGroup[] {
    if (!isLine.includes(true)) {
        return isLine.map((_, row) => ({ start: row, end: row, anchor: row, line: false }));
    }
    const groups: RowGroup[] = [];
    const first = isLine.indexOf(true);
    if (first > 0) {
        groups.push({ start: 0, end: first - 1, anchor: first - 1, line: false });
    }
    isLine.forEach((line, row) => {
        if (!line) {
            return;
        }
        if (groups.length > 0 && groups[groups.length - 1].line) {
            groups[groups.length - 1].end = row - 1;
        }
        groups.push({ start: row, end: isLine.length - 1, anchor: row, line: true });
    });
    return groups;
}

/**
 * A lane read by column. A line's column shows the lane as it stands when the line is read - once
 * its row has run; the column in front of the first line shows the stage those rows set up. A
 * one-shot sound is the exception: it is heard if any row in the column starts it. A row that changed
 * the lane but kept its name leaves a mark; a change of name shows as the next column's block.
 */
function toColumns(
    lane: StageTimelineLane,
    groups: readonly RowGroup[],
    rowColumns: readonly number[],
    placeOf: (row: number) => StageTimelineMark,
): StageTimelineLane {
    const cells = groups.map(group => {
        const rows = lane.cells.slice(group.start, group.end + 1);
        const shown = lane.cells[group.anchor];
        const heard = lane.kind === "sound" ? rows.find(cell => cell.present) : undefined;
        const cell = heard ?? shown;
        return { ...cell, present: Boolean(heard) || shown.present, since: rowColumns[cell.since] ?? 0, changed: false };
    });
    const marks = lane.kind === "sound" ? [] : lane.cells.flatMap((cell, row) => {
        const previous = lane.cells[row - 1];
        return cell.changed && previous?.present && cell.label === previous.label ? [placeOf(row)] : [];
    });
    return { ...lane, cells, marks };
}

/** A column lasts as long as all its rows; it is timed like its line when it has one. */
function columnTiming(rows: readonly StageTimelineTiming[], anchor: StageTimelineTiming, line: boolean): StageTimelineTiming {
    const durationMs = rows.reduce((sum, row) => sum + row.durationMs, 0);
    if (line) {
        return { durationMs, source: anchor.source };
    }
    return durationMs > 0 ? { durationMs, source: "action" } : { durationMs: 0, source: "instant" };
}

type FoldedState = { label: string | null; key: string; image?: string | null; sprite?: StageTimelineSprite | null };

/**
 * Fold one lane's per-column states into cells. `state` answers what the lane is at a column - null
 * when absent - plus a key that changes exactly when the row changed it.
 */
function foldCells(
    count: number,
    state: (index: number) => FoldedState | null,
    options: { leavingSetsSince?: boolean } = {},
): StageTimelineCell[] {
    const leavingSetsSince = options.leavingSetsSince ?? true;
    const cells: StageTimelineCell[] = [];
    let since = 0;
    let previous: FoldedState | null = null;
    for (let index = 0; index < count; index += 1) {
        const current = state(index);
        const entered = current !== null && previous === null;
        const changed = current !== null && previous !== null && current.key !== previous.key;
        const left = current === null && previous !== null;
        if (entered || changed || (left && leavingSetsSince)) {
            since = index;
        }
        cells.push({
            present: current !== null,
            label: current?.label ?? null,
            image: current?.image ?? null,
            sprite: current?.sprite ?? null,
            since,
            changed,
        });
        previous = current;
    }
    return cells;
}

function backgroundLane(frames: readonly StageTimelineFrame[], names: StageTimelineNames): StageTimelineLane {
    return {
        id: "background",
        kind: "background",
        name: "",
        marks: [],
        cells: foldCells(frames.length, index => {
            const background = frames[index].background;
            if (!background) {
                return null;
            }
            const label = background.assetId ? names.asset(background.assetId) : background.color ?? null;
            return { label, key: JSON.stringify(background), image: background.assetId ?? null };
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
            return {
                label: displayableLabel(record.source, record.text, names),
                key: record.signature,
                image: record.source?.type === "asset" ? record.source.assetId : null,
                sprite: spriteOf(record.source),
            };
        });
        const lane: StageTimelineLane = characterId
            ? { id: `d:${key}`, kind: "character", name: names.character(characterId) ?? last.objectName, characterId, cells, marks: [] }
            : {
                id: `d:${key}`,
                kind: last.kind === "text" ? "text" : "image",
                name: authoredNameOrNull(last.objectName) ?? sourceName(last.source, names) ?? last.objectName,
                cells,
                marks: [],
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
        const characterId = source.characterId;
        if (!characterId) {
            return null;
        }
        if (source.pose) {
            return names.appearance(characterId, source.pose);
        }
        const tags = Object.values(source.tags ?? {})
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .map(tagId => names.appearance(characterId, tagId))
            .filter((name): name is string => name !== null);
        return tags.length > 0 ? tags.join(" · ") : null;
    }
    return sourceName(source, names);
}

function spriteOf(source: StageSnapshotImageSource | undefined): StageTimelineSprite | null {
    if (source?.type !== "character" || !source.characterId) {
        return null;
    }
    return {
        characterId: source.characterId,
        ...(source.pose ? { poseId: source.pose } : {}),
        ...(source.tags ? { tags: source.tags } : {}),
    };
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
        marks: [],
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
        marks: [],
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
        marks: [],
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
            marks: [],
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
                // A one-shot ends by itself, so the row after it did not stop it: silence after a
                // start still points at that start.
            }, { leavingSetsSince: loops }),
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

function spokenText(block: StoryBlock | undefined): string | null {
    if (block?.kind !== "nodeAction") {
        return null;
    }
    const payload = block.payload;
    return payload.action === "narration" || payload.action === "dialogue" ? payload.text.value : null;
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
