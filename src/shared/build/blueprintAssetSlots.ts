import { blueprintImageAssetId, toBlueprintImageAsset } from "../types/blueprint/valueTypes";
import { resolveAssetVariantMember, type AssetVariantMap } from "../types/assetSet";
import type { BlueprintGraphIr, BlueprintGraphNode } from "../types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "../types/blueprint/graph";

/**
 * Every place a blueprint graph stores a library asset id, as a read and a write.
 *
 * # Why the pin list here is shorter than the reference index's
 *
 * The index runs in the renderer and can ask the node catalogue what a plugin's node declares. A
 * build cannot: the catalogue is renderer code and a plugin's node definitions are plugin
 * JavaScript, neither of which the main process may load. So this walk knows only the pins that are
 * declared without a catalogue - which is exactly the floor `DEFAULT_BLUEPRINT_ASSET_PINS` was
 * written to be, plus the Image Asset literal's own stored key and the pre-rename `assetId`.
 *
 * That asymmetry is load-bearing and has to be mirrored on the index side. If the index expanded a
 * set id in a pin this walk cannot see, the set would stop looking like a missing reference,
 * `assets/missing` would go quiet, and the build would ship a set id to a runtime with no answer for
 * it. {@link blueprintAssetSlotAcceptsSets} is what both sides ask, so a pin only this file cannot
 * reach stays refused rather than half-supported.
 *
 * # Why the carrier is the node that stores the id
 *
 * An asset pin can be fed by an edge from a literal node. Then the literal holds the id and the
 * consumer never sees a set at all, so the answer has to travel with the literal.
 */

/** What kind of asset a pin carries. Mirrors the reference index's own two kinds. */
export type BlueprintAssetSlotKind = "image" | "font";

/**
 * The asset pins a build can see without a node catalogue.
 *
 * `paramKey` is where the id is stored, which is not always the pin's own id: the Image Asset
 * literal publishes `value` and stores `asset`.
 */
export const BUILD_VISIBLE_BLUEPRINT_ASSET_PINS: readonly {
    pinId: string;
    paramKey: string;
    kind: BlueprintAssetSlotKind;
}[] = Object.freeze([
    { pinId: "asset", paramKey: "asset", kind: "image" as const },
    { pinId: "fontAssetId", paramKey: "fontAssetId", kind: "font" as const },
]);

/**
 * Literal nodes whose stored `value` is the asset, and which say nothing about that in their type.
 *
 * The legacy shape: before an asset pin could be picked on the node itself, an author wired a JSON
 * or String literal into it. Read only when the edge lands on a pin that declares it carries an
 * asset - never by scanning literals for id-shaped strings, which would invent references.
 */
const GENERIC_LITERAL_NODE_TYPES: ReadonlySet<string> = Object.freeze(
    new Set<string>([
        BLUEPRINT_NODE_TYPE_LITERAL,
        BLUEPRINT_NODE_TYPE_LITERAL_STRING,
        BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    ]),
) as ReadonlySet<string>;

/**
 * Whether an asset set may be named in this kind of slot.
 *
 * `font` says no, for the reason the interface's own walk gives: the runtime derives a CSS family
 * name from the asset id and registers one `FontFace` under it, so one id standing for two files
 * would leave a cached face under a name that no longer describes its bytes.
 */
export function blueprintAssetSlotAcceptsSets(kind: BlueprintAssetSlotKind): boolean {
    return kind === "image";
}

/**
 * The same rule stated as stored keys, for the reference index.
 *
 * The index reports a blueprint reference under the **stored** key it came from - `asset` for a
 * modern pin, `assetId` for the pre-rename one, and `asset` again for a value that arrived over an
 * edge from a literal. That makes this set the intersection of the two conditions above: an image
 * pin, and one this file can reach without a node catalogue.
 *
 * Both sides have to ask the same question. If the index expanded a set id in a pin the build
 * cannot resolve, the id would stop reading as a missing reference and the build would ship it.
 */
export const BLUEPRINT_SET_LEGAL_PARAM_KEYS: ReadonlySet<string> = Object.freeze(
    new Set(["asset", "assetId"]),
) as ReadonlySet<string>;

/** One stored asset id in a graph, and the ability to replace it where it sits. */
export type BlueprintAssetSlot = {
    /** The node that stores it - the carrier an answer is written onto. */
    node: BlueprintGraphNode;
    kind: BlueprintAssetSlotKind;
    read: () => string | null;
    write: (assetId: string) => void;
};

function readSlotValue(kind: BlueprintAssetSlotKind, value: unknown): string | null {
    if (kind === "image") {
        const id = blueprintImageAssetId(value);
        return id && id.trim() ? id.trim() : null;
    }
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function writeSlotValue(kind: BlueprintAssetSlotKind, previous: unknown, assetId: string): unknown {
    // The wrapper is preserved rather than imposed: a graph saved before `{kind:"imageAsset"}`
    // existed stores a bare string, and rewriting it into the wrapper here would change a document
    // shape for a reason that has nothing to do with asset sets.
    if (kind === "image" && previous !== null && typeof previous === "object") {
        return toBlueprintImageAsset(assetId);
    }
    return assetId;
}

/**
 * Visit every asset id slot in one graph.
 *
 * Each slot is reported once against the node that stores it, however many pins read it: a stored
 * key read twice would write one answer twice and report one fault as two.
 */
export function forEachBlueprintAssetSlot(
    graph: BlueprintGraphIr | undefined,
    visit: (slot: BlueprintAssetSlot) => void,
): void {
    const nodes = graph?.nodes ?? {};
    const seen = new Set<string>();
    const slotFor = (node: BlueprintGraphNode, paramKey: string, kind: BlueprintAssetSlotKind) => {
        const key = `${node.id}\u0000${paramKey}`;
        if (seen.has(key)) {
            return;
        }
        seen.add(key);
        const params = node.params;
        if (!params) {
            return;
        }
        visit({
            node,
            kind,
            read: () => readSlotValue(kind, params[paramKey]),
            write: assetId => {
                params[paramKey] = writeSlotValue(kind, params[paramKey], assetId);
            },
        });
    };

    for (const node of Object.values(nodes)) {
        for (const pin of BUILD_VISIBLE_BLUEPRINT_ASSET_PINS) {
            slotFor(node, pin.paramKey, pin.kind);
        }
        if (node.type === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL) {
            slotFor(node, "asset", "image");
        }
        // The pin was renamed `assetId` -> `asset`, and Set Image Asset still falls back to the old
        // name when `asset` is unset. Mirroring that precedence rather than reading both keeps a
        // graph saved before the rename resolvable without inventing a second live reference.
        if (node.params && node.params.asset === undefined) {
            slotFor(node, "assetId", "image");
        }
    }

    // A generic literal wired into a declared asset pin: the literal stores the id under `value`,
    // and the kind is the consumer pin's, not the literal's - a literal has no kind of its own.
    for (const edge of graph?.edges ?? []) {
        const pin = BUILD_VISIBLE_BLUEPRINT_ASSET_PINS.find(candidate => candidate.pinId === edge.to.port);
        if (!pin) {
            continue;
        }
        const source = nodes[edge.from.nodeId];
        if (!source || !GENERIC_LITERAL_NODE_TYPES.has(source.type)) {
            continue;
        }
        slotFor(source, "value", pin.kind);
    }
}

/**
 * A stored pin value, with any asset set it names replaced by the member the language asks for.
 *
 * Called from the blueprint evaluator on every data pin read, so it is written to cost one property
 * lookup on the overwhelming majority of them: a node with no build-written answers returns its
 * value untouched before anything else is examined.
 *
 * **Precise rather than pin-aware.** It rewrites only ids the build itself wrote an answer for,
 * which is why the evaluator needs to know nothing about which pins carry assets - a question it
 * could not answer for a plugin's node anyway.
 *
 * Both stored shapes are handled: the `{kind:"imageAsset"}` wrapper, and the bare string a graph
 * saved before that wrapper existed still holds. The shape is preserved, never converted.
 */
export function resolveStoredAssetSetValue(
    node: { assetVariants?: AssetVariantMap } | undefined,
    value: unknown,
    locale: string | undefined,
    sourceLocale: string | undefined,
): unknown {
    const variants = node?.assetVariants;
    if (!variants) {
        return value;
    }
    if (typeof value === "string") {
        return resolveAssetVariantMember(variants, value.trim(), locale, sourceLocale) ?? value;
    }
    const wrapped = blueprintImageAssetId(value);
    if (!wrapped) {
        return value;
    }
    const member = resolveAssetVariantMember(variants, wrapped, locale, sourceLocale);
    return member ? toBlueprintImageAsset(member) : value;
}
