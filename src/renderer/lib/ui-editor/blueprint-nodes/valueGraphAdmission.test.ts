import { beforeAll, describe, expect, it } from "vitest";
import { registerCoreBlueprintNodes } from "./registerCoreBlueprintNodes";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInBlueprintValueGraph } from "./BlueprintNodeRegistry";

/**
 * Which pure built-in nodes a Blueprint Value graph refuses, and why.
 *
 * Admission for built-ins ends on a list of categories, so a node in a category nobody added there is
 * kept out of value graphs without anything saying so - the whole Time family once was. Every pure,
 * non-latent built-in that is refused has to be named here with its reason, so a new node lands in a
 * value graph or in this table, never silently in neither.
 */
const REFUSED: Record<string, string[]> = {
    // A widget's own getters read the widget a widgetMain graph belongs to. A value binding is owned
    // by the element it binds, and reads another element through the Element-category getters.
    selfGetters: [
        "blueprint.button.getEnabled", "blueprint.button.getLabel", "blueprint.button.getVariant", "blueprint.button.getVisible",
        "blueprint.container.getClipContent", "blueprint.container.getEnabled", "blueprint.container.getVariant", "blueprint.container.getVisible",
        "blueprint.frame.getEnabled", "blueprint.frame.getVisible", "blueprint.frameWidget.getParams", "blueprint.frameWidget.getTargetPage",
        "blueprint.image.getCropRect", "blueprint.image.getEnabled", "blueprint.image.getFitMode", "blueprint.image.getFlipX",
        "blueprint.image.getFlipY", "blueprint.image.getImageAsset", "blueprint.image.getVisible",
        "blueprint.switch.getChecked", "blueprint.switch.getEnabled", "blueprint.switch.getVisible",
        "blueprint.textInput.getValue",
        "blueprint.video.getDuration", "blueprint.video.getTime", "blueprint.video.getVolume",
        "blueprint.video.isEnded", "blueprint.video.isMuted", "blueprint.video.isPlaying",
    ],
    // These read state the value runtime does not record as a dependency, so a binding built on one
    // would show the first answer and never change.
    untrackedReads: [
        "blueprint.input.getDevice", "blueprint.input.getGamepadAxis", "blueprint.input.isActionHeld",
        "blueprint.input.isGamepadButtonHeld", "blueprint.input.isGamepadConnected",
        "blueprint.layer.isMounted", "blueprint.broadcast.getListenerCount", "blueprint.component.getParam",
    ],
    // Offered only to graphs that act on an image widget (`canUseImageAssetLiteral`); an image
    // binding's value graph picks its asset through the binding's own asset field.
    imageLiteral: ["blueprint.image.assetLiteral"],
    // A declaration, not a read: a value graph's locals live only for one evaluation.
    declarations: ["blueprint.local.declareVar"],
};

describe("Blueprint Value graph admission", () => {
    beforeAll(() => {
        registerCoreBlueprintNodes();
    });

    it("names every pure built-in it refuses, with a reason", () => {
        const refused = blueprintNodeRegistry.list()
            .filter(def => def.isPure && !def.isLatent && blueprintNodeRegistry.isBuiltIn(def.type))
            .filter(def => !isBlueprintNodeAllowedInBlueprintValueGraph(def))
            .map(def => def.type)
            .sort();
        expect(refused).toEqual(Object.values(REFUSED).flat().sort());
    });
});
