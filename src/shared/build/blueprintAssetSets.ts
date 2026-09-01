import { resolveAssetSetForBuild } from "./assetSetMaterialization";
import type { AssetSetRecordProblem } from "./characterAssetSets";
import {
    blueprintAssetSlotAcceptsSets,
    forEachBlueprintAssetSlot,
    type BlueprintAssetSlot,
} from "./blueprintAssetSlots";
import type { AssetSet, AssetSetCandidate } from "../types/assetSet";
import type { Blueprint, BlueprintDocument, BlueprintGraphIr } from "../types/blueprint/document";
import type { GameLocalizationBundle } from "../types/localization";

/**
 * The asset sets a blueprint names, resolved into the nodes that name them.
 *
 * The fourth pass of the shape the story, the character and the interface already have, and the one
 * whose reference point took longest to admit existed: a pin's value is assigned while the game
 * runs, so it looked as if there were no place to write an answer. The moment of assignment is not
 * where the id comes from. The id comes from `node.params[key]`, written by the picker into the
 * document, which is a reference point like any other.
 *
 * # What is resolved and what is refused
 *
 * Pictures and clips. A typeface pin is refused for the reason `blueprintAssetSlots` gives, and it
 * is refused rather than ignored: the reference index declines to expand it too, so a set id there
 * reaches `assets/missing` and stops the build.
 *
 * # A build axis leaves no map at all
 *
 * The chosen member replaces the set id in the param, and the editions that were not built stop
 * occurring in the payload - the same bargain every other pass makes, and the reason the byte scan
 * keeps working without being told anything about axes.
 */

export type BlueprintAssetSetResult = {
    problems: AssetSetRecordProblem[];
    /** Every member id written into a map or substituted in place, so a caller can assert the bytes shipped. */
    referencedAssetIds: Set<string>;
    collapsedBuildAxis: boolean;
};

/** The slice name blueprint faults report under, as an author reads it in a build console. */
const BLUEPRINT_SLICE = "a blueprint";

/**
 * Fill in a blueprint document's answers, in place.
 *
 * Mutates, like the character and interface passes: these graphs were read off disk moments ago on
 * their way into a package.
 */
export function attachBlueprintAssetSetVariants(input: {
    /** Every graph this package will carry - see {@link blueprintGraphs}. */
    graphs: readonly BlueprintGraphIr[];
    sets: readonly AssetSet[];
    candidates: readonly AssetSetCandidate[];
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
    assetAxes?: Readonly<Record<string, string>>;
}): BlueprintAssetSetResult {
    const problems: AssetSetRecordProblem[] = [];
    const referencedAssetIds = new Set<string>();
    let collapsedBuildAxis = false;

    const setsById = new Map(input.sets.map(set => [set.id, set]));
    if (setsById.size === 0) {
        return { problems, referencedAssetIds, collapsedBuildAxis };
    }

    // One answer per set however many nodes name it - and, unlike the other passes, however many
    // blueprints name it, because one set is commonly read from several graphs at once.
    const answers = new Map<string, ReturnType<typeof resolveAssetSetForBuild>>();
    const answerFor = (setId: string) => {
        const cached = answers.get(setId);
        if (cached) {
            return cached;
        }
        const answer = resolveAssetSetForBuild({
            set: setsById.get(setId)!,
            sets: input.sets,
            candidates: input.candidates,
            localization: input.localization,
            assetAxes: input.assetAxes,
        });
        answers.set(setId, answer);
        if (answer.kind === "problem") {
            problems.push({ ...answer.problem, slice: BLUEPRINT_SLICE });
        }
        return answer;
    };

    const apply = (slot: BlueprintAssetSlot) => {
        const setId = slot.read();
        if (!setId || !setsById.has(setId) || !blueprintAssetSlotAcceptsSets(slot.kind)) {
            return;
        }
        const answer = answerFor(setId);
        if (answer.kind === "collapsed") {
            collapsedBuildAxis = true;
            referencedAssetIds.add(answer.assetId);
            slot.write(answer.assetId);
            return;
        }
        if (answer.kind === "variants") {
            slot.node.assetVariants = { ...(slot.node.assetVariants ?? {}), [setId]: answer.map };
            for (const memberId of Object.values(answer.map)) {
                referencedAssetIds.add(memberId);
            }
        }
    };

    for (const graph of input.graphs) {
        forEachBlueprintAssetSlot(graph, apply);
    }

    return { problems, referencedAssetIds, collapsedBuildAxis };
}

/**
 * Whether a blueprint still names a set this pass could not fill.
 *
 * The gate a caller uses to decide the package is safe to write. Answers about the pins that may
 * hold a set; a typeface pin is not one of them, and its refusal comes from the reference index.
 */
export function blueprintsNameUnresolvedSet(
    graphs: readonly BlueprintGraphIr[],
    setIds: ReadonlySet<string>,
): boolean {
    if (setIds.size === 0) {
        return false;
    }
    let found = false;
    for (const graph of graphs) {
        forEachBlueprintAssetSlot(graph, slot => {
            const id = slot.read();
            if (
                id
                && setIds.has(id)
                && blueprintAssetSlotAcceptsSets(slot.kind)
                && !slot.node.assetVariants?.[id]
            ) {
                found = true;
            }
        });
    }
    return found;
}

/**
 * Every graph in a document: events, functions **and macros**.
 *
 * Macros are the ones a walk forgets. A node buried in a macro is as much a use of an asset as one
 * on an event graph, and the search index's own omission of them is a known gap the reference index
 * had to fix separately - this walk does not repeat it.
 */
export function blueprintGraphs(
    blueprints: readonly (Blueprint | undefined)[],
): BlueprintGraphIr[] {
    const graphs: BlueprintGraphIr[] = [];
    for (const blueprint of blueprints) {
        if (!blueprint || blueprint.program.kind !== "graph") {
            // A `scriptModule` blueprint is TypeScript the author wrote, and an asset id in that
            // source is a string literal this file has no business parsing.
            continue;
        }
        const program = blueprint.program.graphs;
        for (const slot of [
            ...Object.values(program.events),
            ...Object.values(program.functions),
            ...Object.values(program.macros ?? {}),
        ]) {
            if (slot.graph) {
                graphs.push(slot.graph);
            }
        }
    }
    return graphs;
}

/** Every graph in a document, which is one blueprint pool. */
export function blueprintDocumentGraphs(document: BlueprintDocument | undefined): BlueprintGraphIr[] {
    return blueprintGraphs(Object.values(document?.blueprints ?? {}));
}
