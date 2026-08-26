import { describe, expect, it } from "vitest";
import { derivedBlueprintId } from "./derivedBlueprintId";
import { componentWidgetMainOwnerKey, surfaceMainOwnerKey, widgetMainOwnerKey } from "./ownerKeys";

/**
 * The id of a widget's private blueprint, derived rather than minted.
 *
 * **What makes it worth a test is a live session.** The reconciliation that creates these runs after
 * every interface mutation on every machine in a room; with a random id each of them would invent a
 * different one for the blueprint that one effect implies, and two documents would differ with only
 * the digest to notice.
 */
describe("the id a widget's private blueprint gets", () => {
    it("is the same on every machine for the same owner", () => {
        const key = widgetMainOwnerKey("surface-1", "element-1");
        expect(derivedBlueprintId(key)).toBe(derivedBlueprintId(key));
    });

    it("is different for every owner, including neighbouring ones", () => {
        const ids = new Set([
            derivedBlueprintId(surfaceMainOwnerKey("surface-1")),
            derivedBlueprintId(widgetMainOwnerKey("surface-1", "element-1")),
            derivedBlueprintId(widgetMainOwnerKey("surface-1", "element-2")),
            derivedBlueprintId(widgetMainOwnerKey("surface-2", "element-1")),
            derivedBlueprintId(componentWidgetMainOwnerKey("surface-1", "element-1")),
        ]);
        expect(ids.size).toBe(5);
    });

    it("is uuid-shaped, so everything downstream goes on treating it as an opaque string", () => {
        const id = derivedBlueprintId(widgetMainOwnerKey("surface-1", "element-1"));
        expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});
