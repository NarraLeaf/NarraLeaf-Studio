import { resolveAssetSetForBuild } from "./assetSetMaterialization";
import type { AssetSetRecordProblem } from "./characterAssetSets";
import { forEachUiAssetIdSlot, uiAssetSlotAcceptsSets, type UiAssetIdSlot } from "./uiAssetSlots";
import type { AssetSet, AssetSetCandidate, AssetVariantCarrier, AssetVariantMap } from "../types/assetSet";
import type { UIDocument, UIElement, UISurface } from "../types/ui-editor/document";
import type { GameLocalizationBundle } from "../types/localization";

/**
 * The asset sets the interface names, resolved into the records that name them.
 *
 * The third pass of the same shape as the story's (`assetSetMaterialization`) and the character's
 * (`characterAssetSets`), and it exists for the reason those two do: a set names its members by
 * tag, and the shipped game has no tags, so the package has to carry the answer rather than the
 * question.
 *
 * # Why this could not be done before
 *
 * The interface was left out of the first round on the grounds that its resolution point -
 * `useAssetObjectUrl(assetId)` - is handed an id and nothing else, so there was nowhere to write an
 * answer a widget could find again, and covering it would have meant one project-wide
 * `setId -> locale -> assetId` table. That table is a dump surface: hold any one asset id, open it,
 * and read every other set in the package, including sets belonging to parts of the game the reader
 * never reached. The decision was to cut the feature rather than ship the table.
 *
 * What changed is the resolution point, not the rule. A widget renderer already holds its own
 * `element`, and a Surface layer already holds its own `surface`; both are reference points, so the
 * answer goes on them and the renderer reads it from the record it was rendering anyway - the same
 * move `useLocalizedWidgetText` makes for a widget's text. Nothing here is indexed by asset id, and
 * one element discloses only the variants of the sets that element itself uses.
 *
 * # Which records carry an answer
 *
 * One element, or one Surface's settings. Not the document: a document-wide map would be the table
 * again, one scope down. An element's map covers every slot on that element, exactly as a story
 * row's covers every slot in that row - a widget's own fills are one intent.
 *
 * # A build axis leaves no map at all
 *
 * The chosen member replaces the set id in the slot, and the editions that were not built stop
 * occurring in the payload. That is what keeps `collectReferencedIds` - which decides what to copy
 * by scanning the serialized bundle for ids - from carrying art this edition withheld. `axisUnset`
 * is refused here as everywhere else.
 */

export type UiAssetSetResult = {
    problems: AssetSetRecordProblem[];
    /** Every member id written into a map or substituted in place, so a caller can assert the bytes shipped. */
    referencedAssetIds: Set<string>;
    collapsedBuildAxis: boolean;
};

/** The slice name the interface reports faults under, as an author reads it in a build console. */
const UI_SLICE = "the interface";

/**
 * Fill in the interface's answers, in place.
 *
 * Mutates rather than copies, like the character pass and for the same reason: this document was
 * read off disk moments ago on its way into a package, and the editor's own copy lives in another
 * process.
 */
export function attachUiAssetSetVariants(input: {
    document: UIDocument | undefined;
    sets: readonly AssetSet[];
    candidates: readonly AssetSetCandidate[];
    localization: Pick<GameLocalizationBundle, "sourceLocale" | "locales"> | undefined;
    assetAxes?: Readonly<Record<string, string>>;
}): UiAssetSetResult {
    const problems: AssetSetRecordProblem[] = [];
    const referencedAssetIds = new Set<string>();
    let collapsedBuildAxis = false;

    const setsById = new Map(input.sets.map(set => [set.id, set]));
    if (setsById.size === 0 || !input.document) {
        return { problems, referencedAssetIds, collapsedBuildAxis };
    }

    // One answer per set however many widgets name it: what a set resolves to is a fact about the
    // set and the edition, not about who asked. It also keeps one unfinished set from being
    // reported once per widget on the page.
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
            problems.push({ ...answer.problem, slice: UI_SLICE });
        }
        return answer;
    };

    const resolveCarrier = (record: AssetVariantCarrier, roots: readonly unknown[]): void => {
        let variants: AssetVariantMap | undefined;
        const apply = (slot: UiAssetIdSlot) => {
            const setId = slot.read();
            if (!setId || !setsById.has(setId) || !uiAssetSlotAcceptsSets(slot.key)) {
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
                variants = { ...(variants ?? {}), [setId]: answer.map };
                for (const memberId of Object.values(answer.map)) {
                    referencedAssetIds.add(memberId);
                }
            }
        };
        for (const root of roots) {
            forEachUiAssetIdSlot(root, apply);
        }
        if (variants) {
            record.assetVariants = variants;
        }
    };

    for (const element of uiDocumentElements(input.document)) {
        resolveCarrier(element, elementAssetRoots(element));
    }
    for (const surface of input.document.surfaces ?? []) {
        if (surface.settings) {
            resolveCarrier(surface.settings, [surface.settings]);
        }
    }

    return { problems, referencedAssetIds, collapsedBuildAxis };
}

/**
 * Whether the interface still names a set this pass could not fill.
 *
 * The gate a caller uses to decide the package is safe to write: a reference that was not filled
 * keeps its set id, and a set id reaching the runtime is a request for an asset that does not exist.
 */
export function uiNamesUnresolvedSet(
    document: UIDocument | undefined,
    setIds: ReadonlySet<string>,
): boolean {
    if (setIds.size === 0 || !document) {
        return false;
    }
    const unresolved = (record: AssetVariantCarrier, roots: readonly unknown[]): boolean => {
        let found = false;
        for (const root of roots) {
            forEachUiAssetIdSlot(root, slot => {
                const id = slot.read();
                if (id && setIds.has(id) && uiAssetSlotAcceptsSets(slot.key) && !record.assetVariants?.[id]) {
                    found = true;
                }
            });
        }
        return found;
    };
    for (const element of uiDocumentElements(document)) {
        if (unresolved(element, elementAssetRoots(element))) {
            return true;
        }
    }
    for (const surface of document.surfaces ?? []) {
        if (surface.settings && unresolved(surface.settings, [surface.settings])) {
            return true;
        }
    }
    return false;
}

/**
 * Both element pools, as one sequence.
 *
 * `document.elements` is the stage; `document.components[].elements` is a disjoint pool - a
 * component's elements are not mirrored into the stage pool, so walking only the stage misses every
 * widget inside a reusable component. The reference index makes the same point about the same two
 * pools; a package that resolved one and not the other would ship a component whose fill is a set
 * id.
 */
function uiDocumentElements(document: UIDocument): UIElement[] {
    const elements = Object.values(document.elements ?? {});
    for (const component of document.components ?? []) {
        elements.push(...Object.values(component.elements ?? {}));
    }
    return elements;
}

/**
 * The three bags on an element that can hold an asset id.
 *
 * The same three the shipped game's preloader reads. `extra` and `valueBindings` are included not
 * because a widget stores a picture there today, but because the preloader will fetch one if a
 * widget ever does, and a slot the preloader reads and this pass does not is a set id reaching the
 * runtime.
 */
function elementAssetRoots(element: UIElement): readonly unknown[] {
    return [element.props, element.extra, element.valueBindings];
}

/** A Surface's own settings, which is where its background picture is named. */
export function uiSurfaceVariantCarrier(surface: UISurface): AssetVariantCarrier | null {
    return surface.settings ?? null;
}
