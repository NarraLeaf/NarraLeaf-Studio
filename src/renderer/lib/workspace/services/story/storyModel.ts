import {
    deriveUnassignedSceneIds,
    listSceneBlocksInDocumentOrder,
    listScenesInDocumentOrder,
    STORY_ANIMATION_SCHEMA_VERSION,
    STORY_DOCUMENT_SCHEMA_VERSION,
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
    StoryAnimationAsset,
    StoryAnimationAssetId,
    StoryAnimationConfig,
    StoryAnimationIndex,
    StoryAnimationIndexEntry,
    StoryAnimationKeyframe,
    StoryAnimationSequence,
    StoryAnimationSequenceOptions,
    StoryAnimationTimeline,
    StoryAnimationTrack,
    StoryAnimationTrackProperty,
    StoryBlock,
    StoryBlockId,
    StoryChapter,
    StoryDocument,
    StoryId,
    StoryLibraryEntry,
    StoryLibraryIndex,
    StoryNodeActionPayload,
    StoryScene,
    StorySceneId,
    StoryTextId,
    StoryTextSegment,
    StoryTransformSequenceProps,
} from "@shared/types/story";
import { assertValidStoryEntityId, assertValidStoryId, isValidStoryEntityId, isValidStoryId } from "@shared/utils/storyId";
import { migrateStoryDocumentToLatest } from "@shared/story/migrateStoryDocument";

export type StoryIdFactory = () => string;

export function createEmptyStoryLibraryIndex(now: string): StoryLibraryIndex {
    return {
        schemaVersion: STORY_LIBRARY_INDEX_SCHEMA_VERSION,
        stories: [],
        meta: {
            createdAt: now,
            updatedAt: now,
        },
    };
}

export function createEmptyStoryAnimationIndex(now: string): StoryAnimationIndex {
    return {
        schemaVersion: STORY_ANIMATION_SCHEMA_VERSION,
        animations: [],
        meta: {
            createdAt: now,
            updatedAt: now,
        },
    };
}

export function createStoryLibraryEntry(input: {
    id: StoryId;
    name: string;
    documentPath: string;
    now: string;
}): StoryLibraryEntry {
    assertValidStoryId(input.id);
    return {
        id: input.id,
        name: input.name,
        documentPath: input.documentPath,
        createdAt: input.now,
        updatedAt: input.now,
    };
}

export function createStoryAnimationIndexEntry(input: {
    id: StoryAnimationAssetId;
    name: string;
    targetKind: StoryAnimationIndexEntry["targetKind"];
    documentPath: string;
    now: string;
}): StoryAnimationIndexEntry {
    assertValidStoryEntityId(input.id, "Story animation id");
    return {
        id: input.id,
        name: input.name,
        targetKind: input.targetKind,
        documentPath: input.documentPath,
        createdAt: input.now,
        updatedAt: input.now,
    };
}

export function createStoryAnimationAsset(input: {
    id: StoryAnimationAssetId;
    name: string;
    targetKind: StoryAnimationAsset["targetKind"];
    timeline?: StoryAnimationTimeline;
    sequences?: StoryAnimationSequence[];
    /** Seeded by the preset library — a looping idle motion is its repeat count, not just its keyframes. */
    config?: StoryAnimationConfig;
    now: string;
}): StoryAnimationAsset {
    assertValidStoryEntityId(input.id, "Story animation id");
    const sequences = input.sequences ?? [createDefaultAnimationSequence(input.id)];
    return {
        schemaVersion: STORY_ANIMATION_SCHEMA_VERSION,
        id: input.id,
        name: input.name,
        targetKind: input.targetKind,
        timeline: normalizeAnimationTimeline(input.timeline, sequences, input.id),
        sequences,
        config: input.config ?? {},
        meta: {
            createdAt: input.now,
            updatedAt: input.now,
        },
    };
}

export function createEmptyStoryDocument(input: {
    id: StoryId;
    name: string;
    now: string;
    generateId: StoryIdFactory;
}): StoryDocument {
    assertValidStoryId(input.id);
    const chapterId = input.generateId();
    const sceneId = input.generateId();
    assertValidStoryEntityId(chapterId, "Story chapter id");
    assertValidStoryEntityId(sceneId, "Story scene id");
    const chapter: StoryChapter = {
        id: chapterId,
        name: "Chapter 1",
        sceneIds: [sceneId],
        meta: {
            createdAt: input.now,
            updatedAt: input.now,
        },
    };
    const scene: StoryScene = {
        id: sceneId,
        name: "Scene 1",
        runtimeName: "scene_1",
        description: "",
        rootBlockIds: [],
        blocks: {},
        meta: {
            createdAt: input.now,
            updatedAt: input.now,
        },
    };
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: input.id,
        name: input.name,
        entrySceneId: sceneId,
        chapters: [chapter],
        scenes: {
            [sceneId]: scene,
        },
        meta: {
            createdAt: input.now,
            updatedAt: input.now,
        },
    };
}

export function storyDocumentRelativePath(storyId: StoryId): string {
    assertValidStoryId(storyId);
    return `editor/story/stories/${storyId}/storydoc.json`;
}

export function storyAnimationDocumentRelativePath(animationId: StoryAnimationAssetId): string {
    assertValidStoryEntityId(animationId, "Story animation id");
    return `editor/story/animations/${animationId}.json`;
}

export function assertSupportedStoryLibraryIndex(index: StoryLibraryIndex): void {
    if (index.schemaVersion > STORY_LIBRARY_INDEX_SCHEMA_VERSION) {
        throw new Error("Story library index schema is newer than this Studio version");
    }
    if (index.schemaVersion !== STORY_LIBRARY_INDEX_SCHEMA_VERSION) {
        throw new Error("Story library index migration is not implemented");
    }
}

export function assertSupportedStoryDocument(document: StoryDocument): void {
    if (document.schemaVersion > STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new Error("Story document schema is newer than this Studio version");
    }
    if (document.schemaVersion !== STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new Error("Story document migration is not implemented");
    }
}

export function assertSupportedStoryAnimationIndex(index: StoryAnimationIndex): void {
    if (index.schemaVersion > STORY_ANIMATION_SCHEMA_VERSION) {
        throw new Error("Story animation index schema is newer than this Studio version");
    }
    if (index.schemaVersion !== STORY_ANIMATION_SCHEMA_VERSION) {
        throw new Error("Story animation index migration is not implemented");
    }
}

export function assertSupportedStoryAnimationAsset(asset: StoryAnimationAsset): void {
    if (asset.schemaVersion > STORY_ANIMATION_SCHEMA_VERSION) {
        throw new Error("Story animation asset schema is newer than this Studio version");
    }
    if (asset.schemaVersion !== STORY_ANIMATION_SCHEMA_VERSION) {
        throw new Error("Story animation asset migration is not implemented");
    }
}

export function normalizeStoryLibraryIndex(index: StoryLibraryIndex, now: string): StoryLibraryIndex {
    assertSupportedStoryLibraryIndex(index);
    const seen = new Set<string>();
    const sourceStories = Array.isArray(index.stories) ? index.stories : [];
    const stories = sourceStories.flatMap(entry => {
        if (!entry || typeof entry !== "object") {
            return [];
        }
        if (!isValidStoryId(entry.id) || seen.has(entry.id)) {
            return [];
        }
        seen.add(entry.id);
        return [{
            ...entry,
            documentPath: storyDocumentRelativePath(entry.id),
        }];
    });
    const defaultStoryId =
        index.defaultStoryId && stories.some(entry => entry.id === index.defaultStoryId)
            ? index.defaultStoryId
            : undefined;
    return {
        ...index,
        stories,
        defaultStoryId,
        meta: {
            ...index.meta,
            updatedAt: index.meta?.updatedAt ?? now,
        },
    };
}

export function normalizeStoryAnimationIndex(index: StoryAnimationIndex, now: string): StoryAnimationIndex {
    assertSupportedStoryAnimationIndex(index);
    const seen = new Set<string>();
    const sourceAnimations = Array.isArray(index.animations) ? index.animations : [];
    const animations = sourceAnimations.flatMap(entry => {
        if (!entry || typeof entry !== "object") {
            return [];
        }
        if (!isValidStoryEntityId(entry.id) || seen.has(entry.id)) {
            return [];
        }
        seen.add(entry.id);
        return [{
            ...entry,
            name: normalizeOptionalString(entry.name) ?? "Untitled Motion",
            targetKind: normalizeAnimationTargetKind(entry.targetKind),
            documentPath: storyAnimationDocumentRelativePath(entry.id),
            createdAt: entry.createdAt ?? now,
            updatedAt: entry.updatedAt ?? now,
        }];
    });
    return {
        ...index,
        animations,
        meta: {
            ...index.meta,
            updatedAt: index.meta?.updatedAt ?? now,
        },
    };
}

// ---------------------------------------------------------------------------
// Schema migration
// ---------------------------------------------------------------------------

/**
 * Re-exported rather than defined here: the ladder moved to `@shared/story/migrateStoryDocument`
 * so the main process can run it on a document it read off disk (see that module's note). This is
 * the import path the renderer has always used.
 */
export { migrateStoryDocumentToLatest };

export function normalizeStoryDocument(document: StoryDocument, now: string): StoryDocument {
    const migrated = migrateStoryDocumentToLatest(document);
    assertSupportedStoryDocument(migrated);
    assertValidStoryId(migrated.id);
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(migrated.scenes)) {
        const normalized = normalizeScene(scene);
        scenes[sceneId] = normalized;
    }
    const chapters = migrated.chapters.map(chapter => ({
        ...chapter,
        sceneIds: chapter.sceneIds.filter(sceneId => scenes[sceneId]),
    }));
    const entrySceneId = migrated.entrySceneId && scenes[migrated.entrySceneId]
        ? migrated.entrySceneId
        : firstSceneId(chapters);
    // The only writer of `unassignedSceneIds`. Recomputing here rather than having every chapter
    // mutation maintain it is the difference between a stale id that self-heals on the next load and
    // a missed call site that loses an order nothing can reconstruct. It is omitted when empty -
    // which is nearly every document - so a project that never had a chapter-less scene carries no
    // trace of the field and no diff line for it.
    const normalized: StoryDocument = { ...migrated, chapters, scenes, entrySceneId };
    const unassignedSceneIds = deriveUnassignedSceneIds(normalized);
    if (unassignedSceneIds.length > 0) {
        normalized.unassignedSceneIds = unassignedSceneIds;
    } else {
        delete normalized.unassignedSceneIds;
    }
    return {
        ...normalized,
        meta: {
            ...migrated.meta,
            updatedAt: migrated.meta?.updatedAt ?? now,
        },
    };
}

export function normalizeStoryAnimationAsset(asset: StoryAnimationAsset, now: string): StoryAnimationAsset {
    assertSupportedStoryAnimationAsset(asset);
    assertValidStoryEntityId(asset.id, "Story animation id");
    const sequences = normalizeAnimationSequences(asset.sequences);
    const normalizedSequences = sequences.length > 0 ? sequences : [createDefaultAnimationSequence(asset.id)];
    const config = {
        repeat: normalizeOptionalPositiveNumber(asset.config?.repeat),
        repeatDelayMs: normalizeOptionalNonNegativeNumber(asset.config?.repeatDelayMs),
    };
    return {
        ...asset,
        name: normalizeOptionalString(asset.name) ?? "Untitled Motion",
        targetKind: normalizeAnimationTargetKind(asset.targetKind),
        timeline: normalizeAnimationTimeline(asset.timeline, normalizedSequences, asset.id),
        sequences: normalizedSequences,
        config: Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)),
        previewAssetId: normalizeOptionalString(asset.previewAssetId),
        previewBackgroundAssetId: normalizeOptionalString(asset.previewBackgroundAssetId),
        meta: {
            ...asset.meta,
            updatedAt: asset.meta?.updatedAt ?? now,
        },
    };
}

export function createChapter(input: { id: string; name: string; now: string }): StoryChapter {
    assertValidStoryEntityId(input.id, "Story chapter id");
    return {
        id: input.id,
        name: input.name,
        sceneIds: [],
        meta: {
            createdAt: input.now,
            updatedAt: input.now,
        },
    };
}

export function createScene(input: { id: string; name: string; runtimeName: string; now: string }): StoryScene {
    assertValidStoryEntityId(input.id, "Story scene id");
    return {
        id: input.id,
        name: input.name,
        runtimeName: input.runtimeName,
        description: "",
        rootBlockIds: [],
        blocks: {},
        meta: {
            createdAt: input.now,
            updatedAt: input.now,
        },
    };
}

export function insertBlockInScene(
    scene: StoryScene,
    block: StoryBlock,
    target: { parentId: StoryBlockId | null; beforeBlockId?: StoryBlockId | null },
): void {
    if (block.kind === "jump" && block.childrenIds.length > 0) {
        throw new Error("Jump blocks cannot have children");
    }
    if (target.parentId && !canAcceptChildren(scene.blocks[target.parentId])) {
        throw new Error("Target parent cannot accept child blocks");
    }
    if (target.parentId && !scene.blocks[target.parentId]) {
        throw new Error("Target parent block not found");
    }
    if (scene.blocks[block.id]) {
        throw new Error(`Block already exists: ${block.id}`);
    }
    block.parentId = target.parentId;
    block.childrenIds = [];
    scene.blocks[block.id] = block;
    const siblings = target.parentId
        ? scene.blocks[target.parentId].childrenIds
        : scene.rootBlockIds;
    insertId(siblings, block.id, target.beforeBlockId ?? null);
}

export function updateBlockPayload(scene: StoryScene, blockId: StoryBlockId, nextPayload: StoryBlock["payload"]): void {
    const block = scene.blocks[blockId];
    if (!block) {
        throw new Error(`Block not found: ${blockId}`);
    }
    block.payload = preserveTextIds(block.payload, nextPayload) as StoryBlock["payload"];
}

export function deleteBlockFromScene(scene: StoryScene, blockId: StoryBlockId): void {
    const block = scene.blocks[blockId];
    if (!block) {
        return;
    }
    const ids = collectBlockSubtree(scene, blockId);
    const siblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
    if (siblings) {
        removeId(siblings, blockId);
    }
    for (const id of ids) {
        delete scene.blocks[id];
    }
}

function assertBlockMoveAllowed(
    scene: StoryScene,
    blockId: StoryBlockId,
    target: { parentId: StoryBlockId | null; beforeBlockId?: StoryBlockId | null },
): void {
    if (!scene.blocks[blockId]) {
        throw new Error(`Block not found: ${blockId}`);
    }
    if (target.parentId && !canAcceptChildren(scene.blocks[target.parentId])) {
        throw new Error("Target parent cannot accept child blocks");
    }
    if (target.parentId && collectBlockSubtree(scene, blockId).includes(target.parentId)) {
        throw new Error("Cannot move a block into its own subtree");
    }
}

export function moveBlockInScene(
    scene: StoryScene,
    blockId: StoryBlockId,
    target: { parentId: StoryBlockId | null; beforeBlockId?: StoryBlockId | null },
): void {
    assertBlockMoveAllowed(scene, blockId, target);
    const block = scene.blocks[blockId];
    const oldSiblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
    if (oldSiblings) {
        removeId(oldSiblings, blockId);
    }
    block.parentId = target.parentId;
    const nextSiblings = target.parentId ? scene.blocks[target.parentId].childrenIds : scene.rootBlockIds;
    insertId(nextSiblings, blockId, target.beforeBlockId ?? null);
}

/**
 * Move groups of blocks, each group to one target, in the order given — how a multi-row selection
 * travels. A drag is one group (everything lands in one place); a keyboard nudge is one group per run
 * of adjacent rows, since each run steps over its own neighbour and stays where it is in the scene.
 *
 * Within a group every block is inserted before the same anchor, so `[a, b, c]` land as `a b c` in
 * front of it (and appended in that order when the anchor is `null`). The caller owes us anchors that
 * are not themselves moving: {@link insertId} silently appends when it cannot find its anchor, which
 * would scatter a group to the end of the parent instead of failing.
 *
 * Validated whole before anything moves. A half-applied move would leave the document mutated with the
 * change event never emitted — the editor would be showing a scene that no longer exists.
 */
export function moveBlocksInScene(
    scene: StoryScene,
    moves: { blockIds: StoryBlockId[]; target: { parentId: StoryBlockId | null; beforeBlockId?: StoryBlockId | null } }[],
): void {
    for (const move of moves) {
        for (const blockId of move.blockIds) {
            assertBlockMoveAllowed(scene, blockId, move.target);
        }
    }
    for (const move of moves) {
        for (const blockId of move.blockIds) {
            moveBlockInScene(scene, blockId, move.target);
        }
    }
}

export function createTextId(generateId: StoryIdFactory): StoryTextId {
    const textId = generateId();
    assertValidStoryEntityId(textId, "Story text id");
    return textId;
}

export function canAcceptChildren(block: StoryBlock | undefined): boolean {
    if (!block) {
        return false;
    }
    if (block.kind === "control") {
        return true;
    }
    if (block.kind === "nodeAction") {
        return block.payload.action === "choice" || block.payload.action === "choiceOption";
    }
    return false;
}

function normalizeScene(scene: StoryScene): StoryScene {
    const blocks: Record<StoryBlockId, StoryBlock> = {};
    for (const [id, block] of Object.entries(scene.blocks)) {
        blocks[id] = {
            ...block,
            id,
            childrenIds: block.childrenIds.filter(childId => scene.blocks[childId]),
        } as StoryBlock;
    }
    const rootBlockIds = scene.rootBlockIds.filter(blockId => blocks[blockId]);
    for (const block of Object.values(blocks)) {
        if (block.parentId && !blocks[block.parentId]) {
            block.parentId = null;
            if (!rootBlockIds.includes(block.id)) {
                rootBlockIds.push(block.id);
            }
        }
        if (block.kind === "jump") {
            block.childrenIds = [];
        }
    }
    const bgm = normalizeSceneBgm(scene.bgm);
    return {
        ...scene,
        description: typeof scene.description === "string" ? scene.description : "",
        defaultBackgroundAssetId: normalizeOptionalString(scene.defaultBackgroundAssetId),
        ...(bgm ? { bgm } : { bgm: undefined }),
        rootBlockIds,
        blocks,
    };
}

/**
 * The scene's opening track. A record with no asset id names nothing playable, so it is dropped
 * rather than carried - which also means a cleared picker leaves no residue in the document.
 */
function normalizeSceneBgm(value: StoryScene["bgm"]): StoryScene["bgm"] {
    const assetId = normalizeOptionalString(value?.assetId);
    if (!value || !assetId) {
        return undefined;
    }
    const volume = typeof value.volume === "number" && Number.isFinite(value.volume)
        ? Math.min(1, Math.max(0, value.volume))
        : undefined;
    const fadeMs = normalizeOptionalNonNegativeNumber(value.fadeMs);
    const audioTrackId = normalizeOptionalString(value.audioTrackId);
    return {
        assetId,
        // Kept as authored even when no track of that id exists: a reference to a deleted track
        // resolves to its bus's built-in at compile time, and dropping the id here would silently
        // discard the author's choice the moment they deleted a track they meant to re-create.
        ...(audioTrackId !== undefined ? { audioTrackId } : {}),
        ...(volume !== undefined ? { volume } : {}),
        ...(typeof value.loop === "boolean" ? { loop: value.loop } : {}),
        ...(fadeMs !== undefined ? { fadeMs } : {}),
    };
}

function normalizeOptionalString(value: string | undefined): string | undefined {
    const trimmed = typeof value === "string" ? value.trim() : "";
    return trimmed || undefined;
}

function normalizeOptionalNonNegativeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function normalizeOptionalPositiveNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Unknown kinds fall back to `image`, which is also what a Studio older than the camera-motion
 * change does when it reads a `camera` asset — so this list is the one place a new motion target
 * kind has to be registered, and forgetting it silently reassigns the asset rather than failing.
 */
function normalizeAnimationTargetKind(value: unknown): StoryAnimationIndexEntry["targetKind"] {
    return value === "image" || value === "text" || value === "layer" || value === "character" || value === "camera"
        ? value
        : "image";
}

const DEFAULT_ANIMATION_DURATION_MS = 300;
const MAX_ANIMATION_DURATION_MS = 300_000;
const ANIMATION_TRACK_PROPERTIES: StoryAnimationTrackProperty[] = [
    "position",
    "opacity",
    "zoom",
    "scaleX",
    "scaleY",
    "rotation",
    "fontColor",
    "maskImage",
    "maskSize",
    "maskPosition",
    "maskRepeat",
    "maskMode",
    "clipPath",
    "filter",
    "backdropFilter",
    "mixBlendMode",
];
const NUMERIC_TRACK_PROPERTIES = new Set<StoryAnimationTrackProperty>(["opacity", "zoom", "scaleX", "scaleY", "rotation"]);
const STRING_TRACK_PROPERTIES = new Set<StoryAnimationTrackProperty>([
    "fontColor",
    "maskImage",
    "maskSize",
    "maskPosition",
    "maskRepeat",
    "maskMode",
    "clipPath",
    "filter",
    "backdropFilter",
    "mixBlendMode",
]);

function normalizeAnimationTimeline(
    timeline: StoryAnimationTimeline | undefined,
    fallbackSequences: StoryAnimationSequence[],
    animationId: string,
): StoryAnimationTimeline {
    const migrated = migrateAnimationSequencesToTimeline(fallbackSequences, animationId);
    if (!timeline || typeof timeline !== "object" || !Array.isArray(timeline.tracks)) {
        return migrated;
    }
    const tracks = timeline.tracks
        .map((track, index) => normalizeAnimationTrack(track, index))
        .filter((track): track is StoryAnimationTrack => Boolean(track));
    const durationMs = Math.min(MAX_ANIMATION_DURATION_MS, Math.max(
        DEFAULT_ANIMATION_DURATION_MS,
        normalizeOptionalNonNegativeNumber(timeline.durationMs) ?? 0,
        ...tracks.flatMap(track => track.keyframes.map(keyframe => keyframe.timeMs)),
    ));
    return {
        durationMs,
        tracks: tracks.length > 0 ? tracks : migrated.tracks,
    };
}

function normalizeAnimationTrack(track: StoryAnimationTrack | undefined, index: number): StoryAnimationTrack | null {
    if (!track || typeof track !== "object" || !isAnimationTrackProperty(track.property)) {
        return null;
    }
    const keyframesByTime = new Map<number, StoryAnimationKeyframe>();
    const sourceKeyframes = Array.isArray(track.keyframes) ? track.keyframes : [];
    for (let i = 0; i < sourceKeyframes.length; i += 1) {
        const keyframe = normalizeAnimationKeyframe(track.property, sourceKeyframes[i], i);
        if (keyframe) {
            keyframesByTime.set(keyframe.timeMs, keyframe);
        }
    }
    const keyframes = [...keyframesByTime.values()].sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id));
    if (keyframes.length === 0) {
        return null;
    }
    return {
        id: normalizeOptionalString(track.id) ?? `track-${track.property}-${index + 1}`,
        property: track.property,
        keyframes,
    };
}

function normalizeAnimationKeyframe(
    property: StoryAnimationTrackProperty,
    keyframe: StoryAnimationKeyframe | undefined,
    index: number,
): StoryAnimationKeyframe | null {
    if (!keyframe || typeof keyframe !== "object") {
        return null;
    }
    const value = normalizeAnimationKeyframeValue(property, keyframe.value);
    if (value === undefined) {
        return null;
    }
    const timeMs = clampAnimationTimeMs(normalizeOptionalNonNegativeNumber(keyframe.timeMs) ?? 0);
    return {
        id: normalizeOptionalString(keyframe.id) ?? `kf-${property}-${timeMs}-${index + 1}`,
        timeMs,
        value,
        easing: normalizeOptionalString(keyframe.easing),
    };
}

function clampAnimationTimeMs(timeMs: number): number {
    return Math.max(0, Math.min(MAX_ANIMATION_DURATION_MS, Math.round(timeMs)));
}

function normalizeAnimationKeyframeValue(property: StoryAnimationTrackProperty, value: unknown): StoryAnimationKeyframe["value"] | undefined {
    if (property === "position") {
        const props = normalizeTransformSequenceProps({ position: value as StoryTransformSequenceProps["position"] });
        return props.position;
    }
    if (NUMERIC_TRACK_PROPERTIES.has(property)) {
        return normalizeOptionalNumber(value);
    }
    if (STRING_TRACK_PROPERTIES.has(property)) {
        return normalizeOptionalString(typeof value === "string" ? value : undefined);
    }
    return undefined;
}

function isAnimationTrackProperty(value: unknown): value is StoryAnimationTrackProperty {
    return typeof value === "string" && ANIMATION_TRACK_PROPERTIES.includes(value as StoryAnimationTrackProperty);
}

function migrateAnimationSequencesToTimeline(sequences: StoryAnimationSequence[], animationId: string): StoryAnimationTimeline {
    const tracksByProperty = new Map<StoryAnimationTrackProperty, StoryAnimationKeyframe[]>();
    const spans = buildAnimationSequenceSpans(sequences);
    spans.forEach(({ sequence, endMs }, sequenceIndex) => {
        const props = normalizeTransformSequenceProps(sequence.props);
        for (const [property, value] of Object.entries(props) as [StoryAnimationTrackProperty, unknown][]) {
            if (!isAnimationTrackProperty(property)) {
                continue;
            }
            const normalizedValue = normalizeAnimationKeyframeValue(property, value);
            if (normalizedValue === undefined) {
                continue;
            }
            const keyframes = tracksByProperty.get(property) ?? [];
            const timeMs = clampAnimationTimeMs(endMs);
            keyframes.push({
                id: `kf-${property}-${timeMs}-${sequenceIndex + 1}`,
                timeMs,
                value: normalizedValue,
                easing: normalizeOptionalString(sequence.options?.easing),
            });
            tracksByProperty.set(property, keyframes);
        }
    });
    const tracks = [...tracksByProperty.entries()].map(([property, keyframes], index) => ({
        id: `track-${property}-${index + 1}`,
        property,
        keyframes: keyframes.sort((a, b) => a.timeMs - b.timeMs || a.id.localeCompare(b.id)),
    }));
    const durationMs = Math.min(MAX_ANIMATION_DURATION_MS, Math.max(DEFAULT_ANIMATION_DURATION_MS, ...spans.map(span => span.endMs)));
    return {
        durationMs: Math.round(durationMs),
        tracks: tracks.length > 0 ? tracks : createDefaultAnimationTimeline(animationId).tracks,
    };
}

function buildAnimationSequenceSpans(sequences: StoryAnimationSequence[]): {
    sequence: StoryAnimationSequence;
    startMs: number;
    durationMs: number;
    endMs: number;
}[] {
    let cursorMs = 0;
    return sequences.map(sequence => {
        const durationMs = sequence.options?.durationMs ?? DEFAULT_ANIMATION_DURATION_MS;
        const delayMs = sequence.options?.delayMs ?? 0;
        const at = sequence.options?.at;
        let startMs = cursorMs;
        if (typeof at === "number") {
            startMs = at;
        } else if (typeof at === "string") {
            startMs = cursorMs + Number(at);
        }
        startMs = Math.max(0, startMs + delayMs);
        const endMs = Math.max(startMs, startMs + durationMs);
        cursorMs = Math.max(cursorMs, endMs);
        return {
            sequence,
            startMs,
            durationMs,
            endMs,
        };
    });
}

function normalizeAnimationSequences(sequences: StoryAnimationSequence[] | undefined): StoryAnimationSequence[] {
    if (!Array.isArray(sequences)) {
        return [];
    }
    return sequences
        .map((sequence, index) => normalizeAnimationSequence(sequence, index))
        .filter((sequence): sequence is StoryAnimationSequence => Boolean(sequence));
}

function normalizeAnimationSequence(sequence: StoryAnimationSequence | undefined, index: number): StoryAnimationSequence | null {
    if (!sequence || typeof sequence !== "object") {
        return null;
    }
    const props = normalizeTransformSequenceProps(sequence.props);
    return {
        id: normalizeOptionalString(sequence.id) ?? `step-${index + 1}`,
        props,
        options: {
            durationMs: normalizeOptionalNonNegativeNumber(sequence.options?.durationMs),
            easing: normalizeOptionalString(sequence.options?.easing),
            delayMs: normalizeOptionalNonNegativeNumber(sequence.options?.delayMs),
            at: normalizeSequenceAt(sequence.options?.at),
        },
    };
}

function normalizeTransformSequenceProps(props: StoryTransformSequenceProps | undefined): StoryTransformSequenceProps {
    if (!props || typeof props !== "object") {
        return {};
    }
    const next: StoryTransformSequenceProps = {};
    if (props.position && typeof props.position === "object") {
        const position = {
            xalign: normalizeOptionalNumber(props.position.xalign),
            yalign: normalizeOptionalNumber(props.position.yalign),
            xoffset: normalizeOptionalNumber(props.position.xoffset),
            yoffset: normalizeOptionalNumber(props.position.yoffset),
        };
        if (Object.values(position).some(value => value !== undefined)) {
            next.position = position;
        }
    }
    assignOptionalNumber(next, "opacity", props.opacity);
    assignOptionalNumber(next, "zoom", props.zoom);
    assignOptionalNumber(next, "scaleX", props.scaleX);
    assignOptionalNumber(next, "scaleY", props.scaleY);
    assignOptionalNumber(next, "rotation", props.rotation);
    assignOptionalString(next, "fontColor", props.fontColor);
    assignOptionalString(next, "maskImage", props.maskImage);
    assignOptionalString(next, "maskSize", props.maskSize);
    assignOptionalString(next, "maskPosition", props.maskPosition);
    assignOptionalString(next, "maskRepeat", props.maskRepeat);
    assignOptionalString(next, "maskMode", props.maskMode);
    assignOptionalString(next, "clipPath", props.clipPath);
    assignOptionalString(next, "filter", props.filter);
    assignOptionalString(next, "backdropFilter", props.backdropFilter);
    assignOptionalString(next, "mixBlendMode", props.mixBlendMode);
    return next;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function assignOptionalNumber<K extends keyof StoryTransformSequenceProps>(
    target: StoryTransformSequenceProps,
    key: K,
    value: unknown,
): void {
    const normalized = normalizeOptionalNumber(value);
    if (normalized !== undefined) {
        (target as Record<string, unknown>)[key] = normalized;
    }
}

function assignOptionalString<K extends keyof StoryTransformSequenceProps>(
    target: StoryTransformSequenceProps,
    key: K,
    value: unknown,
): void {
    const normalized = normalizeOptionalString(typeof value === "string" ? value : undefined);
    if (normalized !== undefined) {
        (target as Record<string, unknown>)[key] = normalized;
    }
}

function normalizeSequenceAt(value: unknown): StoryAnimationSequenceOptions["at"] | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && /^[+-]\d+(\.\d+)?$/.test(value)) {
        return value as `+${number}` | `-${number}`;
    }
    return undefined;
}

function createDefaultAnimationSequence(id: string): StoryAnimationSequence {
    return {
        id: `${id}-step-1`,
        props: {
            opacity: 1,
        },
        options: {
            durationMs: 300,
            easing: "easeOut",
        },
    };
}

function createDefaultAnimationTimeline(id: string): StoryAnimationTimeline {
    return {
        durationMs: DEFAULT_ANIMATION_DURATION_MS,
        tracks: [
            {
                id: `${id}-track-opacity`,
                property: "opacity",
                keyframes: [
                    {
                        id: `${id}-opacity-${DEFAULT_ANIMATION_DURATION_MS}`,
                        timeMs: DEFAULT_ANIMATION_DURATION_MS,
                        value: 1,
                        easing: "easeOut",
                    },
                ],
            },
        ],
    };
}

function firstSceneId(chapters: StoryChapter[]): StorySceneId | undefined {
    for (const chapter of chapters) {
        if (chapter.sceneIds[0]) {
            return chapter.sceneIds[0];
        }
    }
    return undefined;
}

function insertId(ids: string[], id: string, beforeId: string | null): void {
    removeId(ids, id);
    if (!beforeId) {
        ids.push(id);
        return;
    }
    const index = ids.indexOf(beforeId);
    if (index === -1) {
        ids.push(id);
        return;
    }
    ids.splice(index, 0, id);
}

function removeId(ids: string[], id: string): void {
    const index = ids.indexOf(id);
    if (index !== -1) {
        ids.splice(index, 1);
    }
}

function collectBlockSubtree(scene: StoryScene, blockId: StoryBlockId): StoryBlockId[] {
    const ids: StoryBlockId[] = [];
    const visit = (id: StoryBlockId) => {
        if (ids.includes(id)) {
            return;
        }
        ids.push(id);
        scene.blocks[id]?.childrenIds.forEach(visit);
    };
    visit(blockId);
    return ids;
}

function preserveTextIds(previous: StoryBlock["payload"], next: StoryBlock["payload"]): StoryBlock["payload"] {
    if (isNodeTextPayload(previous) && isNodeTextPayload(next) && previous.action === next.action) {
        if ("text" in previous && "text" in next && isStoryTextSegment(previous.text) && isStoryTextSegment(next.text)) {
            return {
                ...next,
                text: {
                    ...next.text,
                    textId: previous.text.textId,
                },
            } as StoryBlock["payload"];
        }
        if ("prompt" in previous && "prompt" in next && isStoryTextSegment(previous.prompt) && isStoryTextSegment(next.prompt)) {
            return {
                ...next,
                prompt: {
                    ...next.prompt,
                    textId: previous.prompt.textId,
                },
            } as StoryBlock["payload"];
        }
    }
    if ("text" in previous && "text" in next && isStoryTextSegment(previous.text) && isStoryTextSegment(next.text)) {
        return {
            ...next,
            text: {
                ...next.text,
                textId: previous.text.textId,
            },
        } as StoryBlock["payload"];
    }
    return next;
}

function isNodeTextPayload(payload: StoryBlock["payload"]): payload is StoryNodeActionPayload {
    return "action" in payload;
}

function isStoryTextSegment(value: unknown): value is StoryTextSegment {
    return Boolean(value && typeof value === "object" && "textId" in value && "value" in value);
}

/** An unresolved command line, located well enough for the console to send the author to it. */
export type InvalidStoryBlockRef = {
    storyId: StoryId;
    storyName: string;
    sceneId: StorySceneId;
    sceneName: string;
    blockId: StoryBlockId;
    /** The line as the author typed it. */
    source: string;
};

/**
 * Find every unresolved command line in a story.
 *
 * Preview compiles around these (a half-typed command is a normal thing to have on screen while
 * writing), which is exactly why the build has to be the thing that refuses them - otherwise an
 * unfinished line ships, and the whole point of making it a distinct block kind is lost.
 */
/**
 * Whether a block is compiled out (schema v7): disabled itself, or nested inside a disabled ancestor.
 * A disabled container skips its whole subtree, so a child is effectively disabled when any ancestor
 * is. Ancestor-walk (bounded by a seen-set against a malformed cycle) rather than tree-descent, so it
 * suits callers that iterate the flat block map.
 */
export function isBlockDisabled(scene: StoryScene, block: StoryBlock): boolean {
    let current: StoryBlock | undefined = block;
    const seen = new Set<StoryBlockId>();
    while (current) {
        if (current.disabled) {
            return true;
        }
        if (!current.parentId || seen.has(current.id)) {
            break;
        }
        seen.add(current.id);
        current = scene.blocks[current.parentId];
    }
    return false;
}

export function collectInvalidBlocks(document: StoryDocument): InvalidStoryBlockRef[] {
    const found: InvalidStoryBlockRef[] = [];
    for (const scene of listScenesInDocumentOrder(document)) {
        for (const block of listSceneBlocksInDocumentOrder(scene)) {
            // A disabled invalid row (or one under a disabled container) is compiled out, so the build
            // does not gate on it — that is exactly what disabling a half-written line is for.
            if (block.kind === "invalid" && !isBlockDisabled(scene, block)) {
                found.push({
                    storyId: document.id,
                    storyName: document.name,
                    sceneId: scene.id,
                    sceneName: scene.name,
                    blockId: block.id,
                    source: block.payload.source,
                });
            }
        }
    }
    return found;
}

/** A speaker the author typed that no Studio character backs, and every line currently using it. */
export type TempSpeakerRef = {
    name: string;
    blockIds: StoryBlockId[];
};

/**
 * Every temp speaker alive in a story, in first-appearance order.
 *
 * "Alive" is derived, not stored: a temp speaker exists exactly as long as some line still uses it,
 * so deleting the last line that names one retires it. That is what lets the speaker picker offer
 * previously-used names back without keeping a registry that drifts from the document.
 *
 * `characterId` losing its character does NOT make a line a temp speaker - resolving that is the
 * caller's job, since only it knows which characters exist.
 */
export function collectTempSpeakers(document: StoryDocument): TempSpeakerRef[] {
    const byName = new Map<string, TempSpeakerRef>();
    // "First appearance" is a claim about the script, so both loops have to walk the declared order.
    // Read out of the records instead and the first line to name a speaker is whichever one the JSON
    // happened to hold first, which after a canonical write means whichever block has the lowest id.
    for (const scene of listScenesInDocumentOrder(document)) {
        for (const block of listSceneBlocksInDocumentOrder(scene)) {
            if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
                continue;
            }
            const name = block.payload.speakerName?.trim();
            if (!name || block.payload.characterId?.trim()) {
                continue;
            }
            const existing = byName.get(name);
            if (existing) {
                existing.blockIds.push(block.id);
            } else {
                byName.set(name, { name, blockIds: [block.id] });
            }
        }
    }
    return [...byName.values()];
}

/**
 * Bind every line spoken by a temp speaker to a real character, in place.
 *
 * `speakerName` is dropped rather than kept as a fallback: once the line has a character, the name
 * is the character's to own, and a stale copy here would silently win back if the character were
 * ever deleted. Returns the number of lines rebound.
 */
export function promoteTempSpeaker(document: StoryDocument, name: string, characterId: string): number {
    const target = name.trim();
    if (!target || !characterId.trim()) {
        return 0;
    }
    let rebound = 0;
    for (const scene of Object.values(document.scenes)) {
        for (const block of Object.values(scene.blocks)) {
            if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
                continue;
            }
            if (block.payload.speakerName?.trim() !== target || block.payload.characterId?.trim()) {
                continue;
            }
            const { speakerName: _dropped, ...rest } = block.payload;
            block.payload = { ...rest, characterId };
            rebound += 1;
        }
    }
    return rebound;
}
