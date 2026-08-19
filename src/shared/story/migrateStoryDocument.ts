/**
 * The story document's schema ladder: every step from v1 up to the current version.
 *
 * **It lives in `@shared` because the main process migrates too.** The Dev Mode and build pipelines
 * read `storydoc.json` straight off disk and hand it to the story compiler, which runs inside the
 * shipped game - so a document that reaches them at an older version is compiled at that version,
 * and whatever the current compiler cannot read is simply absent from what plays.
 *
 * That went unnoticed until v19, because the ladder's earlier steps rewrite payloads the compiler
 * still recognised in their old shape. v19 does not: a camera row is `operation: "transform"` plus a
 * `StoryTransformRef` now, and an unmigrated one carries neither - so it compiles to no statement at
 * all, with no diagnostic, and a `look` grade never reaches the stage.
 *
 * Re-exported from `services/story/storyModel`, which is the path the renderer's services and their
 * tests have always imported it from. Same move `characterStoreModel` made, for the same reason.
 */

import {
    deriveUnassignedSceneIds,
    STORY_DOCUMENT_SCHEMA_VERSION,
    StoryBlock,
    StoryBlockId,
    StoryConditionRef,
    StoryDeclarationBlock,
    StoryDocument,
    StoryLayerRef,
    StoryLiteralValue,
    StoryPersistentDefinitionLegacy,
    StorySavedVariableDefinition,
    StoryScene,
    StorySceneId,
    StorySceneVariableDefinition,
    StoryVariableDefinitionLegacy,
    StoryVariableRef,
    StoryVariableRefLegacy,
    StoryVariableValueType,
} from "@shared/types/story";
import { legacyPoseId } from "@shared/characters/characterStoreModel";
import { expandLegacyDisplayableEffect, migrateLegacyTransformRef } from "@shared/story/transformLegacy";
import type { StoryExpressionScope } from "@shared/utils/storyExpressionParser";
import { createStoryExpressionScope, parseStoryExpression } from "@shared/utils/storyExpressionParser";

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
    if (version < 9) {
        migrated = migrateStoryDocumentV8toV9(migrated);
    }
    if (version < 10) {
        migrated = migrateStoryDocumentV9toV10(migrated);
    }
    if (version < 12) {
        migrated = migrateStoryDocumentV11toV12(migrated);
    }
    if (version < 13) {
        migrated = migrateStoryDocumentV12toV13(migrated);
    }
    if (version < 18) {
        migrated = migrateStoryDocumentV17toV18(migrated);
    }
    if (version < 19) {
        migrated = migrateStoryDocumentV18toV19(migrated);
    }
    // v4 (the `invalid` block kind and dialogue's `speakerName`), v7 (the block-level `disabled`
    // flag), v8 (the `event` rich-text run), v11 (a withdrawn marker block - see the version
    // history in document.ts), v14 (the expression language's `array`/`index` nodes), v15 (its
    // `visited`/`invoke` nodes), v16 (its `AppTag` constant) and v17 (the `{action:"plugin"}` marker
    // block's return) are purely additive: an older document is already valid at the new version - it
    // cannot contain a node that did not exist to be written - so there is no step for any of them,
    // only the stamp (a v7 document falls through every step above and is stamped v17). v17 is
    // additive in one direction more than the others: a v11 document CAN contain the block, since v11
    // is where it first appeared, and it carries the identical shape - so the stamp is a complete
    // migration for that case too. v9 (M-VAR, the persistent `StoryVariableRef` rename),
    // v10 (the character appearance rework - `formName`/`variants` become `pose`/`tags`), v12
    // (the explicit order of chapter-less scenes), v13 (the `code` block kind's removal), v18 (the
    // two closed transform enums becoming one prop bag) and v19 (the camera's six operations becoming
    // that same bag, and the screen effects becoming lens props on it) are NOT additive, so each has
    // a real step.
    //
    // The stamp is unconditional, and has to be. Each migrator above ends by writing
    // STORY_DOCUMENT_SCHEMA_VERSION rather than the version it actually produces, so the ladder only
    // *looks* like it walks version by version: bumping the constant without adding a step left v3
    // documents falling through untouched and then failing assertSupportedStoryDocument, while the
    // v2 tests kept passing because V2toV3 stamps whatever the constant currently says. Landing the
    // stamp here means the next additive bump cannot reopen that hole.
    return { ...migrated, schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION };
}

/**
 * v18→v19: the camera takes the whole prop bag, and the screen effects become part of it.
 *
 * Every one of the camera's six operations has a determinate expansion - the same expansion the
 * compiler was already computing on the fly, which is why none of them needs judgement here. `darken`
 * is the clearest case: `Camera.darken(d)` IS `filter("brightness(1 - d)")` in the engine, so the bag
 * writes the brightness the compile emitted for it anyway.
 *
 * `reset` is copied through unchanged rather than expanded into a bag of neutral values, and that is a
 * decision rather than laziness. It compiles to `camera.resetCamera()`, a separate engine primitive
 * whose 0.29.0 release drops the filter in a zero-duration sequence and eases only the pose; a
 * hand-built neutral bag would put the two back in one transform and walk the picture through the
 * colour wheel on the way out of a grade.
 *
 * A `screenEffect` row becomes a camera row carrying the lens gesture it was, with every number it
 * stated kept as an override - the row said "blink for 0.4s in black" and the migrated row says the
 * same thing to a different instrument. Dropping them instead would be silent data loss on a save the
 * author did not ask for, and converting them to notes (the v13 answer for `code`) would be wrong
 * here because these rows DID play: there is a thing on the other side to become.
 */
function migrateStoryDocumentV18toV19(document: StoryDocument): StoryDocument {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes ?? {})) {
        const blocks: Record<StoryBlockId, StoryBlock> = {};
        for (const [blockId, block] of Object.entries(scene.blocks ?? {})) {
            blocks[blockId] = migrateCameraBlock(block);
        }
        scenes[sceneId] = { ...scene, blocks };
    }
    return { ...document, scenes };
}

/** Lower bound on camera zoom, restated from the compiler: 0 or negative is not a shot. */
const LEGACY_MIN_CAMERA_ZOOM = 0.05;

function clamp01(value: unknown): number {
    const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
    return Math.min(1, Math.max(0, amount));
}

function numberOr(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function migrateCameraBlock(block: StoryBlock): StoryBlock {
    if (block.kind !== "action") {
        return block;
    }
    const payload = block.payload as Record<string, unknown>;
    if (payload.action === "screenEffect") {
        return { ...block, payload: expandLegacyScreenEffect(payload) } as StoryBlock;
    }
    if (payload.action !== "camera") {
        return block;
    }
    const operation = String(payload.operation);
    if (operation === "reset") {
        return block;
    }
    if (operation === "motion") {
        // Already a ref, and already in animation mode - the shot moves from its own field onto the
        // one every other subject's shot has always used.
        const transform = payload.motion && typeof payload.motion === "object" ? payload.motion : { mode: "animation" };
        return { ...block, payload: { action: "camera", operation: "transform", transform } } as StoryBlock;
    }
    const to = expandLegacyCameraOperation(operation, payload);
    const transform: Record<string, unknown> = {
        mode: "props",
        ...(Object.keys(to).length > 0 ? { to } : {}),
        ...(typeof payload.durationMs === "number" ? { durationMs: payload.durationMs } : {}),
        ...(typeof payload.easing === "string" ? { easing: payload.easing } : {}),
    };
    return { ...block, payload: { action: "camera", operation: "transform", transform } } as StoryBlock;
}

/** The five settled camera operations, as the props each one always stood for. */
function expandLegacyCameraOperation(operation: string, payload: Record<string, unknown>): Record<string, unknown> {
    const position = (payload.position ?? {}) as Record<string, unknown>;
    switch (operation) {
        case "pan":
            return {
                position: {
                    xalign: numberOr(position.xalign, 0.5),
                    yalign: numberOr(position.yalign, 0.5),
                    ...(position.xoffset !== undefined ? { xoffset: position.xoffset } : {}),
                    ...(position.yoffset !== undefined ? { yoffset: position.yoffset } : {}),
                },
            };
        case "zoom":
            return { zoom: Math.max(LEGACY_MIN_CAMERA_ZOOM, numberOr(payload.zoom, 1)) };
        case "rotate":
            return { rotation: numberOr(payload.rotation, 0) };
        case "darken":
            return { filter: { brightness: 1 - clamp01(payload.darkness) } };
        case "look": {
            const filter = typeof payload.filter === "string" ? payload.filter.trim() : "";
            const preset = typeof payload.lookPreset === "string" ? payload.lookPreset : undefined;
            return {
                // A hand-written chain OVERRODE the preset at compile time, and both are kept for the
                // same reason: the escape hatch stays the escape hatch, and the name stays readable.
                ...(preset ? { look: { preset, ...(payload.lookIntensity !== undefined ? { intensity: payload.lookIntensity } : {}) } } : {}),
                ...(filter ? { filterRaw: filter } : {}),
            };
        }
        default:
            return {};
    }
}

/**
 * A `screenEffect` row as the camera lens gesture it was.
 *
 * `durationMs` was the WHOLE move, with `inMs` / `outMs` overriding one half each - so an absent half
 * falls back to it, which is exactly what the compile did.
 */
function expandLegacyScreenEffect(payload: Record<string, unknown>): Record<string, unknown> {
    const whole = typeof payload.durationMs === "number" ? payload.durationMs : undefined;
    const half = (value: unknown): number | undefined => (typeof value === "number" ? value : whole);
    const lens: Record<string, unknown> = {
        preset: payload.effect === "vignette" ? "vignettePulse" : "blink",
        ...(half(payload.inMs) !== undefined ? { inMs: half(payload.inMs) } : {}),
        ...(half(payload.outMs) !== undefined ? { outMs: half(payload.outMs) } : {}),
        ...(typeof payload.holdMs === "number" ? { holdMs: payload.holdMs } : {}),
        ...(typeof payload.easing === "string" ? { easing: payload.easing } : {}),
        ...(typeof payload.color === "string" ? { color: payload.color } : {}),
        ...(typeof payload.opacity === "number" ? { amount: payload.opacity } : {}),
        ...(typeof payload.inner === "number" ? { inner: payload.inner } : {}),
        ...(typeof payload.outer === "number" ? { outer: payload.outer } : {}),
    };
    return { action: "camera", operation: "transform", transform: { mode: "props", to: { lens } } };
}

/**
 * v17→v18: the two closed enums become the one prop bag.
 *
 * Every `StoryTransformPreset` expands into the props it always stood for, and every `displayable`
 * effect operation into the prop it set. Both tables live in `@shared/story/transformLegacy` because
 * the compiler's own tests build documents at the old shape and the runtime bundle cannot import from
 * here; this step is the walk, not the arithmetic.
 *
 * It is written as a whole-tree walk rather than a per-payload switch for the same reason
 * `migrateCharacterFormsToPose` was: a transform ref hangs off eight different payloads (`image`,
 * `text`, `layer`, `character`, `displayable`, the NVL panel's `transition`, the camera's `motion`) and
 * a switch that missed one would leave a preset behind that nothing can read any more. The walk is
 * idempotent: a ref already carrying `to` is returned untouched.
 */
function migrateStoryDocumentV17toV18(document: StoryDocument): StoryDocument {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes ?? {})) {
        const blocks: Record<StoryBlockId, StoryBlock> = {};
        for (const [blockId, block] of Object.entries(scene.blocks ?? {})) {
            blocks[blockId] = migrateTransformBlock(block);
        }
        scenes[sceneId] = { ...scene, blocks };
    }
    return { ...document, scenes };
}

/** The legacy `displayable` payload's twelve effect operations, as they survive only on disk. */
const LEGACY_EFFECT_OPERATIONS = new Set([
    "mask", "clearMask", "clip", "clearClip", "filter", "clearFilter",
    "backdrop", "blend", "darken", "circleReveal", "circleClose", "wipe",
]);

function migrateTransformBlock(block: StoryBlock): StoryBlock {
    if (block.kind !== "action") {
        return block;
    }
    const payload = block.payload as Record<string, unknown>;
    let next = payload;
    if (payload.action === "displayable" && LEGACY_EFFECT_OPERATIONS.has(String(payload.operation))) {
        const { to, clipReveal } = expandLegacyDisplayableEffect(String(payload.operation), payload);
        const transform = {
            mode: "props" as const,
            ...(Object.keys(to).length > 0 ? { to } : {}),
            ...(clipReveal ? { clipReveal } : {}),
            ...(typeof payload.durationMs === "number" ? { durationMs: payload.durationMs } : {}),
            ...(typeof payload.easing === "string" ? { easing: payload.easing } : {}),
        };
        next = { ...payload, operation: "transform", transform };
        for (const dropped of ["maskAssetId", "clipPath", "filter", "backdropFilter", "mixBlendMode", "darkness", "effectProps", "durationMs", "easing"]) {
            delete (next as Record<string, unknown>)[dropped];
        }
    }
    // The `transform` / `transition` / `motion` refs, wherever they hang.
    const migrated = { ...next };
    for (const key of ["transform", "transition", "motion"]) {
        if (migrated[key] && typeof migrated[key] === "object") {
            migrated[key] = migrateLegacyTransformRef(migrated[key]);
        }
    }
    return { ...block, payload: migrated } as StoryBlock;
}

/**
 * v12→v13: the `code` block kind is gone; every one of its rows becomes a `note` carrying the source.
 *
 * The source is copied byte for byte, at the end of the note, after one header line naming the
 * language the row declared. Nothing about the block ever ran - the compiler skipped it with a
 * warning - so there is no behaviour to preserve; what there IS is text an author typed, sometimes
 * real code, and deleting the row would be silent data loss on a save the author did not ask for.
 * A note is the only kind that stores arbitrary prose and compiles to nothing, which is what a code
 * block already was in practice.
 *
 * The `textId` is derived from the block id rather than generated, for two reasons: this function has
 * no id service (it runs on a parsed object, off any React tree), and a derived id makes the step
 * idempotent - running it twice cannot mint a second translation unit for the same row.
 */
function migrateStoryDocumentV12toV13(document: StoryDocument): StoryDocument {
    const scenes: Record<StorySceneId, StoryScene> = {};
    for (const [sceneId, scene] of Object.entries(document.scenes ?? {})) {
        const blocks: Record<StoryBlockId, StoryBlock> = {};
        for (const [blockId, block] of Object.entries(scene.blocks ?? {})) {
            blocks[blockId] = migrateCodeBlockToNote(block);
        }
        scenes[sceneId] = { ...scene, blocks };
    }
    return { ...document, scenes };
}

/** The legacy `code` payload, as it survives only in documents on disk. */
type LegacyCodePayload = {
    language?: unknown;
    source?: unknown;
};

function migrateCodeBlockToNote(block: StoryBlock): StoryBlock {
    if ((block.kind as string) !== "code") {
        return block;
    }
    const payload = block.payload as LegacyCodePayload;
    const source = typeof payload.source === "string" ? payload.source : "";
    const language = typeof payload.language === "string" && payload.language.trim() ? payload.language.trim() : "narraleaf";
    // Header first, source last and untouched: `endsWith(source)` is the property the migration test
    // pins, so a future edit to the header cannot start reformatting what the author wrote.
    const value = `[code block (${language}), no longer supported]\n${source}`;
    return {
        id: block.id,
        kind: "note",
        parentId: block.parentId,
        childrenIds: block.childrenIds,
        ...(block.disabled ? { disabled: block.disabled } : {}),
        payload: { text: { textId: `code_${block.id}`, role: "note", value } },
    };
}

/**
 * v11→v12: the order of the scenes no chapter claims becomes `unassignedSceneIds`.
 *
 * This step exists for one moment and cannot be deferred. `chapters[].sceneIds` orders scenes inside
 * a chapter; an unclaimed scene's only position was its slot in the `scenes` record, and `JSON.parse`
 * hands that back in the file's key order - which is the order the author arranged. The canonical
 * serializer this milestone adopts sorts keys, so the FIRST canonical write of a v11 document
 * destroys that order permanently. Reading it here, on the object as parsed and before anything has
 * rebuilt the record, is the only chance to capture it.
 *
 * Two caveats worth stating rather than papering over. Integer-like keys (`"0"`, `"12"`) are
 * reordered ahead of string keys by the engine itself, so a document carrying them lost its order
 * before this ran - scene ids are UUID v4, so Studio never produces one, but a hand-written document
 * could. And a document already canonically written by some path that skipped this ladder is past
 * saving too; that is why the step is gated on the version and not on the field being absent.
 *
 * Idempotent by construction: `deriveUnassignedSceneIds` leads with whatever the document already
 * declares and only falls back to key order for scenes it never mentioned, so running it on a
 * migrated document reproduces the same array.
 */
function migrateStoryDocumentV11toV12(document: StoryDocument): StoryDocument {
    const unassignedSceneIds = deriveUnassignedSceneIds(document);
    if (unassignedSceneIds.length === 0) {
        return document;
    }
    return { ...document, unassignedSceneIds };
}

/**
 * v9→v10: a character no longer has forms, so `formName` + `variants` become `pose`.
 *
 * The pose id is *derived* from the old `(formName, variantName)` pair by the same function the
 * character-store migration used, so this step never has to read the character store — the two
 * migrations are independent and can run in either order, or in different sessions.
 *
 * Which variant becomes the pose: the first one the old selection named. That is not quite what the
 * old resolver did — it took the first variant that happened to *have an asset*, which needs the
 * character to know — but it is closer to what the author wrote, and where the two disagree the
 * compiler now reports a missing pose instead of quietly drawing a different differential.
 *
 * Rows on a layered character are not translated: a stack cannot be inferred from a form name. They
 * migrate to a pose id that resolves to nothing, and the compiler says so.
 */
function migrateStoryDocumentV9toV10(document: StoryDocument): StoryDocument {
    return migrateCharacterFormsToPose(document) as StoryDocument;
}

type LegacyCharacterSelection = {
    formName?: unknown;
    variants?: unknown;
    pose?: unknown;
};

/** The first variant an old selection named, in the order the old resolver would have walked. */
function firstLegacyVariant(variants: unknown): string | null {
    if (Array.isArray(variants)) {
        const first = variants.find(entry => typeof entry === "string" && entry.trim());
        return typeof first === "string" ? first.trim() : null;
    }
    if (variants && typeof variants === "object") {
        for (const value of Object.values(variants as Record<string, unknown>)) {
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        }
    }
    return null;
}

function migrateCharacterFormsToPose(node: unknown): unknown {
    if (Array.isArray(node)) {
        return node.map(migrateCharacterFormsToPose);
    }
    if (!node || typeof node !== "object") {
        return node;
    }
    const record = node as Record<string, unknown>;
    const legacy = record as LegacyCharacterSelection;
    const hasLegacy = "formName" in record || "variants" in record;
    if (!hasLegacy || legacy.pose !== undefined) {
        return Object.fromEntries(
            Object.entries(record).map(([key, value]) => [key, migrateCharacterFormsToPose(value)]),
        );
    }

    const formName = typeof legacy.formName === "string" ? legacy.formName.trim() : "";
    const variantName = firstLegacyVariant(legacy.variants);
    const migrated: Record<string, unknown> = Object.fromEntries(
        Object.entries(record)
            .filter(([key]) => key !== "formName" && key !== "variants")
            .map(([key, value]) => [key, migrateCharacterFormsToPose(value)]),
    );
    if (formName && variantName) {
        migrated.pose = legacyPoseId(formName, variantName);
    }
    return migrated;
}

/**
 * v8→v9 (M-VAR): the persistent `StoryVariableRef` arm changes from `{ storageKey }` to
 * `{ variableId }`, symmetric with the scene/saved arms. The value is unchanged - a persistent
 * variable's `variableId` equals its `storageKey` - so this is a pure field rename with zero semantic
 * change. Refs are nested everywhere (setVariable targets, conditions, expression `var` nodes, inline
 * interpolations, snapshot keys are already `persistent:<value>`), so a generic deep walk rewrites
 * every one; the guard (`scope:"persistent"` + `storageKey`, no declaration-payload `name`/`valueType`)
 * distinguishes a ref arm from a `/persis` declaration payload, which keeps its `storageKey`.
 */
function migrateStoryDocumentV8toV9(document: StoryDocument): StoryDocument {
    return migratePersistentRefsToVariableId(document) as StoryDocument;
}

function migratePersistentRefsToVariableId(node: unknown): unknown {
    if (Array.isArray(node)) {
        return node.map(migratePersistentRefsToVariableId);
    }
    if (node !== null && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (
            obj.scope === "persistent" &&
            typeof obj.storageKey === "string" &&
            !("variableId" in obj) &&
            !("valueType" in obj) &&
            !("name" in obj)
        ) {
            return { scope: "persistent", variableId: obj.storageKey };
        }
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            out[key] = migratePersistentRefsToVariableId(value);
        }
        return out;
    }
    return node;
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
