import {
    childAssetSets,
    matchAssetSetCoordinate,
    resolveAssetSetFallbackAsset,
    type AssetSet,
    type AssetSetCandidate,
} from "../types/assetSet";
import { resolveLocaleChain, type GameLocalizationBundle, type LocaleCode } from "../types/localization";
import type { StoryAssetVariants, StoryBlock, StoryDocument, StoryScene } from "../types/story";

/**
 * Filling in what a story's asset sets resolve to, once, while the package is being built.
 *
 * A set names its members by tag, and **the shipped game has no tags**: a protected pack's asset
 * manifest is empty by design (see `GameRuntimePackV1.assets`), so a running game cannot ask what
 * the library holds, only derive a store key from an id it already has. Every set therefore has to
 * be resolved before the bytes are written, and what the package carries is the answer rather than
 * the question.
 *
 * # Why the answer is written at each reference point and not into one table
 *
 * The obvious shape - one project-wide `setId -> locale -> assetId` table in the bundle - is exactly
 * the enumeration the pack format spends its effort not shipping. That table lists every localized
 * asset in the project, including the ones no story reaches, and it lists them *as* a set of
 * variants, which is more than the ids alone would say. Written at the reference point instead, a
 * package discloses precisely what it already had to disclose: the rows that use an asset, and the
 * asset they use.
 *
 * It also makes the variant bytes ship without teaching the trimmer anything. `collectReferencedIds`
 * decides what to copy by scanning the serialized bundle for ids; a map sitting in the row that uses
 * it is *in* those bytes, so every locale's member is kept by the rule that is already there. A
 * side table would have had to be added to that scan by hand, and forgetting is how a language
 * silently ships with no pictures.
 *
 * # Filled means total, so resolution at runtime cannot fail
 *
 * Every locale the project has gets an entry here, so the runtime lookup is `map[locale]` and has no
 * failure branch to get wrong. Where a locale has no member of its own, the project's **declared**
 * fallback chain is walked (`resolveLocaleChain`), and past its end the source locale's member is
 * used - the same order the text of the same row falls back through, so a line and the picture
 * behind it can never disagree about which language they are in.
 *
 * A set that cannot be filled even from the source locale is refused. That is what turns the asset
 * panel's warning colour from advice into a build precondition: the alternative is a package that
 * builds cleanly and shows one language a blank stage.
 */

/**
 * What one locale's coordinate matches in the library.
 *
 * Three answers rather than two, and the difference decides the build. Nothing matched is ordinary:
 * that language has not been drawn yet, and the fallback chain is what covers it. More than one
 * matched is a fault - the set does not name a file at that coordinate - and falling back there
 * would ship the fallback language's picture while the author is looking at two files they believe
 * are the Japanese one.
 */
type LocaleResolver = (locale: LocaleCode) => { id: string } | { ambiguous: true } | null;

type ProblemSite = { storyId: string; sceneId: string; blockId: string };

/**
 * A fault in one set, before anything says where it was named.
 *
 * Split from the site because a set is now resolved for two kinds of content: a story row, which
 * has a scene and a block, and everything else a package carries, which has neither. Both report
 * the same four faults, and a second enumeration of them would be a second thing to keep in step
 * with the resolver that raises them.
 */
export type AssetSetProblemDetail =
    | {
          kind: "unfilled";
          setId: string;
          setName: string;
          axisKey: string;
          /**
           * The axis value with no member: a locale for a runtime axis, an edition's position for a
           * build one. Named so the author knows which file to go and tag.
           */
          value: string;
      }
    /** A set this build cannot resolve at all: no axes, or more than one. */
    | {
          kind: "unsupported";
          setId: string;
          setName: string;
          reason: "noAxes" | "multipleAxes";
      }
    /** Two files answer to one coordinate, so the set does not name a file there. */
    | {
          kind: "ambiguous";
          setId: string;
          setName: string;
          axisKey: string;
          value: string;
      }
    /**
     * A build axis this edition never took a position on.
     *
     * Refused rather than defaulted. A build axis decides which art ships and which is withheld, and
     * an edition that has not said which side it is on is exactly the case where guessing ships the
     * wrong one.
     */
    | {
          kind: "axisUnset";
          setId: string;
          setName: string;
          axisKey: string;
      };

export type AssetSetMaterializationProblem = AssetSetProblemDetail & ProblemSite;

export type AssetSetMaterializationResult = {
    documents: Record<string, StoryDocument>;
    problems: AssetSetMaterializationProblem[];
    /** Every member id written into a map, so a caller can assert the bytes were carried. */
    materializedAssetIds: Set<string>;
    /**
     * Whether a build axis was collapsed, which changes what the package must not carry.
     *
     * The caller has to trim when this is true, whichever edition is being built. Trimming is
     * normally skipped for the release edition on the grounds that it removes no content and so
     * carries nothing unreachable - a collapsed axis is precisely a counter-example, and shipping
     * the variants it dropped is the failure a build axis exists to prevent.
     */
    collapsedBuildAxis: boolean;
};

/**
 * The asset ids a story reads out of a set, per block.
 *
 * Only the eight payload fields that name an asset are read, and they are read by name rather than
 * by walking every string: a story document carries plenty of ids that are not assets (block ids,
 * text ids, character ids), and treating one of those as a set reference would rewrite a row that
 * has nothing to do with assets.
 */
function assetIdsInBlock(block: StoryBlock): string[] {
    const payload = block.payload as Record<string, unknown> | undefined;
    if (!payload) {
        return [];
    }
    const ids: string[] = [];
    for (const value of assetIdSlots(payload).map(slot => slot.read())) {
        if (typeof value === "string" && value.trim()) {
            ids.push(value.trim());
        }
    }
    return ids;
}

/**
 * Every place in a row's payload that names an asset, as a read and a write.
 *
 * Stated once because both halves of this module walk the same list and disagreeing about it is
 * silent: a slot the collector misses gets no map written for it, and the set id reaches the shipped
 * game as an id nothing answers - which is what the transform mask did until it was added here.
 */
function assetIdSlots(payload: Record<string, unknown>): Array<{
    read: () => unknown;
    write: (assetId: string) => void;
}> {
    const slots: Array<{ read: () => unknown; write: (assetId: string) => void }> = [];
    // A row's own asset, and the two fields that are one under a different name: a voiced line's take
    // and a mask image are as much asset references as a background is.
    for (const field of ["assetId", "voiceAssetId", "maskAssetId"] as const) {
        slots.push({ read: () => payload[field], write: value => { payload[field] = value; } });
    }
    // A transform's mask is written one level down, where the channel that owns it lives.
    const transform = payload.transform as { to?: Record<string, unknown> } | undefined;
    const to = transform?.to;
    if (to && typeof to === "object") {
        slots.push({ read: () => to.maskAssetId, write: value => { to.maskAssetId = value; } });
    }
    return slots;
}

/**
 * The axis a set resolves on, or why this build cannot use it.
 *
 * Deliberately narrow. This round supports a set that answers with files, which is the locale case,
 * and refuses a set with sub-sets by name instead of guessing: a value answered one level down
 * needs a derived storage key rather than an inline map, which is real work, and a build that
 * quietly picked one branch would ship the wrong language with no sign of it.
 */
function soleAxis(
    set: AssetSet,
    sets: readonly AssetSet[],
): { axis: AssetSet["axis"] } | { reason: "noAxes" | "multipleAxes" } {
    if (!set.axis.key || set.axis.values.length === 0) {
        return { reason: "noAxes" };
    }
    const nested = set.axis.values.some(value => childAssetSets(set, value, sets).length > 0);
    if (nested) {
        // A sub-set under a value is a second axis by another name, and an inline map would be the
        // product of both at every reference point. Refused rather than flattened.
        return { reason: "multipleAxes" };
    }
    return { axis: set.axis };
}

/**
 * The one member a build axis keeps, or why the package cannot be written.
 *
 * The opposite shape from the runtime case, and deliberately so: nothing is written into the row
 * for the reader to consult, because there is no choice left to make at runtime. The chosen member
 * simply *becomes* the row's asset, and the variants this edition did not take stop occurring in the
 * payload at all - which is what makes the existing byte scan leave them out of the package without
 * being told anything about axes.
 */
function collapseBuildAxis(
    set: AssetSet,
    axisKey: string,
    position: string | undefined,
    candidates: readonly AssetSetCandidate[],
): { id: string } | { unset: true } | { unfilled: string } | { ambiguous: string } {
    if (!position) {
        return { unset: true };
    }
    const matches = matchAssetSetCoordinate(set, { [axisKey]: position }, candidates);
    if (matches.length > 1) {
        return { ambiguous: position };
    }
    if (matches.length === 1) {
        return { id: matches[0] };
    }
    // The set's declared fallback, and only that. An edition that never said where it stands is
    // still refused above (`unset`): that is the property this file protects, because an edition
    // quietly taking a position it never declared is how an adult variant reaches an all-ages
    // package. Taking the file the author named as the one everything else falls back to is not a
    // guess, it is the declaration being carried out.
    const fallback = resolveAssetSetFallbackAsset(set, candidates);
    return fallback ? { id: fallback } : { unfilled: position };
}

/**
 * Every locale mapped to the member it resolves to, or the locale that has none.
 *
 * The chain is the project's, not this module's: `resolveLocaleChain` stops before the source
 * locale because source text is compiled in rather than looked up, so the source member is tried
 * after it as the last step.
 */
function fillVariantMap(
    resolveForValue: LocaleResolver,
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales">,
    /** The set's declared fallback file, tried after the project's own chain has run out. */
    fallbackAssetId: string | null = null,
): { map: Record<string, string> } | { unfilled: LocaleCode } | { ambiguous: LocaleCode } {
    const map: Record<string, string> = {};
    for (const entry of localization.locales) {
        const chain = [...resolveLocaleChain(localization, entry.code), localization.sourceLocale];
        let resolved: string | null = null;
        for (const code of chain) {
            if (!code) {
                continue;
            }
            const match = resolveForValue(code);
            if (match && "ambiguous" in match) {
                // Reported against the locale whose own coordinate is ambiguous, not against the
                // locale that was walking the chain: the file to delete is that language's.
                return { ambiguous: code };
            }
            if (match) {
                resolved = match.id;
                break;
            }
        }
        // The project's chain first, the set's fallback last: a language that inherits from another
        // through the project's own fallback chain reads that language's art, which is the same
        // order its text follows.
        resolved = resolved ?? fallbackAssetId;
        if (!resolved) {
            return { unfilled: entry.code };
        }
        map[entry.code] = resolved;
    }
    // A project whose locale list somehow omits its own source language still has to answer for it:
    // the runtime reads `map[locale]` and the source locale is a locale a player can be in.
    if (localization.sourceLocale && !map[localization.sourceLocale]) {
        const match = resolveForValue(localization.sourceLocale);
        if (match && "ambiguous" in match) {
            return { ambiguous: localization.sourceLocale };
        }
        const resolved = match?.id ?? fallbackAssetId;
        if (!resolved) {
            return { unfilled: localization.sourceLocale };
        }
        map[localization.sourceLocale] = resolved;
    }
    return { map };
}

/**
 * Rewrite every story so each row that names a set carries that set's answer.
 *
 * Documents are copied, never mutated: the caller is holding the author's documents as read off
 * disk, and a build must not be able to change what the editor then shows.
 */
export function materializeStoryAssetSets(input: {
    documents: Record<string, StoryDocument>;
    sets: readonly AssetSet[];
    /** The library, as tag resolution sees it. */
    candidates: readonly AssetSetCandidate[];
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
    /**
     * Where the edition being built sits on each build axis, already folded for it.
     *
     * Absent is an edition that declared nothing, which is refused per axis rather than defaulted -
     * see {@link collapseBuildAxis}.
     */
    assetAxes?: Readonly<Record<string, string>>;
}): AssetSetMaterializationResult {
    const problems: AssetSetMaterializationProblem[] = [];
    const materializedAssetIds = new Set<string>();
    const setsById = new Map(input.sets.map(set => [set.id, set]));
    // Nothing to resolve against. A project with no languages has no locale axis to answer, so a
    // set reference in it is a fault this cannot describe - reported by the caller's own check
    // rather than guessed at here.
    const localization = input.localization;
    let collapsedBuildAxis = false;

    if (setsById.size === 0) {
        return { documents: input.documents, problems, materializedAssetIds, collapsedBuildAxis };
    }

    const documents: Record<string, StoryDocument> = {};
    for (const [storyId, document] of Object.entries(input.documents)) {
        let documentChanged = false;
        const scenes: StoryDocument["scenes"] = {};
        for (const [sceneId, scene] of Object.entries(document.scenes ?? {})) {
            let sceneChanged = false;
            const blocks: typeof scene.blocks = {};
            for (const [blockId, block] of Object.entries(scene.blocks ?? {})) {
                const resolved = resolveSetsForIds({
                    assetIds: assetIdsInBlock(block),
                    setsById,
                    sets: input.sets,
                    candidates: input.candidates,
                    localization,
                    assetAxes: input.assetAxes,
                    storyId,
                    sceneId,
                    blockId,
                    problems,
                    materializedAssetIds,
                });
                if (!resolved) {
                    blocks[blockId] = block;
                    continue;
                }
                sceneChanged = true;
                collapsedBuildAxis = collapsedBuildAxis || resolved.collapsed.size > 0;
                let next = resolved.collapsed.size > 0
                    ? rewriteBlockAssetIds(block, resolved.collapsed)
                    : block;
                if (resolved.variants) {
                    next = { ...next, assetVariants: resolved.variants };
                }
                blocks[blockId] = next;
            }
            let nextScene = sceneChanged ? { ...scene, blocks } : scene;
            // The scene's own two asset fields: the background it opens on and its music. They belong
            // to no row, so they carry their map on the scene - the compiler resolves them while it
            // builds the scene, before any block has run.
            const sceneResolved = resolveSetsForIds({
                assetIds: sceneAssetIds(scene),
                setsById,
                sets: input.sets,
                candidates: input.candidates,
                localization,
                assetAxes: input.assetAxes,
                storyId,
                sceneId,
                blockId: SCENE_FIELD_BLOCK_ID,
                problems,
                materializedAssetIds,
            });
            if (sceneResolved) {
                sceneChanged = true;
                collapsedBuildAxis = collapsedBuildAxis || sceneResolved.collapsed.size > 0;
                if (sceneResolved.collapsed.size > 0) {
                    nextScene = rewriteSceneAssetIds(nextScene, sceneResolved.collapsed);
                }
                if (sceneResolved.variants) {
                    nextScene = { ...nextScene, assetVariants: sceneResolved.variants };
                }
            }
            scenes[sceneId] = nextScene;
            documentChanged = documentChanged || sceneChanged;
        }
        documents[storyId] = documentChanged ? { ...document, scenes } : document;
    }

    return { documents, problems, materializedAssetIds, collapsedBuildAxis };
}

/**
 * Replace the set ids a row names with the assets a build axis collapsed them to.
 *
 * Written back into the payload rather than recorded beside it, because the point of a build axis is
 * that the package must not be able to name the variants it did not take.
 */
function rewriteBlockAssetIds(block: StoryBlock, collapsed: ReadonlyMap<string, string>): StoryBlock {
    // Deep enough to reach the nested slots without sharing them with the document this came from:
    // a transform's `to` is rewritten in place below, and the original row must not change under a
    // caller that is still reading it.
    const payload = structuredClone(block.payload) as Record<string, unknown>;
    for (const slot of assetIdSlots(payload)) {
        const current = slot.read();
        if (typeof current === "string") {
            const member = collapsed.get(current.trim());
            if (member) {
                slot.write(member);
            }
        }
    }
    return { ...block, payload } as StoryBlock;
}

/**
 * Where a problem about a scene's own field is reported.
 *
 * The same word the reference index uses for a scene-level reference, so a fault about a scene's
 * background reads the same wherever it surfaces.
 */
const SCENE_FIELD_BLOCK_ID = "__scene__";

/** The set ids a scene names itself: the background it opens on, and its music. */
function sceneAssetIds(scene: StoryScene): string[] {
    const ids: string[] = [];
    for (const value of [scene.defaultBackgroundAssetId, scene.bgm?.assetId]) {
        if (typeof value === "string" && value.trim()) {
            ids.push(value.trim());
        }
    }
    return ids;
}

/** The scene half of {@link rewriteBlockAssetIds}, for the same reason. */
function rewriteSceneAssetIds(scene: StoryScene, collapsed: ReadonlyMap<string, string>): StoryScene {
    let next = scene;
    const background = scene.defaultBackgroundAssetId?.trim();
    const collapsedBackground = background ? collapsed.get(background) : undefined;
    if (collapsedBackground) {
        next = { ...next, defaultBackgroundAssetId: collapsedBackground };
    }
    const bgm = scene.bgm?.assetId?.trim();
    const collapsedBgm = bgm ? collapsed.get(bgm) : undefined;
    if (collapsedBgm && next.bgm) {
        next = { ...next, bgm: { ...next.bgm, assetId: collapsedBgm } };
    }
    return next;
}

/**
 * What one set resolves to for this build, or the fault that stops it resolving.
 *
 * The whole of "which file does this set mean", with nothing about where it was named. Stories write
 * the answer into the row that named it; content that has no rows carries a table instead - and both
 * have to agree, per set, about which member a locale gets and which one an edition keeps, or the
 * same picture appears in two languages depending on whether a story or a widget asked for it.
 */
export type AssetSetBuildAnswer =
    /** A runtime axis: every locale the project has, mapped to the member it resolves to. */
    | { kind: "variants"; map: Record<string, string> }
    /** A build axis: the one member this edition keeps. The others must not be nameable in the package. */
    | { kind: "collapsed"; assetId: string }
    | { kind: "problem"; problem: AssetSetProblemDetail };

export function resolveAssetSetForBuild(input: {
    set: AssetSet;
    /** The whole document, so a set can be asked whether anything hangs under it. */
    sets: readonly AssetSet[];
    candidates: readonly AssetSetCandidate[];
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
    assetAxes: Readonly<Record<string, string>> | undefined;
}): AssetSetBuildAnswer {
    const { set } = input;
    const axis = soleAxis(set, input.sets);
    if ("reason" in axis) {
        return { kind: "problem", problem: { kind: "unsupported", setId: set.id, setName: set.name, reason: axis.reason } };
    }
    const axisKey = axis.axis.key;
    if (axis.axis.residency === "build") {
        const outcome = collapseBuildAxis(set, axisKey, input.assetAxes?.[axisKey], input.candidates);
        if ("unset" in outcome) {
            return { kind: "problem", problem: { kind: "axisUnset", setId: set.id, setName: set.name, axisKey } };
        }
        if ("ambiguous" in outcome) {
            return { kind: "problem", problem: { kind: "ambiguous", setId: set.id, setName: set.name, axisKey, value: outcome.ambiguous } };
        }
        if ("unfilled" in outcome) {
            return { kind: "problem", problem: { kind: "unfilled", setId: set.id, setName: set.name, axisKey, value: outcome.unfilled } };
        }
        return { kind: "collapsed", assetId: outcome.id };
    }
    if (!input.localization || input.localization.locales.length === 0) {
        // A set reference in a project with no languages: there is no coordinate to resolve it at,
        // so it is reported as unfilled against the empty value rather than silently kept.
        return { kind: "problem", problem: { kind: "unfilled", setId: set.id, setName: set.name, axisKey, value: "" } };
    }
    const filled = fillVariantMap(
        locale => {
            const matches = matchAssetSetCoordinate(set, { [axisKey]: locale }, input.candidates);
            if (matches.length > 1) {
                return { ambiguous: true };
            }
            return matches.length === 1 ? { id: matches[0] } : null;
        },
        input.localization,
        resolveAssetSetFallbackAsset(set, input.candidates),
    );
    if ("ambiguous" in filled) {
        return { kind: "problem", problem: { kind: "ambiguous", setId: set.id, setName: set.name, axisKey, value: filled.ambiguous } };
    }
    if ("unfilled" in filled) {
        return { kind: "problem", problem: { kind: "unfilled", setId: set.id, setName: set.name, axisKey, value: filled.unfilled } };
    }
    return { kind: "variants", map: filled.map };
}

function resolveSetsForIds(input: {
    /** The set ids named by one row, or by a scene's own two fields. */
    assetIds: readonly string[];
    setsById: ReadonlyMap<string, AssetSet>;
    /** The whole document, so a set can be asked whether anything hangs under it. */
    sets: readonly AssetSet[];
    candidates: readonly AssetSetCandidate[];
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
    assetAxes: Readonly<Record<string, string>> | undefined;
    storyId: string;
    sceneId: string;
    blockId: string;
    problems: AssetSetMaterializationProblem[];
    materializedAssetIds: Set<string>;
}): { variants?: StoryAssetVariants; collapsed: Map<string, string> } | undefined {
    let variants: StoryAssetVariants | undefined;
    const collapsed = new Map<string, string>();
    for (const assetId of input.assetIds) {
        const set = input.setsById.get(assetId);
        if (!set) {
            continue;
        }
        const where = { storyId: input.storyId, sceneId: input.sceneId, blockId: input.blockId };
        const answer = resolveAssetSetForBuild({
            set,
            sets: input.sets,
            candidates: input.candidates,
            localization: input.localization,
            assetAxes: input.assetAxes,
        });
        if (answer.kind === "problem") {
            input.problems.push({ ...answer.problem, ...where });
            continue;
        }
        if (answer.kind === "collapsed") {
            collapsed.set(set.id, answer.assetId);
            input.materializedAssetIds.add(answer.assetId);
            continue;
        }
        variants = { ...(variants ?? {}), [set.id]: answer.map };
        for (const memberId of Object.values(answer.map)) {
            input.materializedAssetIds.add(memberId);
        }
    }
    // Nothing to say about this row when neither shape applied: the caller leaves it as it was.
    return variants || collapsed.size > 0 ? { variants, collapsed } : undefined;
}

/**
 * Whether any story still names a set id, after materialization.
 *
 * The gate the caller uses to decide the package is safe to write: a reference this pass could not
 * fill keeps its set id, and a set id reaching the runtime is a request for an asset that does not
 * exist. Separate from the problem list because a caller may want to know "is anything broken"
 * without walking it.
 */
export function storyNamesUnresolvedSet(
    documents: Record<string, StoryDocument>,
    setIds: ReadonlySet<string>,
): boolean {
    if (setIds.size === 0) {
        return false;
    }
    for (const document of Object.values(documents)) {
        for (const scene of Object.values(document.scenes ?? {})) {
            for (const block of Object.values(scene.blocks ?? {})) {
                for (const assetId of assetIdsInBlock(block)) {
                    if (setIds.has(assetId) && !block.assetVariants?.[assetId]) {
                        return true;
                    }
                }
            }
        }
    }
    return false;
}

/**
 * The asset ids a set names for every locale, for a caller that has to prove the bytes shipped.
 *
 * Read off the materialized documents rather than recomputed from the tags, so what is checked is
 * what the package actually says.
 */
export function collectMaterializedVariantIds(documents: Record<string, StoryDocument>): Set<string> {
    const ids = new Set<string>();
    for (const document of Object.values(documents)) {
        for (const scene of Object.values(document.scenes ?? {})) {
            for (const block of Object.values(scene.blocks ?? {})) {
                for (const map of Object.values(block.assetVariants ?? {})) {
                    for (const assetId of Object.values(map)) {
                        ids.add(assetId);
                    }
                }
            }
        }
    }
    return ids;
}
