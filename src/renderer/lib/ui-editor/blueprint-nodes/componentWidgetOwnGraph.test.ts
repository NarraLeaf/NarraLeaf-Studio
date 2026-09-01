import { describe, expect, it } from "vitest";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInGraphContext } from "./BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "./registerCoreBlueprintNodes";
import { buildBlueprintGraphContext } from "./graphContext";

/**
 * A component definition's widget graph can act on its own widget, and a surface's can too.
 *
 * These were not the same for a long time, and the difference was a leftover rather than a rule. A
 * component's slider could hear its own click and then do nothing about it: every node that acts on
 * the widget its graph belongs to named only the surface owner.
 *
 * The runtime had already been rebuilt for this. A component instance addresses its widgets through
 * a widget address - the element id plus the instance key - and both write paths go through it, so
 * the same setter that drives a surface widget drives one inside a component and writes to the
 * instance rather than to the definition every instance shares. Only the palette had not been told.
 */

const SURFACE_WIDGET: BlueprintOwnerRef = { kind: "widgetMain", surfaceId: "s-1", elementId: "e-1" };
const COMPONENT_WIDGET: BlueprintOwnerRef = { kind: "componentWidgetMain", componentId: "c-1", elementId: "e-1" };

function allowed(owner: BlueprintOwnerRef, widgetElementType: string): Set<string> {
    const context = buildBlueprintGraphContext({
        graphKind: "event",
        owner,
        widgetElementType,
        isComponentDefinitionGraph: owner.kind === "componentWidgetMain",
    });
    return new Set(
        blueprintNodeRegistry.list()
            .filter(def => isBlueprintNodeAllowedInGraphContext(def, context))
            .map(def => def.type),
    );
}

/**
 * What a component definition still cannot reach, and why each one is not the same question.
 *
 * None of these is "this widget acting on itself". The first two address a **different** element;
 * the broadcast pair and the keyboard heads are about something outside the widget entirely; and a
 * page node has no page to read, because a component definition is drawn wherever somebody places
 * an instance of it. Whether a component should reach any of them is a separate decision, and
 * listing them here is what keeps it a decision rather than an oversight.
 */
const DELIBERATELY_OUT: Record<string, string> = {
    "blueprint.event.head.elementClick": "listens to another element, named by a pin",
    "blueprint.event.head.elementFlush": "listens to another element, named by a pin",
    "blueprint.broadcast.send": "a definition is instanced; who would receive it is not a definition question",
    "blueprint.broadcast.getListenerCount": "counts receivers outside the definition",
    "blueprint.event.head.onBroadcast": "receives from outside the definition",
    "blueprint.event.head.onAnyBroadcast": "receives from outside the definition",
    "blueprint.event.head.keyDown": "keyboard input is not addressed to a widget",
    "blueprint.event.head.keyUp": "keyboard input is not addressed to a widget",
    "blueprint.event.head.anyKeyDown": "keyboard input is not addressed to a widget",
    "blueprint.event.head.anyKeyUp": "keyboard input is not addressed to a widget",
    "blueprint.event.head.fullscreenChanged": "a window event, not a widget one",
    "blueprint.page.getProps": "a component definition has no page",
    "blueprint.page.isSurfaceEntering": "a component definition has no page",
    "blueprint.page.isSurfaceExiting": "a component definition has no page",
    "blueprint.page.isSurfaceTransitioning": "a component definition has no page",
    "blueprint.frame.emit": "addressed to the frame the surface sits in",
    "blueprint.frame.getParam": "reads the frame the surface sits in; a definition has no surface",
};

describe("a component definition's widget graph", () => {
    it("can act on its own widget, exactly as a surface's can", () => {
        registerCoreBlueprintNodes();
        const onSurface = allowed(SURFACE_WIDGET, "nl.slider");
        const inComponent = allowed(COMPONENT_WIDGET, "nl.slider");

        // Failing with a node listed here means it became available to one and not the other. If
        // that is deliberate, it belongs in DELIBERATELY_OUT with the reason; if it is not, it is
        // the same leftover as the eleven declarations this test was written for.
        const missing = [...onSurface].filter(type => !inComponent.has(type) && !(type in DELIBERATELY_OUT));
        expect(missing).toEqual([]);
    });

    it("still reaches its own value, which is the case that was broken", () => {
        registerCoreBlueprintNodes();
        const inComponent = allowed(COMPONENT_WIDGET, "nl.slider");

        // Named rather than left to the set comparison above, because these are the ones an author
        // notices: a slider that can hear a click and not move.
        for (const type of ["blueprint.slider.setValue", "blueprint.slider.getValue", "blueprint.displayable.setProperty"]) {
            expect(inComponent.has(type), `${type} is not offered inside a component definition`).toBe(true);
        }
    });

    it("keeps out what was deliberately kept out", () => {
        registerCoreBlueprintNodes();
        const inComponent = allowed(COMPONENT_WIDGET, "nl.slider");
        const onSurface = allowed(SURFACE_WIDGET, "nl.slider");

        for (const [type, why] of Object.entries(DELIBERATELY_OUT)) {
            // Only assert about nodes a surface widget actually has - so a renamed or retired node
            // shows up as a stale entry here rather than as a silent pass.
            expect(onSurface.has(type), `${type} is listed as deliberately excluded but no surface widget has it either`).toBe(true);
            expect(inComponent.has(type), `${type} became available in a component (${why})`).toBe(false);
        }
    });
});
