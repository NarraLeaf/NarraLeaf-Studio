import { describe, expect, it } from "vitest";
import { blueprintWireEmphasisCss } from "./BlueprintWireEmphasis";

const hover = {
    edgeId: "e:3:a:next->b:in",
    source: { nodeId: "a", pinId: "next", side: "output" as const },
    target: { nodeId: "b", pinId: "in", side: "input" as const },
    color: "#22d3ee",
};

describe("blueprintWireEmphasisCss", () => {
    it("writes nothing when there is nothing to mark", () => {
        expect(blueprintWireEmphasisCss("r1", null, null)).toBe("");
    });

    it("marks the wire, both of its cards and both of its pins, inside its own canvas only", () => {
        const css = blueprintWireEmphasisCss("r1", hover, null);
        expect(css).toContain('.react-flow__edge[data-id="e:3:a:next->b:in"] .react-flow__edge-path');
        expect(css).toContain('.react-flow__node[data-id="a"]');
        expect(css).toContain('.react-flow__node[data-id="b"]');
        expect(css).toContain('.react-flow__handle[data-nodeid="a"][data-handleid="next"]');
        expect(css).toContain('.react-flow__handle[data-nodeid="b"][data-handleid="in"]');
        for (const rule of css.split("\n")) {
            for (const selector of rule.slice(0, rule.indexOf("{")).split(",")) {
                expect(selector.trim().startsWith('[data-blueprint-canvas="r1"]')).toBe(true);
            }
        }
        expect(css).toContain("#22d3ee");
    });

    it("marks the card a jump arrived at with the fading outline", () => {
        const css = blueprintWireEmphasisCss("r1", null, { end: hover.target, color: "#f59e0b" });
        expect(css).toContain("narraleaf-blueprint-arrive");
        expect(css).toContain("--nl-blueprint-arrive: #f59e0b");
    });

    it("keeps an id that is not a plain word inside its quotes", () => {
        const css = blueprintWireEmphasisCss("r1", { ...hover, edgeId: 'odd"} body{display:none' }, null);
        expect(css).toContain('[data-id="odd\\"} body{display:none"]');
    });

    it("does not let anything but a colour into a rule", () => {
        const css = blueprintWireEmphasisCss("r1", { ...hover, color: "red; } body { display: none" }, null);
        expect(css).not.toContain("display: none");
    });
});
