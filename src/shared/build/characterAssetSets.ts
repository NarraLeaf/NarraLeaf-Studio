import { resolveAssetSetForBuild, type AssetSetProblemDetail } from "./assetSetMaterialization";
import type { AssetSet, AssetSetCandidate } from "../types/assetSet";
import type { StoryAssetVariants } from "../types/story";
import type { CharacterAvatarSummaryEntry, DevModeCharacterSummary } from "../types/devMode";
import type { GameLocalizationBundle } from "../types/localization";

/**
 * The asset sets a character names, resolved into the character's own record.
 *
 * # Why the answer goes beside the reference and never into one table
 *
 * A story row carries its own answers (`assetSetMaterialization`); a character has no rows, so this
 * does the same thing one level out. The obvious alternative - a single `setId -> locale -> assetId`
 * object on the bundle - was written first and then taken out. What it lets a reader do is the
 * problem: hold one asset id, open that one object, and read every OTHER set in the package. Those
 * are unrelated pictures belonging to unrelated parts of the game, and an index that hands them over
 * from any starting point is a dump surface whatever it was built for.
 *
 * A reference point discloses only the thing it is for: this picture's own variants. That much is
 * unavoidable wherever the RUNNING GAME picks the language - it has to be able to name every
 * candidate - and it is the whole of what is disclosed. From one picture you reach its own other
 * languages and nothing else.
 *
 * # The carrier is as small as the record allows
 *
 * One pose, one layer, one avatar entry, or the character's own two fields. Not the character as a
 * whole, so that reaching one pose's Japanese art does not also hand over a different pose. A
 * layer's option table rides with its layer because the options ARE that layer across the axis's
 * tags - one slot, drawn differently - and because a `Record<tagId, assetId>` has nowhere to put a
 * field of its own.
 *
 * # Slots are enumerated, not scanned
 *
 * The same bargain `assetIdSlots` makes on the story side, and for the same reason: the collector and
 * the writer walk one list, so a slot that is missed is missed by both and never half-written. A
 * character's shape is small and closed, unlike a widget's props - which is exactly why the
 * interface is not served from here.
 *
 * # A build axis leaves no map at all
 *
 * A runtime (locale) axis is a choice the player makes, so its members are written down. A build axis
 * is decided when the package is written: the chosen member REPLACES the set id in the record, and
 * the variants this edition did not take stop occurring in the payload - which is what keeps the byte
 * scan from copying them without being told anything about axes. `axisUnset` is still refused.
 */

/** A fault in one set, and the part of the project that named it. */
export type AssetSetRecordProblem = AssetSetProblemDetail & { slice: string };

export type CharacterAssetSetResult = {
    problems: AssetSetRecordProblem[];
    /** Every member id written into a map or substituted in place, so a caller can assert the bytes shipped. */
    referencedAssetIds: Set<string>;
    collapsedBuildAxis: boolean;
};

/** Something that can hold an answer, and the ids it answers for. */
type Carrier = {
    record: { assetVariants?: StoryAssetVariants };
    slots: Array<{ read: () => string | null | undefined; write: (assetId: string) => void }>;
};

/**
 * Every place a character names an asset, grouped by the record that will answer for it.
 *
 * Mirrors the reference index's own reading of a character (`rebuildCharacterSlice`), which is the
 * other walk of this shape: if one of them learns about a new slot the other has to as well, or an
 * id becomes either unreportable or unresolvable.
 */
function characterCarriers(summary: DevModeCharacterSummary): Carrier[] {
    const carriers: Carrier[] = [];
    const appearance = summary.appearance;

    // The character's own fields. Deliberately NOT the poses and layers below: those are separate
    // references and get separate maps.
    carriers.push({
        record: summary as { assetVariants?: StoryAssetVariants },
        slots: [{
            read: () => summary.defaultAvatarAssetId,
            write: assetId => { summary.defaultAvatarAssetId = assetId; },
        }],
    });

    if (appearance.kind === "preset") {
        for (const pose of appearance.poses) {
            carriers.push({
                record: pose,
                slots: [{ read: () => pose.assetId, write: assetId => { pose.assetId = assetId; } }],
            });
        }
    }
    if (appearance.kind === "layered") {
        for (const layer of appearance.layers) {
            const slots: Carrier["slots"] = [
                { read: () => layer.assetId, write: assetId => { layer.assetId = assetId; } },
            ];
            const options = layer.options;
            if (options) {
                for (const tagId of Object.keys(options)) {
                    slots.push({ read: () => options[tagId], write: assetId => { options[tagId] = assetId; } });
                }
            }
            carriers.push({ record: layer, slots });
        }
    }
    if (appearance.kind !== "puppet") {
        for (const entry of Object.values(appearance.avatars ?? {}) as CharacterAvatarSummaryEntry[]) {
            carriers.push({
                record: entry,
                slots: [{
                    read: () => entry.overrideAssetId,
                    write: assetId => { entry.overrideAssetId = assetId; },
                }],
            });
        }
    }
    // A puppet's model is left alone on purpose: it names a multi-file bundle whose siblings the
    // engine resolves off the entry's URL, which is a different question from "which file is this".

    return carriers;
}

/**
 * Fill in each character's answers, in place.
 *
 * Mutates rather than copies: these records were built moments ago on their way into a package, and
 * the editor's own copies live in another process.
 */
export function attachCharacterAssetSetVariants(input: {
    characters: readonly DevModeCharacterSummary[] | undefined;
    sets: readonly AssetSet[];
    candidates: readonly AssetSetCandidate[];
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
    assetAxes?: Readonly<Record<string, string>>;
}): CharacterAssetSetResult {
    const problems: AssetSetRecordProblem[] = [];
    const referencedAssetIds = new Set<string>();
    let collapsedBuildAxis = false;

    const setsById = new Map(input.sets.map(set => [set.id, set]));
    if (setsById.size === 0 || !input.characters?.length) {
        return { problems, referencedAssetIds, collapsedBuildAxis };
    }

    // One answer per set however many references name it: what a set resolves to is a fact about the
    // set and the edition, not about who asked. It also keeps one unfinished set from being reported
    // once per pose.
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
            problems.push({ ...answer.problem, slice: "characters" });
        }
        return answer;
    };

    for (const summary of input.characters) {
        for (const carrier of characterCarriers(summary)) {
            let variants: StoryAssetVariants | undefined;
            for (const slot of carrier.slots) {
                const setId = slot.read()?.trim();
                if (!setId || !setsById.has(setId)) {
                    continue;
                }
                const answer = answerFor(setId);
                if (answer.kind === "collapsed") {
                    collapsedBuildAxis = true;
                    referencedAssetIds.add(answer.assetId);
                    slot.write(answer.assetId);
                    continue;
                }
                if (answer.kind === "variants") {
                    variants = { ...(variants ?? {}), [setId]: answer.map };
                    for (const memberId of Object.values(answer.map)) {
                        referencedAssetIds.add(memberId);
                    }
                }
            }
            if (variants) {
                carrier.record.assetVariants = variants;
            }
        }
    }

    return { problems, referencedAssetIds, collapsedBuildAxis };
}

/**
 * Whether any character still names a set the pass above could not fill.
 *
 * The gate a caller uses to decide the package is safe to write: a reference that was not filled
 * keeps its set id, and a set id reaching the runtime is a request for an asset that does not exist.
 */
export function charactersNameUnresolvedSet(
    characters: readonly DevModeCharacterSummary[] | undefined,
    setIds: ReadonlySet<string>,
): boolean {
    if (setIds.size === 0 || !characters?.length) {
        return false;
    }
    for (const summary of characters) {
        for (const carrier of characterCarriers(summary)) {
            for (const slot of carrier.slots) {
                const id = slot.read()?.trim();
                if (id && setIds.has(id) && !carrier.record.assetVariants?.[id]) {
                    return true;
                }
            }
        }
    }
    return false;
}
