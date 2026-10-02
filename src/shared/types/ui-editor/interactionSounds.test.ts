import { describe, expect, it } from "vitest";
import { forEachUiAssetIdSlot } from "@shared/build/uiAssetSlots";
import {
    hasUIInteractionSounds,
    readUIInteractionSoundAssetId,
    uiElementTypeTakesInteractionSounds,
    uiInteractionSoundPatch,
} from "./interactionSounds";

describe("interaction sounds", () => {
    it("reads each gesture's sound off its own prop", () => {
        const element = { props: { hoverSound: { assetId: " hover-1 " }, clickSound: { assetId: "click-1" } } };

        expect(readUIInteractionSoundAssetId(element, "hover")).toBe("hover-1");
        expect(readUIInteractionSoundAssetId(element, "click")).toBe("click-1");
        expect(hasUIInteractionSounds(element)).toBe(true);
    });

    it("reads nothing from an element that was never given one, or whose slot is blank", () => {
        expect(readUIInteractionSoundAssetId({ props: {} }, "click")).toBeNull();
        expect(readUIInteractionSoundAssetId({ props: { clickSound: { assetId: "  " } } }, "click")).toBeNull();
        expect(readUIInteractionSoundAssetId({ props: { clickSound: "click-1" } }, "click")).toBeNull();
        expect(readUIInteractionSoundAssetId(undefined, "hover")).toBeNull();
        expect(hasUIInteractionSounds({ props: { label: "Start" } })).toBe(false);
    });

    it("clears a slot by leaving no key behind once saved", () => {
        const props: Record<string, unknown> = { label: "Start", ...uiInteractionSoundPatch("click", "click-1") };
        expect(props.clickSound).toEqual({ assetId: "click-1" });

        const cleared = { ...props, ...uiInteractionSoundPatch("click", null) };
        expect(JSON.parse(JSON.stringify(cleared))).toEqual({ label: "Start" });
        expect(uiInteractionSoundPatch("hover", "  ")).toEqual({ hoverSound: undefined });
    });

    it("is offered on every element but a surface's root", () => {
        expect(uiElementTypeTakesInteractionSounds("nl.button")).toBe(true);
        expect(uiElementTypeTakesInteractionSounds("nl.container")).toBe(true);
        expect(uiElementTypeTakesInteractionSounds("acme.rating.meter")).toBe(true);
        expect(uiElementTypeTakesInteractionSounds("nl.root")).toBe(false);
    });

    /**
     * The reason the slot is `{ assetId }` and not a bare string. The build, the preloader, the
     * reference index and the shipped-content audit find library ids by that property name, so a
     * sound stored any other way would be an asset none of them knows a page uses.
     */
    it("stores each sound where the build's asset walk finds it", () => {
        const props = { ...uiInteractionSoundPatch("hover", "hover-1"), ...uiInteractionSoundPatch("click", "click-1") };
        const found: string[] = [];
        forEachUiAssetIdSlot(props, slot => {
            const id = slot.read();
            if (id) {
                found.push(id);
            }
        });

        expect(found.sort()).toEqual(["click-1", "hover-1"]);
    });
});
