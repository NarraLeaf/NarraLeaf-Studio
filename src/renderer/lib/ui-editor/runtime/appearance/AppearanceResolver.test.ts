import { describe, expect, it } from "vitest";
import type {
    AppearanceModel,
    AppearancePropertyGroup,
    AppearanceValueRow,
} from "@shared/types/ui-editor/appearance";
import type { GradientFill } from "@shared/types/ui-editor/gradientFill";
import { defaultContainerWidgetProps } from "@shared/types/ui-editor/container";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";
import {
    createInitialButtonAppearance,
    createInitialContainerAppearance,
    createInitialImageAppearance,
    ensureButtonAppearanceHasAllKeys,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "./SystemInteractionState";
import {
    resolveButtonVisualProps,
    resolveContainerRectangleLike,
    resolveImageAppearanceTransitions,
    resolveImageRectangleLike,
} from "./AppearanceResolver";

function buttonElement(appearance: AppearanceModel): UIElement {
    return {
        id: "button",
        type: "nl.button",
        name: "Button",
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 160, height: 48 },
        props: {
            ...defaultButtonWidgetProps,
            appearance,
        },
    };
}

function cursorGroup(model: AppearanceModel): AppearancePropertyGroup | undefined {
    return model.variants[0]?.propertyGroups.find(group => group.key === "cursor");
}

function textShadowGroup(model: AppearanceModel): AppearancePropertyGroup | undefined {
    return model.variants[0]?.propertyGroups.find(group => group.key === "effectTextShadow");
}

describe("button appearance cursor", () => {
    it("seeds new button appearance models with auto cursor", () => {
        const appearance = createInitialButtonAppearance(defaultButtonWidgetProps);

        expect(cursorGroup(appearance)?.rows[0]?.value).toBe("auto");
    });

    it("adds cursor to older button appearance models", () => {
        const oldModel = createInitialButtonAppearance(defaultButtonWidgetProps);
        const withoutCursor: AppearanceModel = {
            ...oldModel,
            variants: oldModel.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.filter(group => group.key !== "cursor"),
            })),
        };

        const next = ensureButtonAppearanceHasAllKeys(withoutCursor, defaultButtonWidgetProps);

        expect(cursorGroup(next)?.rows[0]?.value).toBe("auto");
    });

    it("resolves cursor from the active button variant", () => {
        const base = createInitialButtonAppearance(defaultButtonWidgetProps);
        const appearance: AppearanceModel = {
            ...base,
            variants: base.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.map(group =>
                    group.key === "cursor"
                        ? { ...group, rows: [{ conditions: null, value: "crosshair" }] }
                        : group
                ),
            })),
        };

        const resolved = resolveButtonVisualProps(buttonElement(appearance), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.cursor).toBe("crosshair");
    });
});

describe("button appearance text shadow", () => {
    it("seeds new button appearance models with text shadow", () => {
        const appearance = createInitialButtonAppearance(defaultButtonWidgetProps);

        expect(textShadowGroup(appearance)?.rows[0]?.value).toBeNull();
    });

    it("adds text shadow to older button appearance models", () => {
        const oldModel = createInitialButtonAppearance(defaultButtonWidgetProps);
        const withoutTextShadow: AppearanceModel = {
            ...oldModel,
            variants: oldModel.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.filter(group => group.key !== "effectTextShadow"),
            })),
        };

        const next = ensureButtonAppearanceHasAllKeys(withoutTextShadow, defaultButtonWidgetProps);

        expect(textShadowGroup(next)?.rows[0]?.value).toBeNull();
    });

    it("resolves text shadow from the active button variant", () => {
        const shadow = {
            storage: "layer",
            layer: {
                offsetX: 2,
                offsetY: 3,
                blur: 4,
                spread: 0,
                color: "rgba(0, 0, 0, 0.5)",
            },
        };
        const base = createInitialButtonAppearance(defaultButtonWidgetProps);
        const appearance: AppearanceModel = {
            ...base,
            variants: base.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.map(group =>
                    group.key === "effectTextShadow"
                        ? { ...group, rows: [{ conditions: null, value: shadow }] }
                        : group
                ),
            })),
        };

        const resolved = resolveButtonVisualProps(buttonElement(appearance), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.effects.effectTextShadow).toEqual(shadow);
    });
});

/**
 * Both of these fail silently rather than loudly, which is why they are pinned here. A `fillType`
 * the resolver does not recognise is dropped and the flat prop wins, so the widget paints the fill
 * it had before - correct-looking output for the wrong reason - and a `gradientFill` row with no
 * `case` for it is simply never read.
 */
describe("gradient fill through appearance variants", () => {
    const gradient: GradientFill = {
        kind: "linear",
        angle: 90,
        stops: [
            { offset: 0, color: "nlbrand:primary" },
            { offset: 1, color: "#000000" },
        ],
    };

    function withRows(
        base: AppearanceModel,
        rows: Partial<Record<string, AppearanceValueRow["value"]>>
    ): AppearanceModel {
        return {
            ...base,
            variants: base.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.map(group =>
                    group.key in rows
                        ? { ...group, rows: [{ conditions: null, value: rows[group.key] ?? null }] }
                        : group
                ),
            })),
        };
    }

    function containerElement(appearance: AppearanceModel): UIElement {
        return {
            id: "container",
            type: "nl.container",
            name: "Container",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 200, height: 120 },
            props: { ...defaultContainerWidgetProps, appearance },
        };
    }

    it("keeps a button variant that pins fillType to gradient", () => {
        const appearance = withRows(createInitialButtonAppearance(defaultButtonWidgetProps), {
            fillType: "gradient",
            gradientFill: gradient,
        });

        const resolved = resolveButtonVisualProps(buttonElement(appearance), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.fillType).toBe("gradient");
        expect(resolved.gradientFill).toEqual(gradient);
    });

    it("keeps a container variant that pins fillType to gradient", () => {
        const appearance = withRows(createInitialContainerAppearance(defaultContainerWidgetProps), {
            fillType: "gradient",
            gradientFill: gradient,
        });

        const resolved = resolveContainerRectangleLike(containerElement(appearance), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.fillType).toBe("gradient");
        expect(resolved.gradientFill).toEqual(gradient);
    });

    it("resolves a hover-state gradient through the same variant machinery as any other row", () => {
        const hoverGradient: GradientFill = { ...gradient, kind: "radial", stops: [...gradient.stops] };
        const base = createInitialContainerAppearance(defaultContainerWidgetProps);
        const appearance: AppearanceModel = {
            ...base,
            variants: base.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.map(group =>
                    group.key === "gradientFill"
                        ? {
                              ...group,
                              rows: [
                                  { conditions: null, value: gradient },
                                  { conditions: { hovered: true }, value: hoverGradient },
                              ],
                          }
                        : group
                ),
            })),
        };

        const resolved = resolveContainerRectangleLike(containerElement(appearance), appearance, {
            signals: { ...DEFAULT_SYSTEM_INTERACTION_SIGNALS, hovered: true },
        });

        expect(resolved.gradientFill?.kind).toBe("radial");
    });

    it("leaves the baseline standing for a fill kind this build cannot paint", () => {
        const appearance = withRows(createInitialButtonAppearance(defaultButtonWidgetProps), {
            fillType: "mesh",
        });

        const resolved = resolveButtonVisualProps(buttonElement(appearance), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.fillType).toBe(defaultButtonWidgetProps.fillType);
    });

    // `null` and `undefined` are two different instructions, exactly as they are for `imageFill`: a
    // row holding `null` says this variant has no gradient and must overwrite an inherited one,
    // where an absent or unreadable row says nothing and leaves the baseline alone.
    it("clears an inherited gradient for a row holding null", () => {
        const flat = { ...defaultContainerWidgetProps, fillType: "gradient" as const, gradientFill: gradient };
        const appearance = withRows(createInitialContainerAppearance(flat), { gradientFill: null });
        const element: UIElement = {
            id: "container",
            type: "nl.container",
            name: "Container",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 200, height: 120 },
            props: { ...flat, appearance },
        };

        const resolved = resolveContainerRectangleLike(element, appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.gradientFill).toBeNull();
    });

    it("leaves the baseline standing for a gradient row with no honest reading", () => {
        const appearance = withRows(createInitialContainerAppearance(defaultContainerWidgetProps), {
            gradientFill: { kind: "mesh", stops: [] },
        });

        const resolved = resolveContainerRectangleLike(containerElement(appearance), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.gradientFill).toBeUndefined();
    });

    it("repairs a stored gradient rather than refusing it", () => {
        const appearance = withRows(createInitialContainerAppearance(defaultContainerWidgetProps), {
            gradientFill: {
                kind: "linear",
                stops: [
                    { offset: 1, color: "#ffffff" },
                    { offset: 0, color: "#000000" },
                ],
            },
        });

        const resolved = resolveContainerRectangleLike(containerElement(appearance), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.gradientFill?.stops.map(stop => stop.color)).toEqual(["#000000", "#ffffff"]);
    });
});

/**
 * `fillOpacity` is the one key an image fill does not own: for an image it is animated as the
 * Displayable's own opacity, so the resolver skips it. A gradient's fill opacity is a fill alpha in
 * exactly the way a colour's is, so the gate is "not image" - reading it as "is colour" would drop
 * an authored gradient opacity on the floor.
 */
describe("fill opacity is a fill alpha for every fill but an image", () => {
    function imageElement(appearance: AppearanceModel, fillType: string): UIElement {
        return {
            id: "image",
            type: "nl.image",
            name: "Image",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 200, height: 120 },
            props: { fillType, appearance },
        };
    }

    function withFillOpacity(fillType: string, opacity: number): AppearanceModel {
        const base = createInitialImageAppearance(
            getRectangleLikeProps({ props: { fillType } })
        );
        return {
            ...base,
            variants: base.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.map(group =>
                    group.key === "fillOpacity"
                        ? { ...group, rows: [{ conditions: null, value: opacity }] }
                        : group
                ),
            })),
        };
    }

    it("applies an authored fill opacity to a gradient fill", () => {
        const appearance = withFillOpacity("gradient", 0.4);

        const resolved = resolveImageRectangleLike(imageElement(appearance, "gradient"), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.fillType).toBe("gradient");
        expect(resolved.fillOpacity).toBe(0.4);
    });

    it("still withholds it from an image fill", () => {
        const appearance = withFillOpacity("image", 0.4);

        const resolved = resolveImageRectangleLike(imageElement(appearance, "image"), appearance, {
            signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
        });

        expect(resolved.fillOpacity).toBe(1);
    });

    it("keeps a fill opacity transition for a gradient and drops it for an image", () => {
        const base = createInitialImageAppearance(getRectangleLikeProps({ props: {} }));
        const appearance: AppearanceModel = {
            ...base,
            variants: base.variants.map(variant => ({
                ...variant,
                propertyGroups: variant.propertyGroups.map(group =>
                    group.key === "fillOpacity"
                        ? {
                              ...group,
                              transition: { type: "tween", durationMs: 120, easing: "easeOut" } as const,
                          }
                        : group
                ),
            })),
        };
        const ctx = { signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS };

        expect(
            resolveImageAppearanceTransitions(appearance, ctx, { fillType: "gradient" })?.fillOpacity
        ).toBeDefined();
        expect(
            resolveImageAppearanceTransitions(appearance, ctx, { fillType: "image" })?.fillOpacity
        ).toBeUndefined();
    });
});
