import { beforeAll, describe, expect, it } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { UI_SWITCH_ON_VARIANT_ID } from "@shared/types/ui-editor/switch";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { currentStateOffset, readStatePosition, splitStateAwareLayoutPatches } from "./stateGeometry";

const ON = { surfaceId: "s1", elementId: "switch", variantId: UI_SWITCH_ON_VARIANT_ID };
const RESTING = { surfaceId: "s1", elementId: "switch", variantId: null };

function offsetModel(onX: number): AppearanceModel {
    return {
        defaultVariantId: "v-default",
        variants: [
            {
                id: "v-default",
                name: "Default",
                propertyGroups: [
                    { key: "transformOffsetX", rows: [{ conditions: null, value: 0 }] },
                    { key: "transformOffsetY", rows: [{ conditions: null, value: 0 }] },
                ],
            },
            {
                id: UI_SWITCH_ON_VARIANT_ID,
                name: "On",
                propertyGroups: [
                    { key: "transformOffsetX", rows: [{ conditions: null, value: onX }] },
                    { key: "transformOffsetY", rows: [{ conditions: null, value: 0 }] },
                ],
            },
        ],
    };
}

function documentWith(thumbProps: Record<string, unknown>, switchProps: Record<string, unknown> = {}): UIDocument {
    const make = (id: string, type: string, parentId: string | null, props: Record<string, unknown>): UIElement => ({
        id,
        type,
        name: id,
        parentId,
        childrenIds: [],
        layout: { x: 3, y: 3, width: 22, height: 22, opacity: 1, visible: true },
        props,
    });
    const thumb = make("thumb", "nl.container", "switch", thumbProps);
    const sw = make("switch", "nl.switch", "root", switchProps);
    sw.childrenIds = ["thumb"];
    return {
        version: 1,
        surfaces: [],
        elements: { switch: sw, thumb },
    } as unknown as UIDocument;
}

function variantOffsetX(model: AppearanceModel, variantId: string): unknown {
    return model.variants
        .find(variant => variant.id === variantId)
        ?.propertyGroups.find(group => group.key === "transformOffsetX")?.rows[0]?.value;
}

beforeAll(() => {
    widgetModuleRegistry.register({
        type: "nl.switch",
        displayName: "Switch",
        icon: (() => null) as unknown as UIWidgetModule["icon"],
        createDefaultElement: () => ({}),
        listEditorStates: () => [
            { id: null, name: "Off" },
            { id: UI_SWITCH_ON_VARIANT_ID, name: "On" },
        ],
        render: () => null,
    });
});

describe("reading a position in a state", () => {
    it("reads the held position, not the resting one", () => {
        const document = documentWith({ appearance: offsetModel(24) });

        expect(currentStateOffset(document, ON, "thumb")).toEqual({ x: 24, y: 0 });
        // 3 is where it rests; 27 is where it is while the switch is on, and 27 is what is on screen.
        expect(readStatePosition(document, ON, "thumb")).toEqual({ x: 27, y: 3 });
    });

    it("reads nothing at all when no state is holding it", () => {
        const document = documentWith({ appearance: offsetModel(24) });

        expect(currentStateOffset(document, RESTING, "thumb")).toBeNull();
        expect(currentStateOffset(document, null, "thumb")).toBeNull();
    });
});

describe("splitStateAwareLayoutPatches", () => {
    it("puts a move made in a state into that state and leaves the resting position alone", () => {
        const document = documentWith({ appearance: offsetModel(24) });

        // The caller passes where the element should end up, in the same space as `layout`.
        const split = splitStateAwareLayoutPatches(document, ON, { thumb: { x: 35, y: 3 } });

        expect(split.layoutPatches.thumb).toBeUndefined();
        expect(variantOffsetX(split.appearancePatches.thumb, UI_SWITCH_ON_VARIANT_ID)).toBe(32);
        expect(variantOffsetX(split.appearancePatches.thumb, "v-default")).toBe(0);
    });

    it("writes the layout while the resting state is the one being shown", () => {
        const document = documentWith({ appearance: offsetModel(24) });

        const split = splitStateAwareLayoutPatches(document, RESTING, { thumb: { x: 9, y: 3 } });

        // Resting *is* the shared geometry: there is nothing layered over it to edit instead.
        expect(split.layoutPatches.thumb).toEqual({ x: 9, y: 3 });
        expect(split.appearancePatches.thumb).toBeUndefined();
    });

    it("keeps size on the element, whatever state is being shown", () => {
        const document = documentWith({ appearance: offsetModel(24) });

        const split = splitStateAwareLayoutPatches(document, ON, { thumb: { x: 35, width: 40 } });

        expect(split.layoutPatches.thumb).toEqual({ width: 40 });
        expect(variantOffsetX(split.appearancePatches.thumb, UI_SWITCH_ON_VARIANT_ID)).toBe(32);
    });

    it("gives the state a variant of its own the first time something is moved in it", () => {
        const document = documentWith({
            appearance: {
                defaultVariantId: "v-default",
                variants: [
                    {
                        id: "v-default",
                        name: "Default",
                        propertyGroups: [{ key: "backgroundColor", rows: [{ conditions: null, value: "#fff" }] }],
                    },
                ],
            } satisfies AppearanceModel,
        });

        const split = splitStateAwareLayoutPatches(document, ON, { thumb: { x: 20 } });
        const next = split.appearancePatches.thumb;

        // An element dropped into a switch after the fact has no `on` variant; the first edit made
        // while looking at that state is what gives it one, cloned from what is on screen.
        expect(next.variants.map(variant => variant.id)).toEqual(["v-default", UI_SWITCH_ON_VARIANT_ID]);
        expect(variantOffsetX(next, UI_SWITCH_ON_VARIANT_ID)).toBe(17);
    });

    it("migrates a part the host still moves the old way, timing included", () => {
        const document = documentWith(
            { appearance: offsetModel(0) },
            {
                stateMotions: [
                    {
                        state: UI_SWITCH_ON_VARIANT_ID,
                        target: "thumb",
                        offsetX: 24,
                        offsetY: 0,
                        durationMs: 240,
                        easing: "circOut",
                    },
                ],
            },
        );

        const split = splitStateAwareLayoutPatches(document, ON, { thumb: { x: 35 } });

        // Both in place would let the host's offset win and the drag would look like it did nothing.
        expect(split.stateMotionPatches.switch).toEqual([]);
        expect(variantOffsetX(split.appearancePatches.thumb, UI_SWITCH_ON_VARIANT_ID)).toBe(32);
        for (const variant of split.appearancePatches.thumb.variants) {
            expect(variant.propertyGroups.find(group => group.key === "transformOffsetX")?.transition).toEqual({
                type: "tween",
                durationMs: 240,
                delayMs: 0,
                easing: "circOut",
            });
        }
    });
});
