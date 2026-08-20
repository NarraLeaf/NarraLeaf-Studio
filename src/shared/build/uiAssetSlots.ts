/**
 * Every place a UI document stores a library asset id, as a read and a write.
 *
 * # Why a walk and not a list of paths
 *
 * `imageFill` alone appears at four different depths on one widget's flat props (root, scrollbar
 * track, scrollbar thumb, list item chrome), and again inside every appearance variant's property
 * groups. A widget's props are an open bag - a new nested chrome prop is a normal thing to add - so
 * an enumeration of known paths is a list that silently stops covering the document. The reference
 * index learned this the hard way and walks; the shipped game's preloader walks; this is the third
 * reader of the same positions and walks for the same reason.
 *
 * What the three agree on is the **property names**: `assetId`, `fontAssetId`, `posterAssetId`.
 * That agreement is load-bearing. A name only the preloader knows is an asset the shipped game
 * fetches and no build ever resolves; a name only this walk knows is an asset resolved into a
 * package nothing preloads. {@link UI_ASSET_ID_PROPERTY_NAMES} is the one list, and
 * `uiAssetSlots.test.ts` holds it against the preloader's copy.
 *
 * # Why the slot carries a writer
 *
 * A build axis is collapsed by replacing the set id in place: the chosen member takes the slot and
 * the editions that were not built stop occurring in the bytes at all, which is what keeps the
 * trimmer from copying them without being told anything about axes. The collector and the writer
 * therefore have to be the same walk - two walks that disagree leave a slot read but never written,
 * and a set id that reaches the shipped game is a request for a file that does not exist.
 */

/**
 * Literal property names that hold a library asset id.
 *
 * Keyed on exact names rather than a suffix: `posterAssetId` would be missed by a `*AssetId` rule
 * only if that rule were written as `endsWith("assetId")` with the wrong case, and a suffix rule
 * would sweep in every unrelated `sourceAssetId`-shaped key a widget might invent for something
 * that is not a library id. The names are few and are meant to be added to deliberately.
 */
export const UI_ASSET_ID_PROPERTY_NAMES: ReadonlySet<string> = Object.freeze(
    new Set(["assetId", "fontAssetId", "posterAssetId"]),
) as ReadonlySet<string>;

/** One stored asset id, and the ability to replace it where it sits. */
export type UiAssetIdSlot = {
    /** The property name it was found under - one of {@link UI_ASSET_ID_PROPERTY_NAMES}. */
    key: string;
    /** The id stored here, trimmed, or null when the slot holds no usable id. */
    read: () => string | null;
    /** Replace the stored id in place. */
    write: (assetId: string) => void;
};

/**
 * Whether an asset set may be named in this kind of slot.
 *
 * One predicate for three readers that have to agree - the picker that offers sets, the build pass
 * that resolves them, and the reference index that decides whether a set id counts as a use of its
 * members. Disagreement is silent in the worst direction: a slot the index expands and the build
 * does not resolve passes every gate and ships a set id to a runtime that has no answer for it.
 *
 * `fontAssetId` says no. A typeface is not fetched by URL and forgotten like a picture: the runtime
 * derives a CSS family name from the asset id and registers one `FontFace` under it, so one id
 * standing for two different files would leave a cached face under a name that no longer describes
 * its bytes. Per-language typefaces are a real need and the family-naming question has to be settled
 * first; until then a set in a font slot is refused by the build rather than half-supported.
 */
export function uiAssetSlotAcceptsSets(key: string): boolean {
    return key !== "fontAssetId";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Visit every asset id slot under `root`, descending through records and arrays alike.
 *
 * Deliberately without a depth limit. A limit is exactly the kind of thing two walks over the same
 * document can disagree about, and these are plain JSON documents with no cycles to guard against -
 * the only bound that matters is the one the author's own nesting imposes.
 */
export function forEachUiAssetIdSlot(root: unknown, visit: (slot: UiAssetIdSlot) => void): void {
    const walkValue = (value: unknown): void => {
        if (Array.isArray(value)) {
            for (const item of value) {
                walkValue(item);
            }
            return;
        }
        if (!isRecord(value)) {
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            if (UI_ASSET_ID_PROPERTY_NAMES.has(key)) {
                visit({
                    key,
                    read: () => {
                        const stored = value[key];
                        const trimmed = typeof stored === "string" ? stored.trim() : "";
                        return trimmed ? trimmed : null;
                    },
                    write: assetId => {
                        value[key] = assetId;
                    },
                });
                // Not `continue`: a value under one of these names is normally a string, but the
                // walk costs nothing on one and a widget that ever nests a record there keeps being
                // covered.
            }
            walkValue(child);
        }
    };
    walkValue(root);
}
