import { applyAppTagToStoryDocument } from "@shared/story/appTagFold";
import {
    blueprintGraphCarriers,
    scanStoryEntryPoints,
    traceReachableScenes,
    type StorySceneReach,
} from "@shared/story/storyReachability";
import {
    appTagMechanismKey,
    isBuiltinAppTagId,
    resolveAppTagReachableScenes,
    type AppTagMechanismRef,
    type AppTagReachableScenes,
    type ProjectAppTag,
} from "@shared/types/appTag";
import type { Blueprint } from "@shared/types/blueprint/document";
import { runtimeCapabilitiesCanStartStory, type PluginRuntimeCapability } from "@shared/types/pluginPermissions";
import { listScenesInDocumentOrder, type StoryDocument, type StorySceneId } from "@shared/types/story";
import type { AssetReference, ReferenceSiteKind } from "../workspace/services/references/referenceModel";

/**
 * What a package under one variant contains, and why each member is in it.
 *
 * # What is actually removed, and what is only answered
 *
 * **Scenes are the only members a build removes.** `applyAppTagToStoryDocument` cuts the story down
 * to what this variant runs and drops the scenes nothing can reach any more, and the packed story
 * documents are the bytes a player gets. Everything else in this answer - surfaces, assets,
 * localization keys, plugins - ships whole for every variant today. The UI document is packed
 * entire, every referenced asset is copied, and the plugin set is decided by the project's
 * dependency table rather than by the variant.
 *
 * So the four non-scene answers are **answers, not removals**. Their value is that a report can say
 * what a variant's content comes to and which asset is now carried for no one, without anybody
 * having to assume a trim happened. Read {@link ReleaseContentAnswer.unreferencedAssetIds} as "no
 * retained content references this any more", never as "this was dropped".
 *
 * # One scene answer, not a second one
 *
 * The scene set here is the *same computation the build performs*: the same fold, the same entry
 * scan, the same walk, the same document-order fallback. Nothing in this module walks a story
 * looking for jumps. A solver that computed its own set would eventually disagree with the packer,
 * and the disagreement would surface as a game that stops dead at a jump into a scene the console
 * had just finished listing as kept.
 *
 * # Pure
 *
 * A function of {@link ReleaseContentInput} and nothing else, the way a lint rule is a function of
 * its context. The caller assembles the input from services; this module reaches for nothing, which
 * is what lets the build gate and a panel ask the same question and get the same answer.
 */

/** One story as the solver reads it. `document` is the authored document, before any folding. */
export type ReleaseContentStory = {
    id: string;
    name: string;
    document: StoryDocument;
};

/** One plugin that ships inside the game. Only the declaration matters here; see the capability list. */
export type ReleaseContentPlugin = {
    id: string;
    name: string;
    runtimeCapabilities: readonly PluginRuntimeCapability[];
};

export type ReleaseContentInput = {
    /** The variant being answered about. The release tag is a legitimate subject; it removes nothing. */
    appTag: ProjectAppTag;
    /** The project's own scene declarations - the document root, which every variant inherits. */
    projectDeclaredScenes: AppTagReachableScenes;
    stories: readonly ReleaseContentStory[];
    /** Every blueprint the project runs, loaded: the project's own plus every shared blueprint asset. */
    blueprints: readonly Blueprint[];
    surfaces: readonly { id: string; name: string }[];
    assets: readonly { id: string; name: string }[];
    /** `assetId -> where it is referenced`, as `ReferenceService` indexes it. */
    assetReferences: ReadonlyMap<string, readonly AssetReference[]>;
    /** Named localization keys the project declares. */
    localizationKeys: readonly string[];
    plugins: readonly ReleaseContentPlugin[];
};

export type ReleaseContentMemberKind = "scene" | "surface" | "asset" | "localizationKey" | "plugin";

/**
 * Why one member is in the package.
 *
 * One reason per member rather than all of them. For a scene it is the route the walk found first,
 * which is the shortest one and is always live; for an asset it is one retained site that references
 * it. A member reached forty ways does not need forty rows to be findable, and a report that printed
 * them would bury the members that are in for exactly one reason - which are the interesting ones.
 *
 * No line numbers anywhere. A story reason carries `(storyId, sceneId, blockId)` and the reporting
 * surface resolves the row and its words through `createStoryRowLocator`, the same way every lint
 * finding does. Counting rows in two places is how two surfaces come to disagree about which row a
 * thing is on.
 */
export type ReleaseContentProvenance =
    /** The scene the author marked as this story's entry. */
    | { kind: "storyEntryScene" }
    /** The first scene in document order, which is what the game boots when nothing is marked. */
    | { kind: "documentOrderEntry" }
    /** A `Start Story` node names it. */
    | { kind: "startStoryNode"; blueprintId: string; blueprintName?: string; graphId: string; nodeId: string }
    /** An author's declaration for a mechanism the build cannot read names it. */
    | { kind: "declaredScene"; mechanism: AppTagMechanismRef }
    /** A jump from a scene that is itself in. */
    | { kind: "storyJump"; storyId: string; sceneId: string; blockId: string }
    /** A retained story row references it. */
    | { kind: "storyRow"; storyId: string; sceneId: string; blockId: string }
    /** A retained scene's own settings reference it - a default background, a scene's music. */
    | { kind: "storyScene"; storyId: string; sceneId: string }
    /** Something outside the stories references it. `label` is what the author calls that thing. */
    | { kind: "referenceSite"; siteKind: ReferenceSiteKind; label: string; field: string }
    /** Nothing trims this kind. It is in because every package has it. */
    | { kind: "shipsWithEveryVariant" };

export type ReleaseContentMember = {
    kind: ReleaseContentMemberKind;
    id: string;
    /** What the author calls it. Every surface shows this; the id is for lookup, never for display. */
    name: string;
    /** Present on a scene: which story it belongs to, since scene ids are only unique within one. */
    storyId?: string;
    provenance: ReleaseContentProvenance;
};

/** A scene this variant removes. Named, because an author reads scene names and never scene ids. */
export type RemovedScene = {
    storyId: string;
    storyName: string;
    sceneId: string;
    sceneName: string;
};

/** Why a mechanism stops the build. The remedy is stated by the surface that reports it. */
export type ReleaseContentBlockerReason =
    /** A `Start Story` node whose story or scene is blank, or wired and so decided while the game runs. */
    | "unreadableStartStoryTarget"
    /** A blueprint written in TypeScript, which can call `game.startStory` with anything it computes. */
    | "scriptBlueprint"
    /** A plugin whose declared capabilities let it start a story. */
    | "storyStartingPlugin";

export type ReleaseContentBlocker = {
    reason: ReleaseContentBlockerReason;
    mechanism: AppTagMechanismRef;
    /** Where a declaration for this mechanism is filed. What the editing surface writes under. */
    mechanismKey: string;
    /** What the author calls the thing to go and look at. A blueprint's name, a plugin's name. */
    location: string;
    /** For `unreadableStartStoryTarget`: which of the node's two targets could not be read. */
    missing?: ("storyId" | "sceneId")[];
};

/** A declaration naming a scene the project no longer has. Reported, never silently dropped. */
export type StaleSceneDeclaration = {
    mechanismKey: string;
    storyId: string;
    sceneId: string;
};

export type ReleaseContentAnswer = {
    appTagId: string;
    /** The variant's name as stored. What every line about this answer says out loud. */
    appTagName: string;
    /** Everything the package contains, each with the one reason it is in. */
    members: ReleaseContentMember[];
    /** The scenes this variant removes. Empty means the package is the whole project. */
    removedScenes: RemovedScene[];
    /**
     * Assets no retained content references any more.
     *
     * They still ship. Nothing trims assets, and this is here so a report can say a file is being
     * carried for content the variant does not contain - not so anything can delete it.
     */
    unreferencedAssetIds: string[];
    /**
     * Non-empty means the build must not start.
     *
     * Always empty when {@link removedScenes} is empty. A project that removes nothing has nothing to
     * get wrong: the package is the whole story either way, so a mechanism nobody can read cannot
     * name a scene that is missing from it. This is what keeps a release build - which cuts nothing
     * by construction - from suddenly refusing over a wired node it has always had.
     */
    blockers: ReleaseContentBlocker[];
    /** Declarations pointing at scenes the project no longer has. */
    staleDeclarations: StaleSceneDeclaration[];
};

export function solveReleaseContent(input: ReleaseContentInput): ReleaseContentAnswer {
    const declared = resolveAppTagReachableScenes(input.appTag, input.projectDeclaredScenes);
    // Whether the package drops anything at all, mirroring `planSceneDrop`'s first line. The release
    // build never sweeps - it is the whole project by definition, and Dev Mode, the preview and
    // "play from this row" all enter a scene the author picked rather than one the story reaches.
    // An answer that swept here would call a scene dropped that the release package still carries.
    const sweeps = !isBuiltinAppTagId(input.appTag.id);

    // The fold first, because which scenes the story can still reach is a property of the document
    // *after* this variant's branches and cut points are gone. Asked before it, Path South still
    // jumps to Chapter Two and the demo ships the whole book.
    const folded = new Map<string, StoryDocument>();
    for (const story of input.stories) {
        folded.set(story.id, applyAppTagToStoryDocument(story.document, {
            tagName: input.appTag.name,
            tagId: input.appTag.id,
            // Deliberately no `sceneReachability`: that option makes the fold drop the scenes itself,
            // and this answer needs the whole folded document so it can say which ones went and why.
            // The sweep below is the same one that option runs.
        }));
    }

    const scan = scanStoryEntryPoints(
        blueprintGraphCarriers(input.blueprints),
        (storyId, sceneId) => Boolean(folded.get(storyId)?.scenes[sceneId]),
    );

    const { blockers, entriesFromDeclarations, staleDeclarations, declaredBy } = readMechanisms(input, declared, folded);

    // What put each externally-named scene in, so the walk's bare "seeded from outside" can be
    // reported as the node or the declaration an author can go and open. Declarations first so a
    // node naming the same scene overwrites them: the node is a thing in the project.
    const seededBy = new Map<string, ReleaseContentProvenance>(declaredBy);
    for (const site of scan.sites) {
        seededBy.set(seedKey(site.storyId, site.sceneId), {
            kind: "startStoryNode",
            blueprintId: site.blueprintId,
            ...(site.blueprintName === undefined ? {} : { blueprintName: site.blueprintName }),
            graphId: site.graphId,
            nodeId: site.nodeId,
        });
    }

    const members: ReleaseContentMember[] = [];
    const removedScenes: RemovedScene[] = [];
    const retainedScenes = new Map<string, Set<StorySceneId>>();

    for (const story of input.stories) {
        const document = folded.get(story.id) ?? story.document;
        const entries = [
            ...(scan.byStory.get(story.id) ?? []),
            ...(entriesFromDeclarations.get(story.id) ?? []),
        ];
        // `documentOrder`, matching `dropUnreachableScenes` exactly. A project that never marked an
        // entry must not lose the scene its game opens in, and an answer that used the other policy
        // would call that scene dropped while the package kept it.
        const reached = traceReachableScenes(document, { entrySceneIds: entries, fallback: "documentOrder" });
        const scenes = listScenesInDocumentOrder(document);
        retainedScenes.set(story.id, new Set(sweeps ? reached.keys() : scenes.map(scene => scene.id)));

        for (const scene of scenes) {
            const reach = reached.get(scene.id);
            if (!reach && sweeps) {
                removedScenes.push({
                    storyId: story.id,
                    storyName: story.name,
                    sceneId: scene.id,
                    sceneName: scene.name,
                });
                continue;
            }
            members.push({
                kind: "scene",
                id: scene.id,
                name: scene.name,
                storyId: story.id,
                // A scene nothing reaches can only be here in a build that does not sweep, and there
                // it is in for the same reason a surface is: the package carries everything.
                provenance: reach
                    ? sceneProvenance(reach, story.id, scene.id, seededBy)
                    : { kind: "shipsWithEveryVariant" },
            });
        }
    }

    for (const surface of input.surfaces) {
        members.push({ kind: "surface", ...surface, provenance: { kind: "shipsWithEveryVariant" } });
    }
    for (const key of input.localizationKeys) {
        members.push({
            kind: "localizationKey",
            id: key,
            // A named key is addressed by its name, so the two are the same string. Carried as both
            // rather than special-cased, so a reader of a member never has to know which kinds differ.
            name: key,
            provenance: { kind: "shipsWithEveryVariant" },
        });
    }
    for (const plugin of input.plugins) {
        members.push({ kind: "plugin", ...plugin, provenance: { kind: "shipsWithEveryVariant" } });
    }

    const unreferencedAssetIds: string[] = [];
    for (const asset of input.assets) {
        const provenance = assetProvenance(input.assetReferences.get(asset.id) ?? [], retainedScenes);
        if (provenance) {
            members.push({ kind: "asset", ...asset, provenance });
        } else {
            unreferencedAssetIds.push(asset.id);
        }
    }

    return {
        appTagId: input.appTag.id,
        appTagName: input.appTag.name,
        members,
        removedScenes,
        unreferencedAssetIds,
        // The condition, stated once and on purpose rather than left to fall out of the release
        // check. A variant that removes nothing is the whole project however unreadable its
        // mechanisms are, so there is no answer for one of them to make wrong.
        blockers: removedScenes.length > 0 ? blockers : [],
        staleDeclarations,
    };
}

/**
 * Every mechanism that can name a scene the build cannot read, split into the ones the author has
 * answered and the ones that stop the build.
 *
 * The three kinds are gathered together because the remedy is the same for all of them - declare
 * what this thing starts - and because an author fixing one wants to see the rest in the same list
 * rather than one refusal per build.
 */
function readMechanisms(
    input: ReleaseContentInput,
    declared: AppTagReachableScenes,
    folded: ReadonlyMap<string, StoryDocument>,
): {
    blockers: ReleaseContentBlocker[];
    entriesFromDeclarations: Map<string, StorySceneId[]>;
    staleDeclarations: StaleSceneDeclaration[];
    declaredBy: Map<string, ReleaseContentProvenance>;
} {
    const blockers: ReleaseContentBlocker[] = [];
    const entriesFromDeclarations = new Map<string, StorySceneId[]>();
    const staleDeclarations: StaleSceneDeclaration[] = [];
    const declaredBy = new Map<string, ReleaseContentProvenance>();

    const take = (mechanism: AppTagMechanismRef, reason: ReleaseContentBlockerReason, location: string, missing?: ("storyId" | "sceneId")[]): void => {
        const mechanismKey = appTagMechanismKey(mechanism);
        const scenes = declared[mechanismKey];
        if (!scenes) {
            blockers.push({ reason, mechanism, mechanismKey, location, ...(missing ? { missing } : {}) });
            return;
        }
        for (const scene of scenes) {
            if (!folded.get(scene.storyId)?.scenes[scene.sceneId]) {
                // A declared scene the project no longer has. Reported rather than treated as an
                // entry: a scene id that resolves to nothing would silently narrow what the
                // declaration protects, which is the failure the declaration exists to prevent.
                staleDeclarations.push({ mechanismKey, storyId: scene.storyId, sceneId: scene.sceneId });
                continue;
            }
            const forStory = entriesFromDeclarations.get(scene.storyId);
            if (forStory) {
                forStory.push(scene.sceneId);
            } else {
                entriesFromDeclarations.set(scene.storyId, [scene.sceneId]);
            }
            declaredBy.set(seedKey(scene.storyId, scene.sceneId), { kind: "declaredScene", mechanism });
        }
    };

    const scan = scanStoryEntryPoints(blueprintGraphCarriers(input.blueprints), () => true);
    const blueprintNames = new Map(input.blueprints.map(blueprint => [blueprint.id, blueprint.name]));
    for (const entry of scan.undecidable) {
        take(
            {
                kind: "startStoryNode",
                blueprintId: entry.blueprintId,
                graphKind: entry.graphKind,
                graphId: entry.graphId,
                nodeId: entry.nodeId,
            },
            "unreadableStartStoryTarget",
            entry.blueprintName ?? entry.blueprintId,
            entry.missing,
        );
    }
    for (const blueprint of input.blueprints) {
        if (blueprint.program?.kind !== "graph") {
            take(
                { kind: "scriptBlueprint", blueprintId: blueprint.id },
                "scriptBlueprint",
                blueprintNames.get(blueprint.id) ?? blueprint.id,
            );
        }
    }
    for (const plugin of input.plugins) {
        if (runtimeCapabilitiesCanStartStory(plugin.runtimeCapabilities)) {
            take({ kind: "plugin", pluginId: plugin.id }, "storyStartingPlugin", plugin.name);
        }
    }

    return { blockers, entriesFromDeclarations, staleDeclarations, declaredBy };
}

/**
 * The walk's reason, resolved to something a reader can go and look at.
 *
 * `external` is the one the walk cannot answer alone - it knows a scene was seeded, not by what -
 * so the two things that seed one are looked up here. A node wins over a declaration when both name
 * the same scene: the node is in the project and can be opened, while the declaration is an answer
 * about it.
 */
function sceneProvenance(
    reach: StorySceneReach,
    storyId: string,
    sceneId: StorySceneId,
    seededBy: ReadonlyMap<string, ReleaseContentProvenance>,
): ReleaseContentProvenance {
    switch (reach.kind) {
        case "entryScene":
            return { kind: "storyEntryScene" };
        case "documentOrder":
            return { kind: "documentOrderEntry" };
        case "jump":
            return { kind: "storyJump", storyId, sceneId: reach.fromSceneId, blockId: reach.blockId };
        case "external":
            // The fallback covers a seed whose source has since gone - it cannot happen from the
            // solver's own inputs, and answering "the entry" beats answering nothing.
            return seededBy.get(seedKey(storyId, sceneId)) ?? { kind: "storyEntryScene" };
    }
}

function seedKey(storyId: string, sceneId: string): string {
    return `${storyId}:${sceneId}`;
}

/**
 * One retained site that references this asset, or nothing when every site that does is in a scene
 * this variant removes.
 *
 * A story site is judged against the retained scenes; every other kind is retained by construction,
 * because nothing trims a surface, a blueprint, a character or a voice table. A dormant reference is
 * still a reference: it names an asset the package carries.
 */
function assetProvenance(
    references: readonly AssetReference[],
    retainedScenes: ReadonlyMap<string, ReadonlySet<StorySceneId>>,
): ReleaseContentProvenance | null {
    for (const reference of references) {
        if (reference.kind !== "story") {
            return {
                kind: "referenceSite",
                siteKind: reference.kind,
                label: reference.label,
                field: reference.field,
            };
        }
        const target = reference.target;
        if (target?.kind === "storyBlock") {
            if (retainedScenes.get(target.storyId)?.has(target.sceneId)) {
                return { kind: "storyRow", storyId: target.storyId, sceneId: target.sceneId, blockId: target.blockId };
            }
            continue;
        }
        if (target?.kind === "storyScene") {
            if (retainedScenes.get(target.storyId)?.has(target.sceneId)) {
                return { kind: "storyScene", storyId: target.storyId, sceneId: target.sceneId };
            }
            continue;
        }
        // A story reference with no jump target - a story animation's preview image is the one that
        // exists today. It belongs to no scene, so no scene drop can take it away.
        return { kind: "referenceSite", siteKind: reference.kind, label: reference.label, field: reference.field };
    }
    return null;
}
