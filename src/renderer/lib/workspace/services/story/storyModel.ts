import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    STORY_LIBRARY_INDEX_SCHEMA_VERSION,
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
} from "@shared/types/story";
import { assertValidStoryEntityId, assertValidStoryId, isValidStoryId } from "@shared/utils/storyId";

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
        rootBlockIds,
        blocks,
        localVariables: scene.localVariables ?? {},
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
