import {
    matchAssetSetCoordinate,
    type AssetSet,
    type AssetSetCandidate,
} from "../types/assetSet";
import { resolveLocaleChain, type GameLocalizationBundle, type LocaleCode } from "../types/localization";
import type { StoryAssetVariants, StoryBlock, StoryDocument } from "../types/story";

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

export type AssetSetMaterializationProblem =
    | {
          kind: "unfilled";
          setId: string;
          setName: string;
          /** The locale with no member, named so the author knows which language to import for. */
          locale: LocaleCode;
          storyId: string;
          sceneId: string;
          blockId: string;
      }
    /** A set this build cannot resolve at all: no axes, more than one, or a build-time axis. */
    | {
          kind: "unsupported";
          setId: string;
          setName: string;
          reason: "noAxes" | "multipleAxes" | "buildAxis";
          storyId: string;
          sceneId: string;
          blockId: string;
      }
    /** Two files answer to one coordinate, so the set does not name a file there. */
    | {
          kind: "ambiguous";
          setId: string;
          setName: string;
          locale: LocaleCode;
          storyId: string;
          sceneId: string;
          blockId: string;
      };

export type AssetSetMaterializationResult = {
    documents: Record<string, StoryDocument>;
    problems: AssetSetMaterializationProblem[];
    /** Every member id written into a map, so a caller can assert the bytes were carried. */
    materializedAssetIds: Set<string>;
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
    const direct = payload.assetId;
    if (typeof direct === "string" && direct.trim()) {
        ids.push(direct.trim());
    }
    // Dialogue rows carry their take under a different name, and a voiced line is as much an asset
    // reference as a background is.
    const voice = payload.voiceAssetId;
    if (typeof voice === "string" && voice.trim()) {
        ids.push(voice.trim());
    }
    const mask = payload.maskAssetId;
    if (typeof mask === "string" && mask.trim()) {
        ids.push(mask.trim());
    }
    return ids;
}

/**
 * The one axis a runtime set resolves on, or why it has none this build can use.
 *
 * Deliberately narrow. This round supports a single `runtime` axis, which is the locale case, and
 * refuses everything else by name instead of guessing: a build axis has to be collapsed rather than
 * carried, and a second axis means the package needs a derived key rather than an inline map. Both
 * are real work, and a build that quietly picked one variant would ship the wrong language with no
 * sign of it.
 */
function soleRuntimeAxis(set: AssetSet): { axis: AssetSet["axes"][number] } | { reason: "noAxes" | "multipleAxes" | "buildAxis" } {
    if (set.axes.length === 0) {
        return { reason: "noAxes" };
    }
    if (set.axes.length > 1) {
        return { reason: "multipleAxes" };
    }
    const axis = set.axes[0];
    if (axis.residency !== "runtime") {
        return { reason: "buildAxis" };
    }
    return { axis };
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
        if (!match) {
            return { unfilled: localization.sourceLocale };
        }
        map[localization.sourceLocale] = match.id;
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
}): AssetSetMaterializationResult {
    const problems: AssetSetMaterializationProblem[] = [];
    const materializedAssetIds = new Set<string>();
    const setsById = new Map(input.sets.map(set => [set.id, set]));
    // Nothing to resolve against. A project with no languages has no locale axis to answer, so a
    // set reference in it is a fault this cannot describe - reported by the caller's own check
    // rather than guessed at here.
    const localization = input.localization;

    if (setsById.size === 0) {
        return { documents: input.documents, problems, materializedAssetIds };
    }

    const documents: Record<string, StoryDocument> = {};
    for (const [storyId, document] of Object.entries(input.documents)) {
        let documentChanged = false;
        const scenes: StoryDocument["scenes"] = {};
        for (const [sceneId, scene] of Object.entries(document.scenes ?? {})) {
            let sceneChanged = false;
            const blocks: typeof scene.blocks = {};
            for (const [blockId, block] of Object.entries(scene.blocks ?? {})) {
                const variants = variantsForBlock({
                    block,
                    setsById,
                    candidates: input.candidates,
                    localization,
                    storyId,
                    sceneId,
                    blockId,
                    problems,
                    materializedAssetIds,
                });
                if (!variants) {
                    blocks[blockId] = block;
                    continue;
                }
                sceneChanged = true;
                blocks[blockId] = { ...block, assetVariants: variants };
            }
            scenes[sceneId] = sceneChanged ? { ...scene, blocks } : scene;
            documentChanged = documentChanged || sceneChanged;
        }
        documents[storyId] = documentChanged ? { ...document, scenes } : document;
    }

    return { documents, problems, materializedAssetIds };
}

function variantsForBlock(input: {
    block: StoryBlock;
    setsById: ReadonlyMap<string, AssetSet>;
    candidates: readonly AssetSetCandidate[];
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
    storyId: string;
    sceneId: string;
    blockId: string;
    problems: AssetSetMaterializationProblem[];
    materializedAssetIds: Set<string>;
}): StoryAssetVariants | undefined {
    let variants: StoryAssetVariants | undefined;
    for (const assetId of assetIdsInBlock(input.block)) {
        const set = input.setsById.get(assetId);
        if (!set) {
            continue;
        }
        const where = { storyId: input.storyId, sceneId: input.sceneId, blockId: input.blockId };
        const axis = soleRuntimeAxis(set);
        if ("reason" in axis) {
            input.problems.push({ kind: "unsupported", setId: set.id, setName: set.name, reason: axis.reason, ...where });
            continue;
        }
        if (!input.localization || input.localization.locales.length === 0) {
            // A set reference in a project with no languages: there is no coordinate to resolve it
            // at, so it is reported as unfilled against the empty locale rather than silently kept.
            input.problems.push({ kind: "unfilled", setId: set.id, setName: set.name, locale: "", ...where });
            continue;
        }
        const filled = fillVariantMap(
            locale => {
                const matches = matchAssetSetCoordinate(set, { [axis.axis.key]: locale }, input.candidates);
                if (matches.length > 1) {
                    return { ambiguous: true };
                }
                return matches.length === 1 ? { id: matches[0] } : null;
            },
            input.localization,
        );
        if ("ambiguous" in filled) {
            input.problems.push({ kind: "ambiguous", setId: set.id, setName: set.name, locale: filled.ambiguous, ...where });
            continue;
        }
        if ("unfilled" in filled) {
            input.problems.push({ kind: "unfilled", setId: set.id, setName: set.name, locale: filled.unfilled, ...where });
            continue;
        }
        variants = { ...(variants ?? {}), [set.id]: filled.map };
        for (const memberId of Object.values(filled.map)) {
            input.materializedAssetIds.add(memberId);
        }
    }
    return variants;
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
