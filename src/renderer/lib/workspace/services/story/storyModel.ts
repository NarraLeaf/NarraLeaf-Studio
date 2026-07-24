import {
    STORY_ANIMATION_SCHEMA_VERSION,
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
    StoryConditionRef,
    StoryDeclarationBlock,
    StoryDocument,
    StoryId,
    StoryLayerRef,
    StoryLibraryEntry,
    StoryLibraryIndex,
    StoryLiteralValue,
    StoryNodeActionPayload,
    StoryPersistentDefinitionLegacy,
    StorySavedVariableDefinition,
    StoryScene,
    StorySceneId,
    StorySceneVariableDefinition,
    StoryTextId,
    StoryTextSegment,
    StoryTransformSequenceProps,
    StoryVariableDefinitionLegacy,
    StoryVariableRef,
    StoryVariableRefLegacy,
    StoryVariableValueType,
} from "@shared/types/story";
import { assertValidStoryEntityId, assertValidStoryId, isValidStoryEntityId, isValidStoryId } from "@shared/utils/storyId";
import type { StoryExpressionScope } from "@shared/utils/storyExpressionParser";
import { createStoryExpressionScope, parseStoryExpression } from "@shared/utils/storyExpressionParser";

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
// Schema migration (v1 → v2): typed variable system.
//   - localVariables (scene) → sceneVariables; gamePersistents → savedVariables (flattened);
//     studioGlobals dropped (downgraded to scene refs); free-text refs → typed refs by id.
// ---------------------------------------------------------------------------

type LegacyStoryDocumentFields = {
    studioGlobals?: Record<string, StoryVariableDefinitionLegacy>;
    gamePersistents?: Record<string, StoryPersistentDefinitionLegacy>;
};

type LegacyStorySceneFields = {
    localVariables?: Record<string, StoryVariableDefinitionLegacy>;
};

// v5 and earlier persisted the variable REGISTRIES these fields carry; v6 turned them into
// declaration rows. The migrations below read and write them through these casts only.
type LegacyRegistryDocumentFields = {
    savedVariables?: Record<string, StorySavedVariableDefinition>;
};

type LegacyRegistrySceneFields = {
    sceneVariables?: Record<string, StorySceneVariableDefinition>;
};

export function migrateStoryDocumentToLatest(document: StoryDocument): StoryDocument {
    const version = typeof document.schemaVersion === "number" ? document.schemaVersion : 1;
    if (version >= STORY_DOCUMENT_SCHEMA_VERSION) {
        return document;
    }
    let migrated = document;
    if (version < 2) {
        migrated = migrateStoryDocumentV1toV2(migrated);
    }
    if (version < 3) {
        migrated = migrateStoryDocumentV2toV3(migrated);
    }
    if (version < 5) {
        migrated = migrateStoryDocumentV4toV5(migrated);
    }
    if (version < 6) {
        migrated = migrateStoryDocumentV5toV6(migrated);
    }
    // v4 (the `invalid` block kind and dialogue's `speakerName`), v7 (the block-level `disabled`
    // flag) and v8 (the `event` rich-text run) are purely additive: an older document is already
    // valid at the new version, so there is no step for any of them - only the stamp (a v7 document
    // falls through every step above and is stamped v8).
    //
    // The stamp is unconditional, and has to be. Each migrator above ends by writing
    // STORY_DOCUMENT_SCHEMA_VERSION rather than the version it actually produces, so the ladder only
    // *looks* like it walks version by version: bumping the constant without adding a step left v3
    // documents falling through untouched and then failing assertSupportedStoryDocument, while the
    // v2 tests kept passing because V2toV3 stamps whatever the constant currently says. Landing the
    // stamp here means the next additive bump cannot reopen that hole.
    return { ...migrated, schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION };
}

function migrateStoryDocumentV1toV2(document: StoryDocument): StoryDocument {
    const legacyDoc = document as StoryDocument & LegacyStoryDocumentFields;
    const savedVariables: Record<string, StorySavedVariableDefinition> = {};

    // Flatten legacy gamePersistents (namespace bags) into flat saved variables.
    for (const persistent of Object.values(legacyDoc.gamePersistents ?? {})) {
        const namespace = typeof persistent?.namespace === "string" ? persistent.namespace : "";
        for (const [key, value] of Object.entries(persistent?.defaultContent ?? {})) {
            provisionSavedVariable(savedVariables, namespace, key, value);
        }
    }

    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        const sceneVariables = migrateLegacySceneVariables(scene);
        const blocks = migrateSceneBlockRefs(scene.blocks, sceneVariables, savedVariables);
        const cleanedScene = { ...scene, sceneVariables, blocks } as StoryScene & LegacyStorySceneFields & LegacyRegistrySceneFields;
        delete cleanedScene.localVariables;
        scenes[sceneId] = cleanedScene;
    }

    const migrated = {
        ...document,
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        scenes,
        savedVariables,
    } as StoryDocument & LegacyStoryDocumentFields & LegacyRegistryDocumentFields;
    delete migrated.studioGlobals;
    delete migrated.gamePersistents;
    return migrated;
}

// ---------------------------------------------------------------------------
// Schema migration (v4 → v5): parsed expression conditions.
//   `{ kind: "expression", source }` held raw text that nothing could evaluate - the compiler
//   returned a constant false and the inspector showed a "not supported" banner. v5 parses that
//   source into a StoryExpression against the document's own declared variables, so conditions an
//   author wrote years ago start working. Source that no longer parses (or names a variable that
//   has since been deleted) becomes an `invalid` tree: it still evaluates false, exactly as before,
//   but now says so in the row rather than looking like a condition that simply never matched.
// ---------------------------------------------------------------------------

type LegacyExpressionConditionFields = { source?: string };

function migrateStoryDocumentV4toV5(document: StoryDocument): StoryDocument {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        const scope = createStoryExpressionScope(listStoryVariableEntries(document, scene));
        const blocks: Record<StoryBlockId, StoryBlock> = {};
        for (const [blockId, block] of Object.entries(scene.blocks)) {
            blocks[blockId] = migrateBlockExpressionCondition(block, scope);
        }
        scenes[sceneId] = { ...scene, blocks };
    }
    return { ...document, schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION, scenes };
}

function migrateBlockExpressionCondition(block: StoryBlock, scope: StoryExpressionScope): StoryBlock {
    if (block.kind !== "control" || block.payload.control !== "conditionBranch") {
        return block;
    }
    const condition = block.payload.condition as (StoryConditionRef & LegacyExpressionConditionFields) | undefined;
    if (condition?.kind !== "expression" || typeof condition.source !== "string") {
        return block;
    }
    const { expression } = parseStoryExpression(condition.source, scope);
    return { ...block, payload: { ...block.payload, condition: { kind: "expression", expression } } };
}

/**
 * Every variable an expression in this scene may name, as the scope chain sees them. Persistent
 * variables are declared in the blueprint document, which migration has no handle on - a v4
 * expression naming one becomes `invalid` rather than silently binding to the wrong scope.
 */
function listStoryVariableEntries(document: StoryDocument, scene: StoryScene): { name: string; ref: StoryVariableRef }[] {
    const legacyScene = scene as StoryScene & LegacyRegistrySceneFields;
    const legacyDoc = document as StoryDocument & LegacyRegistryDocumentFields;
    return [
        ...Object.values(legacyScene.sceneVariables ?? {}).map(def => ({
            name: def.name,
            ref: { scope: "scene", variableId: def.id } as StoryVariableRef,
        })),
        ...Object.values(legacyDoc.savedVariables ?? {}).map(def => ({
            name: def.name,
            ref: { scope: "saved", variableId: def.id } as StoryVariableRef,
        })),
    ];
}

// ---------------------------------------------------------------------------
// Schema migration (v5 → v6): variable declarations become rows.
//   The persisted registries turn into `declaration` blocks - one row per variable, prepended to
//   its owning scene (saved variables land at the top of the entry scene). The block id TAKES OVER
//   the old variableId, so every stored ref keeps resolving; deleting the row now deletes the
//   variable, which also makes registry entries that had lost their authoring surface (the
//   "cannot delete an old variable" complaint) visible and deletable again.
// ---------------------------------------------------------------------------

function migrateStoryDocumentV5toV6(document: StoryDocument): StoryDocument {
    const legacyDoc = document as StoryDocument & LegacyRegistryDocumentFields;
    const sceneIds = Object.keys(document.scenes);
    const homeSceneId = document.entrySceneId && document.scenes[document.entrySceneId] ? document.entrySceneId : sceneIds[0];
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        const legacyScene = scene as StoryScene & LegacyRegistrySceneFields;
        const rows: StoryDeclarationBlock[] = Object.values(legacyScene.sceneVariables ?? {})
            .map(def => declarationRowFromDef("scene", def));
        if (sceneId === homeSceneId) {
            rows.push(...Object.values(legacyDoc.savedVariables ?? {}).map(def => declarationRowFromDef("saved", def)));
        }
        const cleaned = { ...legacyScene };
        delete cleaned.sceneVariables;
        scenes[sceneId] = {
            ...cleaned,
            blocks: { ...scene.blocks, ...Object.fromEntries(rows.map(row => [row.id, row])) },
            rootBlockIds: [...rows.map(row => row.id), ...scene.rootBlockIds],
        };
    }
    const migrated = { ...document, schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION, scenes } as StoryDocument & LegacyRegistryDocumentFields;
    delete migrated.savedVariables;
    return migrated;
}

function declarationRowFromDef(scope: "scene" | "saved", def: StorySceneVariableDefinition | StorySavedVariableDefinition): StoryDeclarationBlock {
    return {
        // The old variableId becomes the block id - refs point at it and must keep resolving.
        id: def.id,
        kind: "declaration",
        parentId: null,
        childrenIds: [],
        payload: {
            scope,
            name: def.name,
            valueType: def.valueType,
            defaultValue: def.defaultValue,
            storageKey: def.storageKey || def.id,
        },
    };
}

// ---------------------------------------------------------------------------
// Schema migration (v2 → v3): stable layer references.
//   image/text actions used to bind a render layer by free-text `layerName`. That becomes a
//   StoryLayerRef bound to the stable id of the matching `layer` create block; when no block
//   matches, the last-known name is kept so the compiler's name fallback still renders it.
// ---------------------------------------------------------------------------

type LegacyLayerNameFields = { layerName?: string };

function migrateStoryDocumentV2toV3(document: StoryDocument): StoryDocument {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        const layerBlockIdsByName = collectLayerBlockIdsByName(scene);
        const blocks: Record<StoryBlockId, StoryBlock> = {};
        for (const [blockId, block] of Object.entries(scene.blocks)) {
            blocks[blockId] = migrateBlockLayerRef(block, layerBlockIdsByName);
        }
        scenes[sceneId] = { ...scene, blocks };
    }
    return { ...document, schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION, scenes };
}

function collectLayerBlockIdsByName(scene: StoryScene): Map<string, StoryBlockId> {
    const byName = new Map<string, StoryBlockId>();
    for (const [blockId, block] of Object.entries(scene.blocks)) {
        if (block.kind === "action" && block.payload.action === "layer") {
            const key = block.payload.objectName.trim().toLowerCase();
            if (key && !byName.has(key)) {
                byName.set(key, blockId);
            }
        }
    }
    return byName;
}

function migrateBlockLayerRef(block: StoryBlock, layerBlockIdsByName: Map<string, StoryBlockId>): StoryBlock {
    if (block.kind !== "action" || (block.payload.action !== "image" && block.payload.action !== "text")) {
        return block;
    }
    const legacy = block.payload as typeof block.payload & LegacyLayerNameFields;
    if (typeof legacy.layerName !== "string") {
        return block;
    }
    const name = legacy.layerName.trim();
    const nextPayload = { ...legacy };
    delete nextPayload.layerName;
    if (name) {
        const sourceBlockId = layerBlockIdsByName.get(name.toLowerCase());
        nextPayload.layer = sourceBlockId ? { kind: "custom", sourceBlockId, name } : { kind: "custom", name };
    }
    return { ...block, payload: nextPayload } as StoryBlock;
}

function migrateLegacySceneVariables(scene: StoryScene): Record<string, StorySceneVariableDefinition> {
    const legacyScene = scene as StoryScene & LegacyStorySceneFields;
    const result: Record<string, StorySceneVariableDefinition> = {};
    for (const legacy of Object.values(legacyScene.localVariables ?? {})) {
        if (!legacy || typeof legacy.id !== "string") continue;
        result[legacy.id] = {
            id: legacy.id,
            name: typeof legacy.name === "string" && legacy.name.length > 0 ? legacy.name : legacy.id,
            valueType: legacy.valueType ?? "string",
            defaultValue: legacy.defaultValue,
            storageKey: legacy.id,
            meta: legacy.meta,
        };
    }
    return result;
}

function migrateSceneBlockRefs(
    blocks: Record<StoryBlockId, StoryBlock>,
    sceneVariables: Record<string, StorySceneVariableDefinition>,
    savedVariables: Record<string, StorySavedVariableDefinition>,
): Record<StoryBlockId, StoryBlock> {
    const result: Record<StoryBlockId, StoryBlock> = {};
    for (const [blockId, block] of Object.entries(blocks)) {
        result[blockId] = migrateBlockRefs(block, sceneVariables, savedVariables);
    }
    return result;
}

function migrateBlockRefs(
    block: StoryBlock,
    sceneVariables: Record<string, StorySceneVariableDefinition>,
    savedVariables: Record<string, StorySavedVariableDefinition>,
): StoryBlock {
    if (block.kind === "action" && block.payload.action === "setVariable") {
        const target = migrateLegacyVariableRef(block.payload.target, sceneVariables, savedVariables);
        return { ...block, payload: { ...block.payload, target } };
    }
    if (block.kind === "control" && block.payload.control === "conditionBranch") {
        const condition = migrateConditionRef(block.payload.condition, sceneVariables, savedVariables);
        return { ...block, payload: { ...block.payload, condition } };
    }
    if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
        return {
            ...block,
            payload: {
                ...block.payload,
                hiddenWhen: migrateConditionRef(block.payload.hiddenWhen, sceneVariables, savedVariables),
                disabledWhen: migrateConditionRef(block.payload.disabledWhen, sceneVariables, savedVariables),
            },
        };
    }
    return block;
}

function migrateConditionRef(
    condition: StoryConditionRef | undefined,
    sceneVariables: Record<string, StorySceneVariableDefinition>,
    savedVariables: Record<string, StorySavedVariableDefinition>,
): StoryConditionRef | undefined {
    if (!condition || condition.kind !== "variable") {
        return condition;
    }
    return { ...condition, target: migrateLegacyVariableRef(condition.target, sceneVariables, savedVariables) };
}

function migrateLegacyVariableRef(
    ref: StoryVariableRef,
    sceneVariables: Record<string, StorySceneVariableDefinition>,
    savedVariables: Record<string, StorySavedVariableDefinition>,
): StoryVariableRef {
    // Already a v2 ref (defensive): leave untouched.
    if (ref && ("variableId" in ref || "storageKey" in ref)) {
        return ref;
    }
    const legacy = ref as unknown as StoryVariableRefLegacy;
    const key = typeof legacy?.key === "string" ? legacy.key : "";
    if (legacy?.scope === "gamePersistent") {
        return { scope: "saved", variableId: provisionSavedVariable(savedVariables, legacy.namespace ?? "", key) };
    }
    // sceneLocal, studioGlobal (downgraded), or anything else → scene.
    return { scope: "scene", variableId: provisionSceneVariable(sceneVariables, key) };
}

function provisionSceneVariable(
    sceneVariables: Record<string, StorySceneVariableDefinition>,
    name: string,
    defaultValue?: StoryLiteralValue,
): string {
    const existing = findVariableByName(sceneVariables, name);
    if (existing) {
        return existing;
    }
    const id = uniqueVariableId("svar", name, sceneVariables);
    sceneVariables[id] = { id, name, valueType: inferStoryValueType(defaultValue), defaultValue, storageKey: id };
    return id;
}

function provisionSavedVariable(
    savedVariables: Record<string, StorySavedVariableDefinition>,
    namespace: string,
    key: string,
    defaultValue?: StoryLiteralValue,
): string {
    const name = namespace && namespace !== "default" ? `${namespace}.${key}` : key;
    const existing = findVariableByName(savedVariables, name);
    if (existing) {
        return existing;
    }
    const id = uniqueVariableId("saved", name, savedVariables);
    savedVariables[id] = { id, name, valueType: inferStoryValueType(defaultValue), defaultValue, storageKey: id };
    return id;
}

function findVariableByName(record: Record<string, { name: string }>, name: string): string | undefined {
    for (const [id, def] of Object.entries(record)) {
        if (def.name === name) {
            return id;
        }
    }
    return undefined;
}

function uniqueVariableId(prefix: string, name: string, taken: Record<string, unknown>): string {
    const slug = name.trim().replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "var";
    const base = `${prefix}_${slug}`;
    if (!(base in taken)) {
        return base;
    }
    let index = 2;
    while (`${base}_${index}` in taken) {
        index += 1;
    }
    return `${base}_${index}`;
}

function inferStoryValueType(value: unknown): StoryVariableValueType {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    if (typeof value === "string") return "string";
    return "json";
}

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
    return {
        ...migrated,
        chapters,
        scenes,
        entrySceneId,
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
    for (const scene of Object.values(document.scenes)) {
        for (const block of Object.values(scene.blocks)) {
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
    for (const scene of Object.values(document.scenes)) {
        for (const block of Object.values(scene.blocks)) {
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
