import { describe, expect, it } from "vitest";
import type { AppearanceModel, AppearancePropertyGroup } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import { defaultButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";
import {
    createInitialButtonAppearance,
    ensureButtonAppearanceHasAllKeys,
} from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "./SystemInteractionState";
import { resolveButtonVisualProps } from "./AppearanceResolver";

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
