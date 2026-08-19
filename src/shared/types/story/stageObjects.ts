import type {
    StoryActionPayload,
    StoryActionableKind,
    StoryActionableTargetRef,
    StoryBlock,
    StoryBlockId,
    StoryDisplayableTargetKind,
    StoryDisplayableTargetRef,
    StoryScene,
} from "./document";
import {
    characterStageObjectName,
    declaresStageObject,
    displayableCreatorIdentity,
    normalizeStageObjectName,
    resolveDisplayableTargetRef,
} from "./displayableTarget";
import {
    BGM_STAGE_OBJECT_NAME,
    actionableSourceIdentity,
    resolveActionableTargetRef,
    soundStageObjectName,
} from "./actionableTarget";
import { layerActionTargetRef, resolveStoryLayerRef } from "./layerRef";
import { listSceneBlocksInDocumentOrder } from "./order";

/**
 * **Does the object this row acts on exist?** - asked once, answered once.
 *
 * Two surfaces ask it. The story compiler asks it per row as it builds a scene, and reports the miss
 * to the Story console. Project lint asks it over a whole document, and its answer is what the build
 * gate refuses on. The two must never disagree: a row that errors in a preview and passes a build
 * (or the reverse) is a bug nobody finds, because each surface looks right on its own.
 *
 * So the RULES live here and nowhere else - which row declares an object, which row addresses one,
 * what key each resolves to, and which names are exempt. What differs between the two callers is only
 * the LOOKUP, and it has to: the compiler holds live engine objects in maps it fills as it walks the
 * scene, while lint holds nothing but the document.
 *
 * That difference has two visible consequences, and both are deliberate:
 *
 *  - The compiler asks "is this object on stage *by this row*", so a `/show poster` written above its
 *    `/image create poster` misses; {@link sceneStageObjectNames} asks "does any row in this scene
 *    declare it", so it does not.
 *  - A character's `setMotion` / `setSkin` / `setParams` is a lookup on a puppet character and a
 *    diagnostic of its own on a character Studio draws itself. Which one depends on the character's
 *    profile, which is not in the document, so this side stays silent on all three - see
 *    `characterRowAddressesPortrait`.
 *
 * Lint is therefore the strictly quieter half in both directions - it reports only what neither an
 * ordering nor a profile could rescue, which is the right side to err on for a check that stops a
 * release. It never reports a row the compiler would let through.
 */

/** Every kind of object a row can put on stage and later address by name. */
export type StageObjectKind = StoryDisplayableTargetKind | StoryActionableKind;

/** A row that brings a stage object into existence, and the name it registers it under. */
export type StageObjectDeclaration = {
    blockId: StoryBlockId;
    kind: StageObjectKind;
    /** The registry key. Not always a word - a character keys on its id, an unnamed sound on its asset. */
    name: string;
    /** The author-facing name; the only half safe to print. */
    label: string;
};

/** A row that acts on a stage object some other row has to have declared. */
export type StageObjectReference = {
    blockId: StoryBlockId;
    /**
     * The registries a lookup may be satisfied from, mirroring the compiler's maps.
     *
     * More than one whenever the compiler's own lookup spans more than one: a character portrait is
     * an `Image` registered in the image table, so `/show alice` finds a character exactly as it
     * finds an image, and a `/transform` whose reference records no kind searches the three
     * displayable tables in turn.
     */
    kinds: readonly StageObjectKind[];
    /**
     * What the ROW itself is about, where {@link kinds} is only where its lookup may be satisfied.
     *
     * The two part company on a character: the portrait is filed in the image table too, so `kinds`
     * spans both, while the row is unambiguously about a character. Only the row's own subject can
     * pick the words a report uses, and a character is the one kind whose remedy is a different verb.
     *
     * A `/transform` whose reference records no kind names no subject, and reads as the generic
     * displayable it is searched as first.
     */
    subject: StageObjectKind;
    name: string;
    label: string;
    /**
     * The reserved music channel, which is never reported.
     *
     * It is the one handle that outlives the scene that starts it - a `/bgm` in scene 1 is still
     * playing in scene 2 - so no single-scene reading can tell an unreachable `/vol` from music set
     * somewhere it cannot see. The compiler states the same exemption on `findPlayingSound`.
     */
    reservedMusicChannel: boolean;
};

/**
 * The object a row DECLARES, or null when it only addresses one.
 *
 * The union of the two identity rules, which stay where they are because each is also read on its
 * own: `displayableCreatorIdentity` for images / texts / layers / character portraits,
 * `actionableSourceIdentity` for clips, ambience overlays and sound handles.
 */
export function declaredStageObject(block: StoryBlock): StageObjectDeclaration | null {
    if (block.kind !== "action") {
        return null;
    }
    const identity = displayableCreatorIdentity(block) ?? actionableSourceIdentity(block);
    return identity ? { blockId: block.id, ...identity } : null;
}

/**
 * The stage key + label a displayable row addresses - what the compiler's
 * `displayableActionTargetName` now delegates to, so lint reads the rule rather than a copy of it.
 *
 * The stable `target` reference wins whenever the row carries one: it resolves through the row that
 * DECLARED the object, so it follows a rename of that row. `objectName` is the binding every document
 * written before references carries, and falling back to it is the ordinary path for an older row -
 * never a fault in itself. What gets reported is the LOOKUP coming up empty, either way in.
 */
export function displayableStageRefName(
    scene: StoryScene | null | undefined,
    target: StoryDisplayableTargetRef | undefined,
    objectName: string,
): { name: string; label: string } {
    if (target) {
        const resolved = resolveDisplayableTargetRef(scene, target);
        const name = normalizeStageObjectName(resolved.name);
        return { name, label: resolved.label || resolved.name || name };
    }
    const name = normalizeStageObjectName(objectName);
    return { name, label: objectName.trim() || name };
}

/**
 * The `Actionable` counterpart - what `actionableActionTargetName` delegates to. Same rule and same
 * reason; the `kind` is passed because the reference does not carry one (the row's own `action`
 * states it) and resolution checks it rather than assuming.
 */
export function actionableStageRefName(
    scene: StoryScene | null | undefined,
    target: StoryActionableTargetRef | undefined,
    kind: StoryActionableKind,
    objectName: string,
): { name: string; label: string } {
    if (target) {
        const resolved = resolveActionableTargetRef(scene, target, kind);
        const name = normalizeStageObjectName(resolved.name);
        return { name, label: resolved.label || resolved.name || name };
    }
    const name = normalizeStageObjectName(objectName);
    return { name, label: objectName.trim() || name };
}

/**
 * A character portrait is an `Image`, so both kinds answer one lookup. Written once because three
 * arms below need it and a fourth would forget.
 */
const IMAGE_KINDS: readonly StageObjectKind[] = ["image", "character"];

/** What a kindless `/transform` searches, in the compiler's `getDisplayable` order. */
const ANY_DISPLAYABLE_KINDS: readonly StageObjectKind[] = ["image", "character", "text", "layer"];

/**
 * What a row ADDRESSES and must find already on stage, or null when it addresses nothing that can be
 * missing - it declares, it names a built-in singleton, or it names the scene's default layer.
 *
 * Every arm mirrors the compiler's `findStage*` function for that action and reaches the same key
 * through the same resolver. The only judgement stated here rather than delegated is `kinds`, and
 * that mirrors which map the compiler reaches into.
 */
export function stageObjectReference(
    scene: StoryScene | null | undefined,
    block: StoryBlock,
): StageObjectReference | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (declaresStageObject(payload)) {
        return null;
    }
    const reference = (
        subject: StageObjectKind,
        kinds: readonly StageObjectKind[],
        resolved: { name: string; label: string },
    ): StageObjectReference => ({
        blockId: block.id,
        kinds,
        subject,
        name: resolved.name,
        label: resolved.label,
        reservedMusicChannel: false,
    });

    if (payload.action === "character") {
        // Only the rows that address the PORTRAIT, which is {@link characterRowAddressesPortrait} and
        // narrower than "not an `enter`". A character has no reference to resolve through: it keys on
        // its `characterId`, which is already an identity the project owns, so the stage-name rule is
        // the whole answer.
        if (!characterRowAddressesPortrait(payload)) {
            return null;
        }
        const name = normalizeStageObjectName(characterStageObjectName(payload));
        // A portrait is an `Image`, and a puppet character is a `Puppet` filed under the same key.
        // The compiler searches both tables for a character row, and `IMAGE_KINDS` is that search:
        // an `enter` registers under both keys (see {@link sceneStageObjectNames}).
        return reference("character", IMAGE_KINDS, { name, label: payload.objectName?.trim() || "Character" });
    }
    if (payload.action === "image") {
        return reference("image", IMAGE_KINDS, displayableStageRefName(scene, payload.target, payload.objectName));
    }
    if (payload.action === "text") {
        return reference("text", ["text"], displayableStageRefName(scene, payload.target, payload.objectName));
    }
    if (payload.action === "layer") {
        // The two built-in layers are in every scene, and a row naming no target at all means the
        // scene's default - so only a custom layer can be missing. It is also the one displayable
        // kind the engine will not conjure from a mention.
        const resolved = resolveStoryLayerRef(scene, layerActionTargetRef(payload.target, payload.objectName));
        if (resolved.kind === "default") {
            return null;
        }
        const name = normalizeStageObjectName(resolved.name);
        return reference("layer", ["layer"], { name, label: resolved.name || name });
    }
    if (payload.action === "video") {
        return reference("video", ["video"], actionableStageRefName(scene, payload.target, "video", payload.objectName));
    }
    if (payload.action === "vfx") {
        return reference("vfx", ["vfx"], actionableStageRefName(scene, payload.target, "vfx", payload.objectName));
    }
    if (payload.action === "audio") {
        // `setBgm` points the reserved channel at a new clip rather than addressing a handle, so it is
        // not a reference at all. Every other non-`playSound` operation is a control verb, and the key
        // it falls back to without a reference is the same chain `playSound` registers under - which is
        // why it cannot be `objectName` alone.
        if (payload.operation === "setBgm") {
            return null;
        }
        const resolved = actionableStageRefName(scene, payload.target, "audio", soundStageObjectName(payload));
        return {
            ...reference("audio", ["audio"], resolved),
            reservedMusicChannel: resolved.name === BGM_STAGE_OBJECT_NAME,
        };
    }
    if (payload.action === "displayable") {
        // The one action that is nothing but a reference: `/transform`, `/show`, `/hide` on whatever
        // the target names. A built-in - the scene background, either built-in layer - is always there.
        if (payload.target.builtin) {
            return null;
        }
        const resolved = resolveDisplayableTargetRef(scene, payload.target);
        const name = normalizeStageObjectName(resolved.name);
        const kinds = resolved.kind === undefined
            ? ANY_DISPLAYABLE_KINDS
            : resolved.kind === "image" || resolved.kind === "character"
                ? IMAGE_KINDS
                : [resolved.kind];
        return reference(resolved.kind ?? "image", kinds, { name, label: resolved.label || resolved.name || name });
    }
    return null;
}

/**
 * Whether a character row addresses the portrait - the half of "not an `enter`" that is a stage
 * lookup, rather than every row that is not a declaration.
 *
 * `setName` renames the speaker on the `Character` record and touches no stage object at all.
 *
 * The three runtime-state verbs are left out for a subtler reason, and leaving them out is what
 * keeps this reading inside the compiler's. On a **puppet** character they do address the element,
 * and the compiler reports a miss on them like any other row. On a character Studio draws itself
 * they never reach a lookup: the compiler answers them with a diagnostic of their own ("no runtime
 * to set a motion on") and stops. Which of the two a row is depends on the character's profile,
 * which lives outside the story document - so a reading that has only the document cannot tell them
 * apart, and has to stay silent about all three rather than refuse a build the compiler allowed.
 */
function characterRowAddressesPortrait(payload: Extract<StoryActionPayload, { action: "character" }>): boolean {
    return payload.operation !== "setName"
        && payload.operation !== "setMotion"
        && payload.operation !== "setSkin"
        && payload.operation !== "setParams"
        && !declaresStageObject(payload);
}

/** The rows the runtime will see: a disabled row takes its whole subtree with it. */
function liveSceneBlocks(scene: StoryScene | null | undefined): StoryBlock[] {
    return listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => Boolean(block.disabled) });
}

/**
 * Every name a compile of this scene can put on stage, by kind.
 *
 * Wider than {@link declaredStageObject} on two counts, and both are the compiler's doing rather than
 * a looseness here:
 *
 *  - **A character `enter` registers its portrait under two keys.** The portrait is an `Image` in the
 *    engine's image table, so a later `/show alice` resolving as an image finds it - which is what
 *    makes {@link IMAGE_KINDS} answer for both.
 *  - **Naming a layer on an image or text row creates it.** Placement resolves through the same
 *    get-or-create the `/layer create` row uses, because a row may sit above the row that declares
 *    its layer and dropping it on the default layer instead would silently restack the scene.
 *
 * It used to be wider still: `exit`, `move` and `expression` counted as putting a character on stage,
 * because the compiler built the portrait through get-or-create on those rows too. The compiler no
 * longer does - they address a portrait an `enter` put there - so counting them here would leave lint
 * quietly believing in a character no compile produces.
 */
export function sceneStageObjectNames(
    scene: StoryScene | null | undefined,
): ReadonlyMap<StageObjectKind, ReadonlySet<string>> {
    const names = new Map<StageObjectKind, Set<string>>();
    const add = (kind: StageObjectKind, name: string): void => {
        const trimmed = name.trim();
        if (!trimmed) {
            return;
        }
        const bucket = names.get(kind) ?? new Set<string>();
        bucket.add(trimmed);
        names.set(kind, bucket);
    };

    for (const block of liveSceneBlocks(scene)) {
        const declaration = declaredStageObject(block);
        if (declaration) {
            add(declaration.kind, declaration.name);
        }
        if (block.kind !== "action") {
            continue;
        }
        const payload = block.payload;
        if (payload.action === "character" && declaresStageObject(payload)) {
            // The `character` key is already in from `declaredStageObject` above. This is the second
            // one: the portrait is an `Image` in the engine's image table, so a later `/show alice`
            // resolving as an image finds it. Registering both is what makes `IMAGE_KINDS` true.
            add("image", normalizeStageObjectName(characterStageObjectName(payload)));
        }
        if (payload.action === "image" || payload.action === "text") {
            const placed = resolveStoryLayerRef(scene, payload.layer);
            if (placed.kind === "custom") {
                add("layer", normalizeStageObjectName(placed.name));
            }
        }
        if (payload.action === "audio" && payload.operation === "setBgm") {
            add("audio", BGM_STAGE_OBJECT_NAME);
        }
    }
    return names;
}

/**
 * Every row of this scene that addresses a stage object no row in the scene declares.
 *
 * The dangling half of the reference model, stated over a whole scene. See the module note for why
 * this is quieter than the compiler and must be.
 */
export function danglingStageObjectRefs(scene: StoryScene | null | undefined): StageObjectReference[] {
    const declared = sceneStageObjectNames(scene);
    const dangling: StageObjectReference[] = [];
    for (const block of liveSceneBlocks(scene)) {
        const reference = stageObjectReference(scene, block);
        if (!reference || reference.reservedMusicChannel) {
            continue;
        }
        if (reference.kinds.some(kind => declared.get(kind)?.has(reference.name))) {
            continue;
        }
        dangling.push(reference);
    }
    return dangling;
}

/**
 * The kinds a second declaration of one name is worth reporting for.
 *
 * A `create` cannot mean "again": the compiler's constructors are get-or-create, so the second row
 * hands back the first row's object and its own asset, text or z-index goes nowhere.
 *
 * The two kinds left out are left out because for them a second declaration is ordinary authoring. A
 * character enters, exits and enters again in one scene, and the portrait is meant to be the same
 * object every time. A `/sound` row is how a named sound is replayed, and the one case the compiler
 * can prove wrong there - a replay asking for a different audio track than the handle was built on -
 * it already reports itself.
 */
const REDECLARABLE_KINDS: ReadonlySet<StageObjectKind> =
    new Set<StageObjectKind>(["image", "text", "layer", "video", "vfx"]);

/**
 * Every row that declares a stage name an earlier row in the same scene already declared, excluding
 * the first - the first is the one that stands, and the later rows are the ones an author has to look
 * at.
 */
export function duplicateStageObjectDeclarations(scene: StoryScene | null | undefined): StageObjectDeclaration[] {
    const seen = new Set<string>();
    const duplicates: StageObjectDeclaration[] = [];
    for (const block of liveSceneBlocks(scene)) {
        const declaration = declaredStageObject(block);
        if (!declaration || !REDECLARABLE_KINDS.has(declaration.kind)) {
            continue;
        }
        const key = `${declaration.kind}:${declaration.name}`;
        if (seen.has(key)) {
            duplicates.push(declaration);
            continue;
        }
        seen.add(key);
    }
    return duplicates;
}
