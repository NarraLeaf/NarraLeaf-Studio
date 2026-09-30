import { describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { isBlueprintValueGraphOwner, isStorySyncValueOwner } from "@shared/types/blueprint/document";
import {
    anchorComponentId,
    anchorElementId,
    anchorSurfaceId,
    blueprintAnchor,
    blueprintContract,
    blueprintScope,
    isWidgetEventGraph,
} from "./ownerShape";

/** Every owner shape, including all three story modes and the absent one. */
const OWNERS = {
    project: { kind: "globalMain" },
    surface: { kind: "surfaceMain", surfaceId: "s-1" },
    widget: { kind: "widgetMain", surfaceId: "s-1", elementId: "e-1" },
    binding: { kind: "widgetValue", surfaceId: "s-1", elementId: "e-1", propPath: "label" },
    component: { kind: "componentWidgetMain", componentId: "c-1", elementId: "e-1" },
    storyDefault: { kind: "storyAction", blueprintId: "b-1" },
    storyAction: { kind: "storyAction", blueprintId: "b-1", mode: "action" },
    storyValue: { kind: "storyAction", blueprintId: "b-1", mode: "value" },
    storyCondition: { kind: "storyAction", blueprintId: "b-1", mode: "condition" },
} satisfies Record<string, BlueprintOwnerRef>;

const ALL = Object.values(OWNERS) as BlueprintOwnerRef[];

describe("the anchor", () => {
    it("puts a widget and one of its value bindings at the same address", () => {
        // The one structural claim this split makes. They are the same element; the binding names a
        // prop of it. Every anchor-side helper in the tree already behaved this way and had to spell
        // the two kinds out to do it.
        const widget = blueprintAnchor(OWNERS.widget);
        const binding = blueprintAnchor(OWNERS.binding);

        expect(widget.kind).toBe("surfaceElement");
        expect(binding.kind).toBe("surfaceElement");
        expect(anchorSurfaceId(OWNERS.binding)).toBe(anchorSurfaceId(OWNERS.widget));
        expect(anchorElementId(OWNERS.binding)).toBe(anchorElementId(OWNERS.widget));
    });

    it("keeps the prop, so the two are still told apart", () => {
        // Collapsing the position must not lose the thing that distinguishes them, or the split
        // would be a one-way door: the stored union has to remain reconstructible.
        expect(blueprintAnchor(OWNERS.widget)).not.toHaveProperty("prop");
        expect(blueprintAnchor(OWNERS.binding)).toMatchObject({ prop: "label" });
    });

    it("answers null rather than a sentinel where there is no surface", () => {
        // Callers used to substitute an empty string, or a `component-editor:` pseudo-id, which then
        // had to be recognised again downstream.
        expect(anchorSurfaceId(OWNERS.surface)).toBe("s-1");
        expect(anchorSurfaceId(OWNERS.widget)).toBe("s-1");
        expect(anchorSurfaceId(OWNERS.project)).toBeNull();
        expect(anchorSurfaceId(OWNERS.component)).toBeNull();
        expect(anchorSurfaceId(OWNERS.storyDefault)).toBeNull();
    });

    it("counts every element as an element, which the three old spellings did not", () => {
        expect(anchorElementId(OWNERS.widget)).toBe("e-1");
        expect(anchorElementId(OWNERS.binding)).toBe("e-1");
        expect(anchorElementId(OWNERS.component)).toBe("e-1");
        expect(anchorElementId(OWNERS.surface)).toBeNull();
        expect(anchorElementId(OWNERS.project)).toBeNull();
    });

    it("names a component only where there is one", () => {
        expect(anchorComponentId(OWNERS.component)).toBe("c-1");
        expect(anchorComponentId(OWNERS.widget)).toBeNull();
    });
});

describe("the contract", () => {
    it("reads an absent story mode as an action", () => {
        // No site anywhere tests `mode === "action"`, all four that read it test for one of the other
        // two, and nothing writes it after creation - so normalising here is safe and removes the
        // last place a caller has to remember the default.
        expect(blueprintContract(OWNERS.storyDefault)).toEqual(blueprintContract(OWNERS.storyAction));
    });

    it("separates how a graph is entered from what it returns", () => {
        // The reason these are two fields: a value can come back from either a story call or a value
        // binding, and a story call can return nothing, a value or a boolean. Neither determines the
        // other, so neither can be folded away.
        expect(blueprintContract(OWNERS.binding)).toEqual({ invocation: "valueBinding", returns: "value" });
        expect(blueprintContract(OWNERS.storyValue)).toEqual({ invocation: "storyCall", returns: "value" });
        expect(blueprintContract(OWNERS.storyCondition)).toEqual({ invocation: "storyCall", returns: "boolean" });
        expect(blueprintContract(OWNERS.storyAction)).toEqual({ invocation: "storyCall", returns: "none" });
    });

    it("agrees with the two predicates that already answered halves of it", () => {
        // These two carry reasoning worth keeping and are not being replaced. What must not happen is
        // a third answer that quietly differs - the last time that happened, `Get Scene Var` was
        // offered in a story condition and then permanently refused.
        for (const owner of ALL) {
            const contract = blueprintContract(owner);
            expect(isBlueprintValueGraphOwner(owner)).toBe(contract.invocation === "valueBinding");
            expect(isStorySyncValueOwner(owner))
                .toBe(contract.invocation === "storyCall" && contract.returns !== "none");
        }
    });
});

describe("a widget's own event graph", () => {
    it("is the conjunction, and neither half alone", () => {
        // Not "has an element": a value binding has one. Not "entered by a UI event": a surface and
        // the project are too. Eight sites spelled this as a two-kind comparison.
        expect(isWidgetEventGraph(OWNERS.widget)).toBe(true);
        expect(isWidgetEventGraph(OWNERS.component)).toBe(true);
        expect(isWidgetEventGraph(OWNERS.binding)).toBe(false);
        expect(isWidgetEventGraph(OWNERS.surface)).toBe(false);
        expect(isWidgetEventGraph(OWNERS.project)).toBe(false);
        expect(isWidgetEventGraph(OWNERS.storyDefault)).toBe(false);
    });
});

describe("the scope", () => {
    it("puts a widget and its surface in the same pool, and a story in its own", () => {
        expect(blueprintScope(OWNERS.widget)).toEqual({ kind: "surface", surfaceId: "s-1" });
        expect(blueprintScope(OWNERS.binding)).toEqual({ kind: "surface", surfaceId: "s-1" });
        expect(blueprintScope(OWNERS.surface)).toEqual({ kind: "surface", surfaceId: "s-1" });
        expect(blueprintScope(OWNERS.component)).toEqual({ kind: "component", componentId: "c-1" });
        expect(blueprintScope(OWNERS.project)).toEqual({ kind: "project" });
        expect(blueprintScope(OWNERS.storyValue)).toEqual({ kind: "story" });
    });
});

describe("both projections", () => {
    it("answer for every owner without throwing", () => {
        // The exhaustiveness guards are compile-time; this is the runtime half, so a shape reaching
        // them from disk cannot fall past the last case and return the owner object - which is
        // exactly how removing a union member nearly refused every document that carried one.
        for (const owner of ALL) {
            expect(typeof blueprintAnchor(owner).kind).toBe("string");
            expect(typeof blueprintContract(owner).invocation).toBe("string");
            expect(typeof blueprintScope(owner).kind).toBe("string");
        }
    });
});
