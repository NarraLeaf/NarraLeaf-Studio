import { resolveAssetSetForBuild, type AssetSetProblemDetail } from "./assetSetMaterialization";
import type { AssetSet, AssetSetCandidate } from "../types/assetSet";
import type { GameLocalizationBundle } from "../types/localization";

/**
 * The asset sets a shipped game resolves for itself, for the content that is not a story.
 *
 * # Why this exists beside the story path and does not replace it
 *
 * A story row carries its own answer, written into the row (`assetSetMaterialization`). That works
 * because a row is a place: assembly can find it, rewrite it, and the runtime reads the answer off
 * the very thing that asked the question. Nothing else a package carries is like that.
 *
 * - A character's sprite belongs to the character, not to any row, and one row can put any
 *   differential on stage.
 * - A widget's picture is a prop at an arbitrary depth of the UI document, and a blueprint's
 *   `Set Image Asset` node hands a widget an asset id **while the game is running** - so a build
 *   that only rewrote the document would leave that path naming a set nothing answers.
 *
 * So for these the package carries the answers and the runtime does the last step. What it carries
 * is one entry per set the shipped content actually names, and nothing else: not the project's sets,
 * and not the variants an edition did not take.
 *
 * # A build axis never reaches this table as a choice
 *
 * A runtime (locale) axis is a choice the player makes, so its entry lists every locale. A build
 * axis is decided when the package is written, and the table gets only the member this edition
 * keeps - the same locale map with one answer in every slot. The variants it did not take are not
 * named here, are therefore not named anywhere in the package, and the byte scan that decides which
 * files to copy leaves them out without being told anything about axes. That is the property a build
 * axis exists for, and the reason this is not simply the project's set document shipped verbatim.
 *
 * `axisUnset` is still refused rather than defaulted, exactly as it is for stories: an edition that
 * never said where it stands must not quietly be given a side.
 */
export type ShippedAssetSetTable = Record<string, Record<string, string>>;

/** A set fault, and the shipped content that named the set. */
export type AssetSetTableProblem = AssetSetProblemDetail & {
    /**
     * Which part of the package named it - `characters`, `ui`, `blueprints`.
     *
     * A slice rather than an exact site: the collector below finds ids by scanning, which is what
     * makes it immune to a prop path nobody remembered, and the price of that is that it cannot say
     * which widget. The set's own name is what the author acts on, and this says where to look.
     */
    slice: string;
};

export type AssetSetTableResult = {
    table: ShippedAssetSetTable;
    problems: AssetSetTableProblem[];
    /** Every member id written into the table, so a caller can assert the bytes were carried. */
    referencedAssetIds: Set<string>;
    /** Whether a build axis was collapsed here. Same meaning as the story pass: the caller must trim. */
    collapsedBuildAxis: boolean;
};

/**
 * The set ids named anywhere in a payload.
 *
 * A scan of the serialized payload rather than a walk of known fields, for the reason
 * `collectReferencedIds` gives about characters: the places that can name an asset grow with the
 * widget library and the node vocabulary, and a walk that missed one would ship a set id the runtime
 * cannot answer. Matched with the quotes around them, because a sub-set's id is its parent's id and
 * one more segment - so a bare substring match would report the parent as referenced every time a
 * child was, and put the parent's variants in the table nothing asked for.
 */
export function collectAssetSetIds(payload: unknown, setIds: Iterable<string>): Set<string> {
    const found = new Set<string>();
    let text: string;
    try {
        text = JSON.stringify(payload) ?? "";
    } catch {
        // A payload with a cycle is not something this can read, and guessing would be worse than
        // saying nothing: the caller's own gate refuses a set id that reaches the runtime unresolved.
        return found;
    }
    if (!text) {
        return found;
    }
    for (const id of setIds) {
        if (id && text.includes(`"${id}"`)) {
            found.add(id);
        }
    }
    return found;
}

/**
 * Resolve every set the given payloads name, and say what could not be resolved.
 *
 * Each payload is labelled so a fault names the part of the project to go and look at. Payloads are
 * read, never rewritten: the answers live in the table, and the documents ship as the author wrote
 * them - which is what lets the same document serve every locale.
 */
export function buildShippedAssetSetTable(input: {
    payloads: readonly { slice: string; payload: unknown }[];
    sets: readonly AssetSet[];
    /** The library, as tag resolution sees it. */
    candidates: readonly AssetSetCandidate[];
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
    /** Where the edition being built sits on each build axis, already folded for it. */
    assetAxes?: Readonly<Record<string, string>>;
}): AssetSetTableResult {
    const table: ShippedAssetSetTable = {};
    const problems: AssetSetTableProblem[] = [];
    const referencedAssetIds = new Set<string>();
    let collapsedBuildAxis = false;

    const setsById = new Map(input.sets.map(set => [set.id, set]));
    if (setsById.size === 0) {
        return { table, problems, referencedAssetIds, collapsedBuildAxis };
    }

    // One entry per set, whichever slices named it: the answer is a fact about the set and the
    // edition, not about who asked. A set named by both a character and a widget is resolved once.
    const seen = new Set<string>();
    for (const { slice, payload } of input.payloads) {
        for (const setId of collectAssetSetIds(payload, setsById.keys())) {
            if (seen.has(setId)) {
                continue;
            }
            seen.add(setId);
            const set = setsById.get(setId)!;
            const answer = resolveAssetSetForBuild({
                set,
                sets: input.sets,
                candidates: input.candidates,
                localization: input.localization,
                assetAxes: input.assetAxes,
            });
            if (answer.kind === "problem") {
                problems.push({ ...answer.problem, slice });
                continue;
            }
            if (answer.kind === "collapsed") {
                collapsedBuildAxis = true;
                referencedAssetIds.add(answer.assetId);
                // Every locale answers with the one member this edition keeps, so the runtime reads
                // one shape for both kinds of axis and has no branch to get wrong.
                table[setId] = fixedForEveryLocale(answer.assetId, input.localization);
                continue;
            }
            table[setId] = answer.map;
            for (const memberId of Object.values(answer.map)) {
                referencedAssetIds.add(memberId);
            }
        }
    }

    return { table, problems, referencedAssetIds, collapsedBuildAxis };
}

/**
 * One member, under every locale the project has.
 *
 * A project with no localization at all still gets an entry: the runtime falls back to the source
 * locale and then to any entry, and a collapsed build axis has exactly one answer to give.
 */
function fixedForEveryLocale(
    assetId: string,
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined,
): Record<string, string> {
    const map: Record<string, string> = {};
    for (const entry of localization?.locales ?? []) {
        map[entry.code] = assetId;
    }
    if (localization?.sourceLocale) {
        map[localization.sourceLocale] = assetId;
    }
    if (Object.keys(map).length === 0) {
        map[""] = assetId;
    }
    return map;
}

/**
 * The member a set resolves to for a locale, as the running game reads it.
 *
 * The whole of the runtime's half, in one place so the packaged game and Dev Mode cannot answer
 * differently. Falls through the source locale to any entry rather than to null: every entry in this
 * table was resolvable when the package was written, so having one and drawing nothing would be the
 * worst of the available answers.
 */
export function resolveShippedAssetSetMember(
    table: ShippedAssetSetTable | undefined,
    setId: string,
    locale: string | undefined,
    sourceLocale?: string,
): string | null {
    const entry = table?.[setId];
    if (!entry) {
        return null;
    }
    if (locale && entry[locale]) {
        return entry[locale];
    }
    if (sourceLocale && entry[sourceLocale]) {
        return entry[sourceLocale];
    }
    const [first] = Object.values(entry);
    return first ?? null;
}
