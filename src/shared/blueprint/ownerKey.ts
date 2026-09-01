import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";

/**
 * The string that names one blueprint owner slot, and the only code that writes or reads it.
 *
 * `ownerRecords` is keyed by this string, and {@link derivedBlueprintId} hashes it to mint the id of
 * a slot's private blueprint - so the spelling is not a detail. A key that encodes one way and
 * decodes another produces a slot nobody can find, and a key whose spelling changes without its
 * record being rewritten produces a slot that looks empty, mints a second blueprint, and orphans the
 * author's.
 *
 * # Every part is escaped, not just the one that looked risky
 *
 * The earlier form escaped `widgetValue`'s prop path and left the ids raw, on the reasoning that ids
 * are uuids. Most are. Built-in surfaces are not: the main surface's id is
 * `narraleaf-studio:main-surface`, so a widget on it spells
 * `widgetMain:narraleaf-studio:main-surface:<elementId>` - four colon-separated parts in a
 * three-part shape. Across twenty-eight authored projects and the factory skeleton, 182 owner
 * records are that shape today.
 *
 * Three separate decoders had grown, and all three read that key wrongly, each differently: one took
 * `narraleaf-studio` as the surface and `main-surface:<elementId>` as the element; one split on
 * every colon and dropped the element id entirely. The asymmetry is what allowed it - a format where
 * one part is escaped and three are not has no rule a reader can apply without knowing which part
 * they are looking at.
 *
 * So every part is percent-encoded and the separator can no longer occur inside one. Splitting is
 * then exact, arity is checkable, and {@link decodeBlueprintOwnerKey} is a total inverse of
 * {@link encodeBlueprintOwnerKey} rather than three approximations of it. Uuids survive
 * `encodeURIComponent` unchanged, so in practice only the built-in ids look any different.
 *
 * # In `@shared`, so the migration and the editor cannot drift
 *
 * The migration that rewrites existing keys has to spell them the same way the editor will look them
 * up. Those two living in different packages, each with its own copy, is the shape the defect above
 * already took once.
 */

/** The separator. Cannot occur inside a part, because every part is percent-encoded. */
const SEPARATOR = ":";

/** The whole key for the one owner that has no id to name. */
export const GLOBAL_MAIN_OWNER_KEY = "globalMain";

function encodePart(value: string): string {
    return encodeURIComponent(value);
}

function decodePart(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        // A key that is not valid percent-encoding is not one this ever wrote. Handing back the raw
        // text keeps the caller on the "unknown owner" path instead of throwing out of a read.
        return value;
    }
}

/** The key for an owner slot. Exhaustive: a new owner kind fails to compile until it is spelled. */
export function encodeBlueprintOwnerKey(owner: BlueprintOwnerRef): string {
    switch (owner.kind) {
        case "globalMain":
            return GLOBAL_MAIN_OWNER_KEY;
        case "surfaceMain":
            return join("surfaceMain", owner.surfaceId);
        case "widgetMain":
            return join("widgetMain", owner.surfaceId, owner.elementId);
        case "widgetValue":
            return join("widgetValue", owner.surfaceId, owner.elementId, owner.propPath);
        case "componentWidgetMain":
            return join("componentWidgetMain", owner.componentId, owner.elementId);
        case "sharedAsset":
            return join("sharedAsset", owner.assetId);
        case "storyAction":
            // Self-referential: the key is the blueprint's own id. `mode` is deliberately not part of
            // it - it says how the graph is consumed, not which slot this is, and folding it in would
            // give one story row two slots the day an author changed an inline value to a condition.
            return join("storyAction", owner.blueprintId);
        default: {
            const unspelled: never = owner;
            return unspelled;
        }
    }
}

function join(kind: string, ...parts: string[]): string {
    return [kind, ...parts.map(encodePart)].join(SEPARATOR);
}

/**
 * The owner slot a key names, or null when it names none.
 *
 * Null rather than a throw: keys reach this from documents on disk and from search hits, and an
 * unreadable one means "nowhere to jump", not "stop reading the project". Arity is exact, so a key
 * with a part too many is rejected rather than quietly reinterpreted - that reinterpretation is
 * precisely what the previous decoders did.
 *
 * `storyAction` comes back without `mode`, which the key does not carry. Callers that need it read
 * it from the blueprint, which is where it is authored.
 */
export function decodeBlueprintOwnerKey(key: string): BlueprintOwnerRef | null {
    const parts = key.split(SEPARATOR);
    const [kind, ...rest] = parts;
    const at = (index: number) => decodePart(rest[index]);
    switch (kind) {
        case "globalMain":
            return rest.length === 0 ? { kind: "globalMain" } : null;
        case "surfaceMain":
            return rest.length === 1 ? { kind: "surfaceMain", surfaceId: at(0) } : null;
        case "widgetMain":
            return rest.length === 2
                ? { kind: "widgetMain", surfaceId: at(0), elementId: at(1) }
                : null;
        case "widgetValue":
            return rest.length === 3
                ? { kind: "widgetValue", surfaceId: at(0), elementId: at(1), propPath: at(2) }
                : null;
        case "componentWidgetMain":
            return rest.length === 2
                ? { kind: "componentWidgetMain", componentId: at(0), elementId: at(1) }
                : null;
        case "sharedAsset":
            return rest.length === 1 ? { kind: "sharedAsset", assetId: at(0) } : null;
        case "storyAction":
            return rest.length === 1 ? { kind: "storyAction", blueprintId: at(0) } : null;
        default:
            return null;
    }
}

/**
 * Read a key written before every part was escaped, so the migration can rewrite it.
 *
 * **Right to left, because that is the end that is fixed.** The old form left ids raw, so a
 * `widgetMain` key could be three parts or four depending on whether its surface was built in.
 * Reading from the left cannot tell those apart; reading from the right can, because the trailing
 * part is an element id and element ids are uuids - no built-in id sits in that position. Measured
 * over the factory skeleton and twenty-eight authored projects: 5,831 `widgetMain` and
 * `componentWidgetMain` keys, every one of them with a uuid last, and no exceptions. The 105
 * `widgetValue` keys likewise carry a uuid in the element position, and their prop path was already
 * escaped, so it cannot contribute a separator either.
 *
 * Only the migration should call this. Everything else reads {@link decodeBlueprintOwnerKey}, whose
 * strictness is the point.
 */
export function decodeLegacyBlueprintOwnerKey(key: string): BlueprintOwnerRef | null {
    const parts = key.split(SEPARATOR);
    const [kind, ...rest] = parts;
    // The old form escaped this one part and nothing else.
    const legacyTail = () => decodePart(rest[rest.length - 1]);
    switch (kind) {
        case "globalMain":
            return rest.length === 0 ? { kind: "globalMain" } : null;
        case "surfaceMain":
            // Every remaining part: a surface id may contain the separator and nothing follows it.
            return rest.length >= 1 ? { kind: "surfaceMain", surfaceId: rest.join(SEPARATOR) } : null;
        case "widgetMain":
            return rest.length >= 2
                ? {
                    kind: "widgetMain",
                    surfaceId: rest.slice(0, -1).join(SEPARATOR),
                    elementId: rest[rest.length - 1],
                }
                : null;
        case "componentWidgetMain":
            return rest.length >= 2
                ? {
                    kind: "componentWidgetMain",
                    componentId: rest.slice(0, -1).join(SEPARATOR),
                    elementId: rest[rest.length - 1],
                }
                : null;
        case "widgetValue":
            return rest.length >= 3
                ? {
                    kind: "widgetValue",
                    surfaceId: rest.slice(0, -2).join(SEPARATOR),
                    elementId: rest[rest.length - 2],
                    propPath: legacyTail(),
                }
                : null;
        case "sharedAsset":
            return rest.length >= 1 ? { kind: "sharedAsset", assetId: rest.join(SEPARATOR) } : null;
        case "storyAction":
            return rest.length >= 1 ? { kind: "storyAction", blueprintId: rest.join(SEPARATOR) } : null;
        default:
            return null;
    }
}
