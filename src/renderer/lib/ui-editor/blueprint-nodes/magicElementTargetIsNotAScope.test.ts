import { describe, expect, it } from "vitest";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "./registerCoreBlueprintNodes";

/**
 * A magic element target and a scope are alternatives, and no node declares both.
 *
 * The two say different things about the same question. A magic element target means "this node is
 * pointed at an element, and here is the pin that names it". A scope means "this node may only
 * appear in certain graphs, on certain widget types" - and the widget-scoped variant of such a node
 * addresses the widget that owns the graph, so it needs no pin and declares no target.
 *
 * `resolveEffectiveBlueprintNodePins` used to encode that pairing as `magicElementTarget && !scope`,
 * which read the *absence* of a scope as evidence of which variant it was looking at. That was
 * vacuous - it is true of every magic-element node in the catalogue - and it was a trap: any of the
 * 133 of them that gained a scope for an unrelated reason would have silently lost its element pin,
 * which is the pin that says which element it acts on. Merging `requiresHostApi` into the scope
 * mechanism would have done exactly that to all of them at once.
 *
 * The pairing is real, so it is asserted here instead of inferred there. A node that wants both is
 * two nodes.
 */
describe("magic element targets and scopes", () => {
    it("are never both declared on one node", () => {
        registerCoreBlueprintNodes();
        const both = blueprintNodeRegistry.list()
            .filter(def => def.magicElementTarget && def.scope)
            .map(def => def.type);

        // Failing here means a node is trying to be both the element-targeting variant and the
        // widget-scoped one. Split it: the scoped variant declares no magic target and acts on the
        // widget that owns the graph.
        expect(both).toEqual([]);
    });

    it("covers a catalogue that actually has magic-element nodes in it", () => {
        // Without this the check above passes just as well on an empty registry, which is what it
        // would silently become if registration ever moved.
        registerCoreBlueprintNodes();
        const magic = blueprintNodeRegistry.list().filter(def => def.magicElementTarget);
        expect(magic.length).toBeGreaterThan(50);
    });
});
