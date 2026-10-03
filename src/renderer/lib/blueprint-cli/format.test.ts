/**
 * `blueprint format`, and the card sizes it lays out with.
 *
 * The sizes are held to cards measured in the editor: if a card's styles change, these numbers are
 * what tells the command line it no longer draws the card the canvas draws.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { blueprintNodeRegistry, registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { layoutBlueprintGraph } from "@/apps/workspace/modules/blueprint-lite/flow/blueprintAutoLayout";
import { registerBuiltInPluginBlueprintNodes } from "./builtinPluginNodes";
import { blueprintCardGeometry } from "./cardGeometry";
import { compileBlueprintDocument } from "./dsl/compile";
import { parseBlueprintText } from "./dsl/parse";
import { formatBlueprintSource, layoutGraphOf } from "./format";

registerCoreBlueprintNodes();
registerBuiltInPluginBlueprintNodes();

function geometry(type: string, params: Record<string, unknown> = {}, wired: string[] = []) {
    const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(type, params);
    return blueprintCardGeometry(entry, params, new Set(wired));
}

const offset = (g: ReturnType<typeof geometry>, id: string) => g.pins.find(pin => pin.id === id)?.offset;

describe("card geometry", () => {
    // Measured off the editor's own cards at zoom 1.
    it("sizes an If the way the editor draws it", () => {
        const g = geometry("if");
        expect(g.height).toBe(99.4);
        expect(offset(g, "in")).toBe(60.6);
        expect(offset(g, "true")).toBe(60.6);
        expect(offset(g, "condition")).toBe(82.6);
        expect(offset(g, "false")).toBe(82.6);
    });

    it("puts Set Element Variant's pins under its variant panel", () => {
        const g = geometry("blueprint.element.displayable.setVariant", { variantId: "selected" });
        expect(g.height).toBe(230.2);
        expect(offset(g, "in")).toBe(191.4);
        expect(offset(g, "element")).toBe(213.4);
    });

    it("puts an Element card's output under its preview", () => {
        const g = geometry("blueprint.element.ref");
        expect(g.height).toBe(211);
        expect(offset(g, "element")).toBe(194.2);
    });

    it("counts a field shown on the card, and a pin opened into a value", () => {
        expect(geometry("blueprint.localization.getText").height).toBe(158.2);
        expect(geometry("blueprint.math.divide", { __inlineLiteralPins: ["b"], b: 100 }).height).toBe(101);
        // Wired, the same pin is an ordinary pin row again.
        expect(geometry("blueprint.math.divide", { __inlineLiteralPins: ["b"] }, ["b"]).height).toBe(99.4);
    });

    it("never makes a card narrower than the editor's narrowest", () => {
        for (const type of ["if", "blueprint.data.memo", "blueprint.element.ref", "blueprint.string.concat"]) {
            expect(geometry(type).width).toBeGreaterThanOrEqual(200);
        }
    });
});

const SOURCE = `# Formatting keeps this comment.
blueprint "Quit" owner=globalMain

event "On boot"
    note: blueprint.flow.comment @-300,-400
        text = "Starts the game."
    box: blueprint.flow.comment @900,900
        frame = true
        width = 300
        height = 300
    boot: blueprint.event.head.appBoot @500,500
    log: blueprint.log @1000,1000  # stays with its line
    check: if @1000,1000
    flag: blueprint.data.booleanLiteral value="true" @1000,1000

    boot -> check
    flag.value -> check.condition
    check.true -> log
`;

describe("blueprint format", () => {
    it("lays the file out exactly as the canvas's layout would, from sized cards", () => {
        const result = formatBlueprintSource(SOURCE);
        expect(result.diagnostics.filter(item => item.severity === "error")).toEqual([]);

        const reparsed = parseBlueprintText(result.text);
        const compiled = compileBlueprintDocument(reparsed.document);
        const ir = Object.values(compiled.blueprints[0]!.graphs.events)[0]!.graph!;
        const graph = layoutGraphOf(ir);
        const again = layoutBlueprintGraph(graph);
        // Formatting the formatted file moves nothing: what was written is the layout's answer.
        for (const card of graph.cards) {
            expect(again.positions[card.id], card.id).toEqual({ x: card.x, y: card.y });
        }
    });

    it("rewrites positions and a frame's size, and nothing else", () => {
        const result = formatBlueprintSource(SOURCE);
        const before = SOURCE.split("\n");
        const after = result.text.split("\n");

        expect(after[0]).toBe("# Formatting keeps this comment.");
        expect(after.find(line => line.includes("log: blueprint.log"))).toMatch(/@-?\d+,-?\d+ # stays with its line$/);
        expect(after.filter(line => / {8}width = /.test(line))).toHaveLength(1);
        expect(after).toHaveLength(before.length);
        // The edges are untouched.
        expect(after.slice(-4)).toEqual(before.slice(-4));
    });

    it("puts the note above the chain it was written over", () => {
        const result = formatBlueprintSource(SOURCE);
        const at = (id: string) => {
            const line = result.text.split("\n").find(item => item.trimStart().startsWith(`${id}:`))!;
            const [, x, y] = /@(-?\d+),(-?\d+)/.exec(line)!;
            return { x: Number(x), y: Number(y) };
        };
        expect(at("note").y).toBeLessThan(at("boot").y);
        expect(at("note").y).toBeLessThan(at("flag").y);
    });

    it("reports what it laid out", () => {
        const result = formatBlueprintSource(SOURCE);
        expect(result.layers).toHaveLength(1);
        expect(result.layers[0]).toMatchObject({ blueprint: "Quit", layer: "On boot", cards: 4 });
        expect(result.layers[0]!.after.crossings).toBe(0);
        expect(result.layers[0]!.after.backwards).toBe(0);
    });

    it("writes nothing for a file that does not parse", () => {
        const broken = "blueprint \"x\" owner=globalMain\nevent e\n    a: \n";
        const result = formatBlueprintSource(broken);
        expect(result.text).toBe(broken);
        expect(result.diagnostics.some(item => item.severity === "error")).toBe(true);
    });
});
