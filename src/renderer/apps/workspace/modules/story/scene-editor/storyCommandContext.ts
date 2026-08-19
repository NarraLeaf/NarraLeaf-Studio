import { APP_TAG_ID_RELEASE, RELEASE_APP_TAG } from "@shared/types/appTag";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import { actionableSourceIdentity, displayableCreatorIdentity } from "@shared/types/story";
import { savedVariableDefs, sceneVariableDefs, storyPersistentDefs } from "@shared/types/story/declarations";
import { sceneLabelNames } from "@shared/types/story/labels";
import { listSceneBlocksInDocumentOrder } from "@shared/types/story/order";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { buildMergedVariableView } from "@shared/variables/mergedPersistentView";
import { collectTempSpeakers } from "@/lib/workspace/services/story/storyModel";
import type { Character } from "@/lib/workspace/services/character/Character";
import { isPuppetAppearanceKind } from "@shared/utils/characterAppearanceKinds";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetsMap } from "@/lib/workspace/services/assets/types";
import { listSceneDisplayableTargets } from "../../story-motion/storyMotionPreviewTarget";
import { segmentPlainText } from "./storyFindReplace";
import type { StoryCommandAppearanceRef, StoryCommandCharacterSources, StoryCommandContext, StoryCommandNamedRef, StoryCommandStageObjectKind, StoryCommandStageObjects, StoryCommandStageObjectSources, StoryCommandVariableEntry } from "./storyCommandResolution";
import { EMPTY_STORY_COMMAND_STAGE_OBJECT_SOURCES } from "./storyCommandResolution";
import type { StoryPuppetVocabulary } from "./storyCommandValues";

/**
 * Project a live project onto the flat, name-keyed view the command line resolves against.
 *
 * Pure so it can be tested without services, and separate from `storyCommandResolution` so that the
 * resolver never learns what a `Character` or an `AssetsMap` is. When the candidate list arrives it
 * reads this same context, which is what stops the two from disagreeing about what a name means.
 */

function assetRefs(assets: AssetsMap | undefined, type: AssetType): StoryCommandNamedRef[] {
    return Object.values(assets?.[type] ?? {}).map(asset => ({ id: asset.id, name: asset.name }));
}

/**
 * The build variants a row may name, release first.
 *
 * One thing happens here that the service cannot do: the release variant is added when the caller
 * did not supply it, so this table is never empty. A context built without a service (a test, a
 * surface mounted before the project finished opening) must still resolve the one variant every
 * project has, rather than report it as unknown.
 */
function appTagRefs(
    tags: readonly { id: string; name: string }[] | undefined,
): StoryCommandNamedRef[] {
    const refs = (tags ?? []).map(tag => ({ id: tag.id, name: tag.name }));
    if (refs.some(ref => ref.id === APP_TAG_ID_RELEASE)) {
        return refs;
    }
    return [{ id: APP_TAG_ID_RELEASE, name: RELEASE_APP_TAG.name }, ...refs];
}

/**
 * Variables the author may address by name, in scope-chain order: scene, then saved, then persistent.
 *
 * The order is load-bearing - it is what makes a bare `gold` in an expression resolve to the narrowest
 * declaration, with `saved.gold` as the escape hatch when a name is shadowed. See
 * `createStoryExpressionScope`, which sorts by the same rule.
 *
 * Both project scopes arrive as separate inputs rather than off the story document, because both are
 * declared in the project registry as well as in story rows. They used to be missing entirely, so
 * `/set` on a game-level flag reported "unknown variable"; they are the whole point of having those
 * scopes, so they belong in the list.
 */
function variableEntries(
    document: StoryDocument | null,
    scene: StoryScene | null,
    savedVariables: readonly VariableRegistryEntry[],
    persistentVariables: readonly VariableRegistryEntry[],
): StoryCommandVariableEntry[] {
    const entries: StoryCommandVariableEntry[] = [];
    // v6: the tables are scans over declaration rows - the row is the variable.
    for (const definition of Object.values(scene ? sceneVariableDefs(scene) : {})) {
        entries.push({
            name: definition.name,
            ref: { scope: "scene", variableId: definition.id },
            valueType: definition.valueType,
            defaultValue: definition.defaultValue,
        });
    }
    // Saved variables: the same two-surface merge the persistent arm below does, because `saved` is a
    // project-level scope now too. Addressed by `id` - the registry mints an entry's id from the
    // declaration row's block id, so a `/set` written before the registry existed still resolves.
    const savedView = buildMergedVariableView(
        savedVariables,
        document ? Object.values(savedVariableDefs(document)) : [],
    );
    for (const entry of savedView.entries) {
        entries.push({
            name: entry.name,
            ref: { scope: "saved", variableId: entry.id },
            valueType: entry.valueType,
            defaultValue: entry.defaultValue,
        });
    }
    // Persistent variables: the merged view of the registry and story `/persis` rows - one scope, two
    // authoring surfaces. Addressed by `storageKey`, the rename-stable key the compiler hands
    // the host persistence bridge.
    const persistentView = buildMergedVariableView(
        persistentVariables,
        document ? Object.values(storyPersistentDefs(document)) : [],
    );
    for (const entry of persistentView.entries) {
        entries.push({
            name: entry.name,
            // v9: persistent refs address by variableId, which equals the storage key.
            ref: { scope: "persistent", variableId: entry.storageKey },
            valueType: entry.valueType,
            defaultValue: entry.defaultValue,
        });
    }
    return entries;
}

/**
 * The named objects on stage in this scene, per kind - the picker `/show`, `/swap`, `/stop` lead with
 * instead of a blind name field.
 *
 * image / text / layer come from {@link listSceneDisplayableTargets}, the same collector the
 * inspector's target picker reads, so the command line can never offer a name the inspector wouldn't.
 * video and sound handles are not displayable targets, so they are scanned directly off the scene's
 * action blocks. Scene-wide for now (`blockId` omitted): scoping the list to objects created *before*
 * the caret is the position-aware refinement, cheap to add once the slot's anchor is threaded here.
 */
function collectStageObjects(document: StoryDocument | null, sceneId: StorySceneId | null | undefined, scene: StoryScene | null): StoryCommandStageObjects {
    const image = new Set<string>();
    const text = new Set<string>();
    const layer = new Set<string>();
    const video = new Set<string>();
    const audio = new Set<string>();
    const vfx = new Set<string>();

    for (const ref of listSceneDisplayableTargets(document, sceneId ?? undefined, undefined)) {
        if (ref.kind === "image") {
            image.add(ref.name);
        } else if (ref.kind === "text") {
            text.add(ref.name);
        } else if (ref.kind === "layer") {
            layer.add(ref.name);
        }
    }
    for (const block of Object.values(scene?.blocks ?? {})) {
        if (block.kind !== "action") {
            continue;
        }
        if (block.payload.action === "video" && block.payload.objectName) {
            video.add(block.payload.objectName);
        } else if (block.payload.action === "audio" && block.payload.objectName) {
            audio.add(block.payload.objectName);
        } else if (block.payload.action === "vfx" && block.payload.objectName) {
            vfx.add(block.payload.objectName);
        }
    }
    return { image: [...image], text: [...text], layer: [...layer], video: [...video], audio: [...audio], vfx: [...vfx] };
}

/**
 * Which row declares each of those objects - the id half {@link collectStageObjects} throws away
 * when it flattens the scan to names.
 *
 * A separate walk rather than a widening of that one, because the two answer different questions and
 * must keep doing so: the name list is everything a row may address (the engine materialises an
 * object on first mention, so a `/show poster` with no create row ahead of it still belongs there),
 * while an entry here means a row genuinely *defines* the object, which is the only thing a stable
 * reference may bind to. Hence the strict identity functions, not the permissive ones.
 */
function collectStageObjectSources(scene: StoryScene | null): StoryCommandStageObjectSources {
    if (!scene) {
        return EMPTY_STORY_COMMAND_STAGE_OBJECT_SOURCES;
    }
    const sources: Record<StoryCommandStageObjectKind, Record<string, string>> = {
        image: {}, text: {}, layer: {}, video: {}, audio: {}, vfx: {},
    };
    for (const block of listSceneBlocksInDocumentOrder(scene)) {
        const identity = displayableCreatorIdentity(block) ?? actionableSourceIdentity(block);
        // `character` is the one declaring kind with no stage-object arm. It is not skipped - see
        // `collectCharacterSources`, which indexes it by `characterId` because this table's key (the
        // object's stage name) is not what a character target is matched on.
        if (!identity || identity.kind === "character") {
            continue;
        }
        const key = identity.name.trim().toLowerCase();
        // First declaration wins, matching what the scene actually holds: a later row declaring a
        // name already on stage addresses that object rather than replacing it.
        if (key && !(key in sources[identity.kind])) {
            sources[identity.kind][key] = block.id;
        }
    }
    return sources;
}

/**
 * Which row brings each character on stage, keyed by `characterId`.
 *
 * A walk of its own rather than an arm of {@link collectStageObjectSources}, because a character is
 * not a stage object in the sense that scan means: it is addressed by a name the PROJECT owns, and
 * the key it is registered under is derived from the entering row rather than typed on it. Both
 * halves are recorded - the block id anchors the reference, the stage key is what a reference has to
 * store as its fallback, and nothing downstream can recompute the second from the cast name.
 */
function collectCharacterSources(scene: StoryScene | null): StoryCommandCharacterSources {
    if (!scene) {
        return {};
    }
    const sources: Record<string, { blockId: string; name: string }> = {};
    for (const block of listSceneBlocksInDocumentOrder(scene)) {
        const identity = displayableCreatorIdentity(block);
        if (!identity || identity.kind !== "character" || block.kind !== "action" || block.payload.action !== "character") {
            continue;
        }
        const characterId = block.payload.characterId;
        // First entrance wins, the rule `collectStageObjectSources` follows: a second `/show` of a
        // character already on stage addresses that portrait rather than replacing it.
        if (characterId && !(characterId in sources)) {
            sources[characterId] = { blockId: block.id, name: identity.name };
        }
    }
    return sources;
}

/**
 * Every choice option in the document, by the text the player reads - the table `picked(…)` resolves
 * against.
 *
 * Scanned off the raw block map rather than walked in document order: an option is addressed by name
 * and the order it comes back in decides nothing (a duplicate name is reported as ambiguous, not
 * resolved by position). Disabled rows are included on purpose - a row switched off for the afternoon
 * is still the option the author is writing a check about, and having the reference break the moment
 * they toggle it would be the worse failure.
 */
export function choiceOptionRefs(document: StoryDocument | null): StoryCommandNamedRef[] {
    const options: StoryCommandNamedRef[] = [];
    for (const scene of Object.values(document?.scenes ?? {})) {
        for (const block of Object.values(scene?.blocks ?? {})) {
            if (block.kind !== "nodeAction" || block.payload.action !== "choiceOption") {
                continue;
            }
            const name = segmentPlainText(block.payload.text).trim();
            if (name) {
                options.push({ id: block.id, name });
            }
        }
    }
    return options;
}

/**
 * The `mode:"value"` Story Action Blueprints, by name - the table a blueprint call resolves against.
 *
 * `mode` is read off the owner rather than off some separate index because the owner IS the identity
 * of a story blueprint (self-referential: the owner key equals the blueprint id). An `action`
 * blueprint is excluded because it may run latent nodes and returns nothing; a `condition` one
 * because it belongs to the single condition slot that created it.
 */
export function valueBlueprintRefs(document: BlueprintDocument | null | undefined): StoryCommandNamedRef[] {
    const refs: StoryCommandNamedRef[] = [];
    for (const blueprint of Object.values(document?.blueprints ?? {})) {
        const owner = blueprint?.owner;
        if (owner?.kind === "storyAction" && owner.mode === "value" && blueprint.name.trim()) {
            refs.push({ id: blueprint.id, name: blueprint.name.trim() });
        }
    }
    return refs;
}

export function buildStoryCommandContext(input: {
    assets: AssetsMap | undefined;
    characters: readonly Character[];
    document: StoryDocument | null;
    sceneId: StorySceneId | null | undefined;
    scene: StoryScene | null;
    /** Registry-declared persistent (game-level) variables from the M-VAR registry; empty when none. */
    persistentVariables?: readonly VariableRegistryEntry[];
    /**
     * Registry-declared saved (per-playthrough) variables; empty when none.
     *
     * Separate from `persistentVariables` rather than one registry list, because the two scopes are
     * addressed differently once they leave here - `saved` by entry id, `persistent` by storage key -
     * and a single list would make the caller's scope filter this module's guess.
     */
    savedVariables?: readonly VariableRegistryEntry[];
    /**
     * The project's blueprint document, for the `mode:"value"` blueprints an expression may call.
     * Omitted wherever no project is open, which reports every blueprint name as unknown - the honest
     * answer when the list could not be read at all.
     */
    blueprintDocument?: BlueprintDocument | null;
    /**
     * What each puppet character's model reported about itself, for the ones that have been asked and
     * answered. Omit a character - or the whole map - and the surface degrades to free text.
     *
     * An input rather than a lookup because this projection is pure by design: the answer comes from
     * mounting the author's own runtime, which is a service's job (`PuppetDescriptionService`), and a
     * context built in a test has no project to mount anything from.
     */
    puppetByCharacterId?: Readonly<Record<string, StoryPuppetVocabulary>>;
    /**
     * The project's audio tracks. Omitted in tests and wherever no project is open; the result is a
     * line that reports every track name as unknown, which is the honest answer when the list could
     * not be read at all.
     */
    audioTracks?: readonly { id: string; name: string }[];
    /**
     * The project's build variants, release first. Omitted where no project is open; the release
     * variant is added back below, because it exists in every project whether or not anyone read the
     * list, and a slot that takes a variant must never be a dropdown with nothing in it.
     */
    appTags?: readonly { id: string; name: string }[];
}): StoryCommandContext {
    // What a `/show` row can name after the character: a preset character's poses, a layered one's
    // tags (across every axis — the engine resolves each against the group that owns it, so the
    // command surface does not have to ask which axis the author meant).
    const appearanceByCharacterId: Record<string, StoryCommandAppearanceRef[]> = {};
    // A puppet character's differentials are not missing, they do not exist: what it looks like and
    // what it is doing are named by the model its backend loaded. So it contributes no appearance
    // refs at all, and instead lands here - which is what lets `/face` keep one slot for all three
    // appearance kinds and `/motion` / `/skin` refuse the two Studio draws itself.
    const puppetCharacterIds: string[] = [];
    const characters: StoryCommandNamedRef[] = input.characters.map(character => {
        const id = character.profile.getId();
        const appearance = character.profile.appearance;
        if (isPuppetAppearanceKind(appearance.getKind())) {
            puppetCharacterIds.push(id);
        }
        appearanceByCharacterId[id] = appearance.getKind() === "preset"
            ? appearance.getPoses().map(pose => ({ id: pose.id, name: pose.name }))
            // Every tag of every axis, flat: the engine resolves a tag against the group that owns
            // it, so a row never has to say which axis the author meant. The `axisId` rides along
            // because the stored payload does have to.
            : appearance.getAxes().flatMap(axis =>
                axis.tags.map(tag => ({ id: tag.id, name: tag.name, axisId: axis.id })));
        return { id, name: character.profile.getName() };
    });

    return {
        images: assetRefs(input.assets, AssetType.Image),
        audio: assetRefs(input.assets, AssetType.Audio),
        videos: assetRefs(input.assets, AssetType.Video),
        characters,
        // Derived from the document, exactly as the speaker picker derives them, so a temp speaker
        // retires from the command line's candidates precisely when its last line does.
        tempSpeakers: input.document ? collectTempSpeakers(input.document).map(speaker => speaker.name) : [],
        // A scene is addressed by the name the author sees in the panel, not its runtimeName.
        scenes: Object.values(input.document?.scenes ?? {}).map(entry => ({ id: entry.id, name: entry.name })),
        choiceOptions: choiceOptionRefs(input.document),
        valueBlueprints: valueBlueprintRefs(input.blueprintDocument),
        // Order preserved from the service (built-ins first), so the completion menu leads with the
        // three tracks every project has rather than sorting them under a custom one.
        audioTracks: (input.audioTracks ?? []).map(track => ({ id: track.id, name: track.name })),
        // The one scan, shared with the compiler's `goto` validation (§12.9) - not a completion-layer
        // special case, just another table this projection carries.
        labels: sceneLabelNames(input.scene),
        appTags: appTagRefs(input.appTags),
        variables: variableEntries(
            input.document,
            input.scene,
            input.savedVariables ?? [],
            input.persistentVariables ?? [],
        ),
        appearanceByCharacterId,
        puppetCharacterIds,
        // Only the characters that ARE puppets, so a stale entry left behind by an appearance the
        // author changed from `puppet` to `layered` cannot go on offering motions.
        puppetByCharacterId: Object.fromEntries(
            puppetCharacterIds
                .map(id => [id, input.puppetByCharacterId?.[id]] as const)
                .filter((entry): entry is readonly [string, StoryPuppetVocabulary] => entry[1] !== undefined),
        ),
        stageObjects: collectStageObjects(input.document, input.sceneId, input.scene),
        stageObjectSources: collectStageObjectSources(input.scene),
        characterSources: collectCharacterSources(input.scene),
    };
}
