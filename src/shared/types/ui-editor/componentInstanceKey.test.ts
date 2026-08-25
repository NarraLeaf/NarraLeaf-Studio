/**
 * Telling one placement of a component from another, and what its graph is allowed to reach.
 *
 * Both halves are about the same fact: a component definition is a tree with no surface of its own,
 * instantiated wherever somebody places it. The instance key is what separates two placements at
 * runtime; the virtual surface id is what a blueprint written inside the definition names when it
 * points at one of the definition's own elements, because the surface an instance ends up on is not
 * something the definition can know.
 *
 * The scope predicate is tested here rather than at each of the six nodes that ask it, since that is
 * the point of it having one home: it was six copies of `ref.surfaceId !== currentSurfaceId`, and
 * every one of them refused a component's own elements.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    buildUIComponentInstanceKey,
    buildUIComponentSurfaceId,
    isUIElementRefInScope,
    readUIComponentInstanceElementId,
} from "./componentInstanceKey";

const COMPONENT = "component-1";
const SURFACE = "surface-1";

describe("component instance keys", () => {
    it("names a placement by the element that placed it, and nests", () => {
        const outer = buildUIComponentInstanceKey(undefined, "instance-a");
        const inner = buildUIComponentInstanceKey(outer, "instance-b");

        expect(outer).not.toBe(inner);
        expect(readUIComponentInstanceElementId(outer)).toBe("instance-a");
        // The innermost wins: a component placed inside another takes its own params, not its host's.
        expect(readUIComponentInstanceElementId(inner)).toBe("instance-b");
    });

    it("reads nothing out of a key that names no component", () => {
        expect(readUIComponentInstanceElementId(undefined)).toBeNull();
        expect(readUIComponentInstanceElementId("")).toBeNull();
    });
});

describe("isUIElementRefInScope", () => {
    it("lets a graph reach the surface it runs on", () => {
        expect(isUIElementRefInScope(SURFACE, { surfaceId: SURFACE })).toBe(true);
    });

    it("refuses another surface, which is what the check is for", () => {
        expect(isUIElementRefInScope("surface-2", { surfaceId: SURFACE })).toBe(false);
    });

    it("lets a component definition's graph reach its own tree", () => {
        // The definition cannot name the surface an instance landed on - two placements land on
        // two different ones - so its refs name the definition instead.
        expect(isUIElementRefInScope(buildUIComponentSurfaceId(COMPONENT), {
            surfaceId: SURFACE,
            componentId: COMPONENT,
        })).toBe(true);
    });

    it("still refuses another component's tree", () => {
        expect(isUIElementRefInScope(buildUIComponentSurfaceId("component-2"), {
            surfaceId: SURFACE,
            componentId: COMPONENT,
        })).toBe(false);
    });

    it("allows anything from an execution that cannot say where it is running", () => {
        // What the check did before there was anything to compare against; a global execution
        // carries no surface and must not start failing because of it.
        expect(isUIElementRefInScope(SURFACE, undefined)).toBe(true);
        expect(isUIElementRefInScope(SURFACE, {})).toBe(true);
    });
});
