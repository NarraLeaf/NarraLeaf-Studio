import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
    StoryAnimationAsset,
    StoryAnimationAssetId,
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
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
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
    now: string;
}): StoryAnimationAsset {
    assertValidStoryEntityId(input.id, "Story animation id");
    const sequences = input.sequences ?? [createDefaultAnimationSequence(input.id)];
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: input.id,
        name: input.name,
        targetKind: input.targetKind,
        timeline: normalizeAnimationTimeline(input.timeline, sequences, input.id),
        sequences,
        config: {},
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
        studioGlobals: {},
        gamePersistents: {},
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
    if (index.schemaVersion > STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new Error("Story animation index schema is newer than this Studio version");
    }
    if (index.schemaVersion !== STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new Error("Story animation index migration is not implemented");
    }
}

export function assertSupportedStoryAnimationAsset(asset: StoryAnimationAsset): void {
    if (asset.schemaVersion > STORY_DOCUMENT_SCHEMA_VERSION) {
        throw new Error("Story animation asset schema is newer than this Studio version");
    }
    if (asset.schemaVersion !== STORY_DOCUMENT_SCHEMA_VERSION) {
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

export function normalizeStoryDocument(document: StoryDocument, now: string): StoryDocument {
    assertSupportedStoryDocument(document);
    assertValidStoryId(document.id);
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        const normalized = normalizeScene(scene);
        scenes[sceneId] = normalized;
    }
    const chapters = document.chapters.map(chapter => ({
        ...chapter,
        sceneIds: chapter.sceneIds.filter(sceneId => scenes[sceneId]),
    }));
    const entrySceneId = document.entrySceneId && scenes[document.entrySceneId]
        ? document.entrySceneId
        : firstSceneId(chapters);
    return {
        ...document,
        chapters,
        scenes,
        entrySceneId,
        studioGlobals: document.studioGlobals ?? {},
        gamePersistents: document.gamePersistents ?? {},
        meta: {
            ...document.meta,
            updatedAt: document.meta?.updatedAt ?? now,
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
        localVariables: {},
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

export function moveBlockInScene(
    scene: StoryScene,
    blockId: StoryBlockId,
    target: { parentId: StoryBlockId | null; beforeBlockId?: StoryBlockId | null },
): void {
    const block = scene.blocks[blockId];
    if (!block) {
        throw new Error(`Block not found: ${blockId}`);
    }
    if (target.parentId && !canAcceptChildren(scene.blocks[target.parentId])) {
        throw new Error("Target parent cannot accept child blocks");
    }
    if (target.parentId && collectBlockSubtree(scene, blockId).includes(target.parentId)) {
        throw new Error("Cannot move a block into its own subtree");
    }
    const oldSiblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
    if (oldSiblings) {
        removeId(oldSiblings, blockId);
    }
    block.parentId = target.parentId;
    const nextSiblings = target.parentId ? scene.blocks[target.parentId].childrenIds : scene.rootBlockIds;
    insertId(nextSiblings, blockId, target.beforeBlockId ?? null);
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
    return {
        ...scene,
        description: typeof scene.description === "string" ? scene.description : "",
        defaultBackgroundAssetId: normalizeOptionalString(scene.defaultBackgroundAssetId),
        rootBlockIds,
        blocks,
        localVariables: scene.localVariables ?? {},
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

function normalizeAnimationTargetKind(value: unknown): StoryAnimationIndexEntry["targetKind"] {
    return value === "image" || value === "text" || value === "layer" || value === "character" ? value : "image";
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
