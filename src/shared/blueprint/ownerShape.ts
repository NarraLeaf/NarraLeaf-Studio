import type { UIElementId, UISurfaceId } from "@shared/types/ui-editor/document";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";

/**
 * The two independent things `BlueprintOwnerRef.kind` has been answering at once.
 *
 * One enum has been made to say where a blueprint lives, how it is invoked, what it must return,
 * which host serves it and which elements it can address. Those are not one question, and the cost
 * of pretending shows up as sites that test for a kind when they mean something narrower - so a new
 * kind has to be added to a list nobody knew was a list.
 *
 * Nothing here is stored. Both are pure projections of the existing union, so this can be adopted a
 * site at a time with no migration, and the union stays exactly as it is.
 *
 * # The seam was already here
 *
 * `encodeBlueprintOwnerKey` excludes `mode` from an owner key, and its comment says why: `mode`
 * "says how the graph is consumed, not which slot this is". That is this split, drawn in the same
 * place, by code that had to get it right to work at all. What follows gives it a name.
 *
 * # Five anchors, not six
 *
 * `widgetMain` and `widgetValue` are the same address. One is the widget; the other is one prop of
 * that widget. Every anchor-side helper in the tree already treats them as one - the owner-key
 * surface test, the surface resolver, the surface-scope test, the `["surfaceMain", "widgetMain",
 * "widgetValue"]` node scope - and their entire difference is contract. `ownerLabels` goes further
 * and already gives `componentWidgetMain` the same translation key as `widgetMain`, on the ground
 * that naming them apart "would only ask them to tell two words apart that mean one thing".
 *
 * # Two contract fields, not eight
 *
 * How a graph re-runs, which frontends it admits, whether it may declare variables or Fns, and
 * which host adapter it gets are each a pure function of `invocation`. Giving them fields of their
 * own would spread one fact across five, which is the disease this exists to cure, inverted. They
 * are answered by predicates where a real cluster of callers asks - and where only one caller asks,
 * they stay where they are.
 */

/** Where a blueprint lives. Carries every id the position has, and nothing about how it is called. */
export type BlueprintAnchor =
    /** The project itself: `globalMain`. */
    | { kind: "project" }
    /** A surface's own graph: `surfaceMain`. */
    | { kind: "surface"; surfaceId: UISurfaceId }
    /**
     * An element on a surface: `widgetMain` when `prop` is absent, `widgetValue` when it is present.
     *
     * One position rather than two, because it is one address. `prop` is what the blueprint is
     * attached to *on* that element, not a different place for it to be.
     */
    | { kind: "surfaceElement"; surfaceId: UISurfaceId; elementId: UIElementId; prop?: string }
    /** An element inside a component definition: `componentWidgetMain`. Has no surface. */
    | { kind: "componentElement"; componentId: string; elementId: UIElementId }
    /** A story row, which is its own key: `storyAction`. */
    | { kind: "storyRow"; blueprintId: string };

/**
 * Where a blueprint's Fns and member variables are visible from.
 *
 * A named type rather than an accessor's return value, and deliberately: one caller has no anchor
 * at all. `BlueprintDispatcher` fabricates `{ kind: "widgetMain", surfaceId, elementId: "" }` - a
 * blueprint that does not exist, with an empty element id - purely to ask a visibility question. It
 * can construct a scope directly instead, which is the thing it actually has.
 *
 * The lattice is containment - project ⊃ surface ⊃ component - except story, which is its own pool.
 */
export type BlueprintScope =
    | { kind: "project" }
    | { kind: "surface"; surfaceId: UISurfaceId }
    | { kind: "component"; componentId: string }
    | { kind: "story" };

/**
 * How a graph is entered and what its caller does with the result.
 *
 * Two fields because neither follows from the other: a story call may return nothing, a value or a
 * boolean, and a value may be returned to a story call or to a value binding. Everything else about
 * a slot follows from these.
 */
export type BlueprintContract = {
    /** How the graph is entered. */
    invocation: "uiEvent" | "valueBinding" | "storyCall";
    /** What the caller does with the Return Value. */
    returns: "none" | "value" | "boolean";
};

/** Where this blueprint lives. */
export function blueprintAnchor(owner: BlueprintOwnerRef): BlueprintAnchor {
    switch (owner.kind) {
        case "globalMain":
            return { kind: "project" };
        case "surfaceMain":
            return { kind: "surface", surfaceId: owner.surfaceId };
        case "widgetMain":
            return { kind: "surfaceElement", surfaceId: owner.surfaceId, elementId: owner.elementId };
        case "widgetValue":
            return {
                kind: "surfaceElement",
                surfaceId: owner.surfaceId,
                elementId: owner.elementId,
                prop: owner.propPath,
            };
        case "componentWidgetMain":
            return { kind: "componentElement", componentId: owner.componentId, elementId: owner.elementId };
        case "storyAction":
            return { kind: "storyRow", blueprintId: owner.blueprintId };
        default: {
            const unplaced: never = owner;
            return unplaced;
        }
    }
}

/**
 * How this blueprint is called.
 *
 * `mode` is absent on most story owners and means `"action"` when it is; no site anywhere tests for
 * `"action"` explicitly, every one of the four that read `mode` tests for one of the other two, and
 * nothing ever writes `mode` after the blueprint is created. So normalising it here is safe and
 * removes the last place a caller has to remember the default.
 */
export function blueprintContract(owner: BlueprintOwnerRef): BlueprintContract {
    switch (owner.kind) {
        case "globalMain":
        case "surfaceMain":
        case "widgetMain":
        case "componentWidgetMain":
            return { invocation: "uiEvent", returns: "none" };
        case "widgetValue":
            return { invocation: "valueBinding", returns: "value" };
        case "storyAction":
            switch (owner.mode ?? "action") {
                case "value":
                    return { invocation: "storyCall", returns: "value" };
                case "condition":
                    return { invocation: "storyCall", returns: "boolean" };
                default:
                    return { invocation: "storyCall", returns: "none" };
            }
        default: {
            const uncalled: never = owner;
            return uncalled;
        }
    }
}

/** Where this blueprint's Fns and member variables are visible from. */
export function blueprintScope(owner: BlueprintOwnerRef): BlueprintScope {
    const anchor = blueprintAnchor(owner);
    switch (anchor.kind) {
        case "project":
            return { kind: "project" };
        case "surface":
        case "surfaceElement":
            return { kind: "surface", surfaceId: anchor.surfaceId };
        case "componentElement":
            return { kind: "component", componentId: anchor.componentId };
        case "storyRow":
            return { kind: "story" };
        default: {
            const unscoped: never = anchor;
            return unscoped;
        }
    }
}

/**
 * The surface this blueprint lives on, or null when it lives somewhere that is not one.
 *
 * Null for the project, for a component definition - which is drawn on whatever surface instantiates
 * it - and for a story row. Several callers used to substitute a sentinel or a `component-editor:`
 * pseudo-id here, which then had to be recognised again downstream.
 */
export function anchorSurfaceId(owner: BlueprintOwnerRef): UISurfaceId | null {
    const anchor = blueprintAnchor(owner);
    return anchor.kind === "surface" || anchor.kind === "surfaceElement" ? anchor.surfaceId : null;
}

/**
 * The element this blueprint hangs off, or null when it hangs off no element.
 *
 * One answer, because there were three. Three live spellings of this question disagreed about which
 * kinds count: one took the surface widget and its value bindings, one took the surface widget and
 * the component widget, and one took all three. All three are elements; that is the whole question.
 */
export function anchorElementId(owner: BlueprintOwnerRef): UIElementId | null {
    const anchor = blueprintAnchor(owner);
    return anchor.kind === "surfaceElement" || anchor.kind === "componentElement" ? anchor.elementId : null;
}

/** The component definition this blueprint lives inside, or null. */
export function anchorComponentId(owner: BlueprintOwnerRef): string | null {
    const anchor = blueprintAnchor(owner);
    return anchor.kind === "componentElement" ? anchor.componentId : null;
}

/**
 * A widget's own event graph - on a surface or inside a component definition.
 *
 * Named because it spans both axes and neither half is enough. It is not "the anchor has an
 * element": a value binding has one too. It is not "the graph is entered by a UI event": a surface
 * and the project are as well. It is the conjunction, and it is asked in eight places, every one of
 * which spelled it as a two-kind comparison that a new anchor position would have silently missed.
 */
export function isWidgetEventGraph(owner: BlueprintOwnerRef): boolean {
    return anchorElementId(owner) !== null && blueprintContract(owner).invocation === "uiEvent";
}
