import { BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL } from "@shared/types/blueprint/graph";
import type { BlueprintAssetPinKind } from "@shared/types/blueprint/valueTypes";
import { BLUEPRINT_SOUND_ASSET_PARAM_KEY } from "@shared/build/blueprintAssetSlots";
import type { BlueprintNodeDef, BlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/blueprint-nodes/types";
import type { AssetNameNodeDescriber } from "./assetNameGaps";

/**
 * What the asset walks need to know about a node type, read off the node catalogue.
 *
 * One projection for every reader - the reference index, the graph validator behind the canvas and
 * `blueprint check`, and the project check - so that "which pins of this node carry an asset" has
 * one answer however it is asked. Two copies of it are how a pin the canvas accepts could be one
 * the build refuses.
 */

/**
 * One asset-bearing pin on one node type, as the node catalogue declares it.
 *
 * `paramKey` is where the id is stored when the pin is not wired; it defaults to the pin id and
 * differs only on the Image Asset literal node, which publishes `value` and stores `asset`.
 */
export interface BlueprintAssetPin {
    pinId: string;
    kind: BlueprintAssetPinKind;
    paramKey: string;
    /** Only an input can be fed by an edge, so only an input can be followed to a source. */
    input: boolean;
    /**
     * `"published"` pins hold nothing and hide nothing - see `BlueprintAssetPinRef.origin`.
     * They are declared here anyway, because being declared is what tells the edge walk that a
     * value arriving from one is accounted for rather than unreadable.
     */
    origin?: "stored" | "published";
}

/**
 * Declared asset pins for a node type.
 *
 * **`null` means the catalogue has never heard of this type** — a node left behind by an uninstalled
 * plugin, or a document from a newer Studio. That is not the same as a node with no asset pins, and
 * conflating them is how an asset held by such a node becomes invisible while the index reports full
 * coverage. An empty array means "known, and holds none".
 */
export type BlueprintAssetPinResolver = (nodeType: string) => readonly BlueprintAssetPin[] | null;

/**
 * The pins covered without a catalogue.
 *
 * Present so the model stays usable on its own (and so a catalogue lookup that fails cannot shrink
 * coverage): the resolver's answer is merged onto these, never substituted for them. `assetId` is
 * absent because it is the pre-rename spelling of `asset` and is handled with its own precedence
 * rule by the reference walk.
 */
export const DEFAULT_BLUEPRINT_ASSET_PINS: readonly BlueprintAssetPin[] = [
    { pinId: "asset", kind: "image", paramKey: "asset", input: true },
    { pinId: "fontAssetId", kind: "font", paramKey: "fontAssetId", input: true },
    // Play Sound's clip. `input: false` because it is an inspector param and no pin carries the
    // name, so there is no edge to follow to a source.
    { pinId: BLUEPRINT_SOUND_ASSET_PARAM_KEY, kind: "audio", paramKey: BLUEPRINT_SOUND_ASSET_PARAM_KEY, input: false },
];

/**
 * The Image Asset literal's output, so an edge from one is recognised as already covered rather
 * than read a second time from the node that consumes it.
 *
 * Bound to that node type rather than added to the list above, because `value` is the output pin of
 * every literal node there is. Applied to all of them it would make each one look like a node that
 * stores its own asset, and the legacy-literal reading would never run.
 */
const IMAGE_ASSET_LITERAL_PINS: readonly BlueprintAssetPin[] = [
    ...DEFAULT_BLUEPRINT_ASSET_PINS,
    { pinId: "value", kind: "image", paramKey: "asset", input: false },
];

/**
 * The asset pins of a node type: the catalogue's declarations merged onto the catalogue-free floor.
 *
 * Takes the resolver's answer rather than the catalogue, so a caller with a catalogue of its own (the
 * reference index reads the workspace's) and one with the shared registry answer the same way.
 */
export function mergeBlueprintAssetPins(
    nodeType: string,
    declared: readonly BlueprintAssetPin[] | null,
): BlueprintAssetPin[] {
    const merged: BlueprintAssetPin[] = nodeType === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL
        ? [...IMAGE_ASSET_LITERAL_PINS]
        : [...DEFAULT_BLUEPRINT_ASSET_PINS];
    for (const pin of declared ?? []) {
        if (!merged.some(existing => existing.pinId === pin.pinId)) {
            merged.push(pin);
        }
    }
    return merged;
}

/** The slice of the node catalogue this reads - both the workspace service and the registry have it. */
export interface BlueprintNodeCatalogLike {
    get(type: string): BlueprintNodeDef | undefined;
    resolveCatalogEntry(type: string): BlueprintNodeEditorCatalogEntry;
}

/**
 * Asset-bearing pins for a node type, read off a node catalogue, or null when the catalogue has
 * never heard of the type.
 *
 * The null branch is the point. `resolveCatalogEntry` never throws for an unknown type — it returns a
 * two-exec-pin stub — so asking it alone cannot tell "this node holds no assets" from "nobody knows
 * what this node holds". A graph left behind by an uninstalled plugin is the second, and reading it
 * as the first is how the asset it names goes quiet. `get()` is the only call that distinguishes
 * them.
 */
export function catalogAssetPins(catalog: BlueprintNodeCatalogLike, nodeType: string): readonly BlueprintAssetPin[] | null {
    try {
        if (!catalog.get(nodeType)) {
            return null;
        }
        return catalog.resolveCatalogEntry(nodeType).pins.flatMap(pin => (pin.assetRef
            ? [{
                pinId: pin.id,
                kind: pin.assetRef.kind,
                paramKey: pin.assetRef.paramKey ?? pin.id,
                input: pin.kind === "input",
                ...(pin.assetRef.origin ? { origin: pin.assetRef.origin } : {}),
            }]
            : []));
    } catch {
        return null;
    }
}

/**
 * Everything the asset-name judgement reads off a node catalogue.
 *
 * Titles and labels are the catalogue's own English, which every surface then localizes with the
 * map the canvas draws its cards with - so a sentence about a node names it the way its card does.
 */
export function createAssetNameDescriber(catalog: BlueprintNodeCatalogLike): AssetNameNodeDescriber {
    const entryFor = (nodeType: string): BlueprintNodeEditorCatalogEntry | null => {
        try {
            return catalog.resolveCatalogEntry(nodeType);
        } catch {
            return null;
        }
    };
    return {
        assetPins: nodeType => catalogAssetPins(catalog, nodeType),
        title: nodeType => entryFor(nodeType)?.displayName ?? nodeType,
        pinLabel: (nodeType, pinId) => entryFor(nodeType)?.pins.find(pin => pin.id === pinId)?.label ?? pinId,
    };
}
