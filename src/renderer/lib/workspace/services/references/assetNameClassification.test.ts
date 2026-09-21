import { describe, expect, it } from "vitest";
import { ASSET_NAME_CARRIER_READER_TYPES } from "./assetNameGaps";
import { shippingRegistry } from "./assetNameTestKit";

/**
 * Every node that can hand a string on has said what it hands on.
 *
 * The asset-name judgement follows a value through a node by what the node declares
 * (`BlueprintNodeDeclaration.assetNames`): it forwards its inputs, hands out something written in the
 * project, or assembles a new string. A node that says nothing is taken to assemble - the safe
 * reading, and the one a plugin gets - but for the built-in catalogue silence is a mistake: a node
 * that only passes a value on, left undeclared, refuses every picture wired through it, and one that
 * assembles, declared as forwarding by accident, lets a missing picture ship.
 *
 * So this walks the shipping catalogue, the built-in plugins included, and fails on any node whose
 * outputs can carry a string and which has not said which it is. Adding such a node is then a
 * decision, made where the node is defined.
 */

/** Pin types that cannot hold a string; the same set the judgement treats as carrying nothing. */
const INERT = new Set([
    "boolean", "integer", "float", "number", "Vector2D", "Rect", "RGBAColor", "Timer", "AnimationToken", "SoundHandle",
]);

function carriesStrings(valueType: string | undefined): boolean {
    return !(valueType !== undefined && (INERT.has(valueType) || valueType === "element" || valueType.startsWith("element:")));
}

describe("the node catalogue says what every string-carrying output hands on", () => {
    it("leaves no built-in node to the assembled default", () => {
        const unclassified: string[] = [];
        for (const def of shippingRegistry().list()) {
            if (def.assetNames || ASSET_NAME_CARRIER_READER_TYPES.has(def.type)) {
                continue;
            }
            const outputs = [
                ...def.pins.filter(pin => pin.kind === "output" && pin.semantic === "data"),
                ...(def.dynamicInputPins?.generatedPinTemplates ?? [])
                    .filter(template => template.kind === "output" && (template.semantic ?? "data") === "data")
                    .map(template => ({ id: template.idSuffix, valueType: template.valueType, assetRef: undefined, assetName: undefined })),
            ];
            const open = outputs.filter(pin => carriesStrings(pin.valueType) && !pin.assetRef && !pin.assetName);
            if (open.length > 0) {
                unclassified.push(`${def.type} (${open.map(pin => pin.id).join(", ")})`);
            }
        }
        expect(unclassified).toEqual([]);
    });

    /**
     * The test above would pass on an empty catalogue, or on one where nothing declares anything
     * because every node had been dropped into the carrier table. These pin it to the nodes it is
     * about.
     */
    it("classifies the nodes the gallery gesture and the Concat case turn on", () => {
        const registry = shippingRegistry();
        expect(registry.get("blueprint.string.concat")?.assetNames).toBe("assembled");
        expect(registry.get("blueprint.string.format")?.assetNames).toBe("assembled");
        expect(registry.get("blueprint.data.memo")?.assetNames).toBe("forward");
        expect(registry.get("blueprint.collection.arraySlice")?.assetNames).toBe("forward");
        expect(registry.get("blueprint.data.jsonGet")?.assetNames).toBe("forward");
        expect(registry.get("blueprint.image.getImageAsset")?.assetNames).toBe("written");
        expect(registry.get("narraleaf.gallery.getEntries")?.assetNames).toBe("written");
        expect(registry.get("narraleaf.gallery.getVariants")?.assetNames).toBe("written");
        expect(ASSET_NAME_CARRIER_READER_TYPES.has("blueprint.list.getItemField")).toBe(true);
        expect(ASSET_NAME_CARRIER_READER_TYPES.has("blueprint.local.get")).toBe(true);
    });

    it("reads the one mixed node pin by pin: a picked font beside a text the game may write", () => {
        const def = shippingRegistry().get("blueprint.text.getAllProperties");
        expect(def?.assetNames).toBe("assembled");
        expect(def?.pins.find(pin => pin.id === "fontAssetId")?.assetName).toBe("written");
    });

    it("declares Play Sound's wired clip as a place a clip is picked", () => {
        const pin = shippingRegistry().get("blueprint.sound.play")?.pins.find(candidate => candidate.id === "assetId");
        expect(pin?.assetRef).toEqual({ kind: "audio" });
    });
});
