import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_EVENTS_DISABLED_ATTR,
    shouldHandleBlueprintElementEvent,
} from "./blueprintEventTargeting";

type FakeElement = EventTarget & {
    closest: (selectors: string) => FakeElement | null;
    getAttribute: (qualifiedName: string) => string | null;
    contains: (other: FakeElement) => boolean;
};

const elementSelector = "[data-ui-element-id]";
const disabledSelector = `[${BLUEPRINT_EVENTS_DISABLED_ATTR}="true"]`;

function createFakeElement(options?: {
    elementId?: string;
    disabledRoot?: FakeElement | null;
    contains?: (other: FakeElement) => boolean;
}): FakeElement {
    const el = {
        closest: (selector: string) => {
            if (selector === elementSelector) {
                return options?.elementId != null ? owner : null;
            }
            if (selector === disabledSelector) {
                return options?.disabledRoot ?? null;
            }
            return null;
        },
        getAttribute: (name: string) => {
            if (name === "data-ui-element-id") {
                return options?.elementId ?? null;
            }
            return null;
        },
        contains: (other: FakeElement) => options?.contains?.(other) ?? false,
    } as FakeElement;
    const owner = el;
    return el;
}

describe("blueprint event targeting", () => {
    it("handles events owned by the current UI element", () => {
        const target = createFakeElement({ elementId: "button" });

        expect(shouldHandleBlueprintElementEvent(target, "button")).toBe(true);
    });

    it("ignores events owned by a nested UI element", () => {
        const target = createFakeElement({ elementId: "child" });

        expect(shouldHandleBlueprintElementEvent(target, "button")).toBe(false);
    });

    it("ignores events inside a disabled blueprint event subtree", () => {
        const disabledRoot = createFakeElement({ elementId: "button" });
        const target = createFakeElement({
            elementId: "button",
            disabledRoot,
            contains: other => other === disabledRoot,
        });

        expect(shouldHandleBlueprintElementEvent(target, "button")).toBe(false);
    });
});
