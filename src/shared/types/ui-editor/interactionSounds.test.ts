import { describe, expect, it } from "vitest";
import { forEachUiAssetIdSlot } from "@shared/build/uiAssetSlots";
import {
    hasUIInteractionSounds,
    readUIInteractionSound,
    readUIInteractionSoundAssetId,
    uiElementTypeTakesInteractionSounds,
    uiInteractionSoundOptionsPatch,
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

    it("reads volume and track at their defaults as absent", () => {
        // Full volume and the SFX track are what a slot that says nothing plays at, so a stored
        // default is read the same as no option at all.
        expect(readUIInteractionSound({ props: { clickSound: { assetId: "c", volume: 1, audioTrackId: "sound" } } }, "click"))
            .toEqual({ assetId: "c" });
        expect(readUIInteractionSound({ props: { clickSound: { assetId: "c", volume: 0.4, audioTrackId: " ui " } } }, "click"))
            .toEqual({ assetId: "c", volume: 0.4, audioTrackId: "ui" });
    });

    it("clamps a volume into 0..1 and ignores one that is not a number", () => {
        expect(readUIInteractionSound({ props: { hoverSound: { assetId: "h", volume: 3 } } }, "hover")).toEqual({ assetId: "h" });
        expect(readUIInteractionSound({ props: { hoverSound: { assetId: "h", volume: -1 } } }, "hover")).toEqual({ assetId: "h", volume: 0 });
        expect(readUIInteractionSound({ props: { hoverSound: { assetId: "h", volume: "loud" } } }, "hover")).toEqual({ assetId: "h" });
    });

    it("reads no sound from a slot that has options but no file", () => {
        expect(readUIInteractionSound({ props: { clickSound: { volume: 0.5 } } }, "click")).toBeNull();
    });

    it("keeps a slot's options when another file is picked, and drops them with the sound", () => {
        const current = { assetId: "old", volume: 0.5, audioTrackId: "ui" };

        expect(uiInteractionSoundPatch("click", "new", current)).toEqual({
            clickSound: { assetId: "new", volume: 0.5, audioTrackId: "ui" },
        });
        expect(uiInteractionSoundPatch("click", null, current)).toEqual({ clickSound: undefined });
    });

    it("changes one option at a time, and stores none at its default", () => {
        const current = { assetId: "c", volume: 0.5, audioTrackId: "ui" };

        expect(uiInteractionSoundOptionsPatch(current, "click", { volume: 0.25 })).toEqual({
            clickSound: { assetId: "c", volume: 0.25, audioTrackId: "ui" },
        });
        expect(uiInteractionSoundOptionsPatch(current, "click", { volume: 1, audioTrackId: "sound" })).toEqual({
            clickSound: { assetId: "c" },
        });
        expect(uiInteractionSoundOptionsPatch(current, "click", { volume: null, audioTrackId: null })).toEqual({
            clickSound: { assetId: "c" },
        });
        expect(uiInteractionSoundOptionsPatch(null, "click", { volume: 0.5 })).toBeNull();
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
