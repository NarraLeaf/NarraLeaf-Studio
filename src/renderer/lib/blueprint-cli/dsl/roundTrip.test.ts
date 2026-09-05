/**
 * The text format against every blueprint the shipped skeleton holds.
 *
 * A format that can only express what its own examples use is a format that will lose someone's
 * graph the first time it meets a real one. The skeleton is a couple of hundred blueprints and six
 * hundred-odd nodes of real authored work - variadic pins, localization keys, asset ids, dotted node
 * ids - so printing all of them and compiling the result back is the only claim worth making about
 * round-tripping: not that it works, but that it works on everything that exists.
 *
 * Comments in English per project convention.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { Blueprint, BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { registerBuiltInPluginBlueprintNodes } from "../builtinPluginNodes";
import { loadSaveSchema } from "../project";
import { compileBlueprintDocument } from "./compile";
import { parseBlueprintText } from "./parse";
import { printBlueprint } from "./print";

registerCoreBlueprintNodes();
// The shipped skeleton's EXTRA screen is built on the Gallery plugin's nodes, and the CLI
// registers every bundled plugin's the same way. Without this the skeleton reads here as a
// document full of unknown types.
registerBuiltInPluginBlueprintNodes();

const SKELETON_PROJECT = path.resolve(__dirname, "../../../../../resources/templates/skeleton/content");
const SKELETON = path.join(SKELETON_PROJECT, "editor", "ui", "uigraphs.json");

// The skeleton declares one save field, and two of its blueprints wire the pin that field grows on
// `Save Game` / `Get Save Metadata`. Without the schema published, those pins do not exist.
loadSaveSchema(SKELETON_PROJECT);

function loadSkeleton(): BlueprintDocument {
    const raw = JSON.parse(fs.readFileSync(SKELETON, "utf8")) as { blueprintDocument: BlueprintDocument };
    return raw.blueprintDocument;
}

function recompile(blueprint: Blueprint): { text: string; compiled: Blueprint | undefined; errors: string[] } {
    const text = printBlueprint(blueprint);
    const parsed = parseBlueprintText(text);
    const compiled = compileBlueprintDocument(parsed.document, {
        newId: () => {
            throw new Error("a printed blueprint must carry every id it needs");
        },
    });
    const errors = [...parsed.diagnostics, ...compiled.diagnostics]
        .filter(item => item.severity === "error")
        .map(item => `${item.line ?? "?"}: ${item.code} ${item.message}`);
    return { text, compiled: compiled.blueprints[0], errors };
}

function graphsOf(blueprint: Blueprint): Record<string, BlueprintGraphIr> {
    const out: Record<string, BlueprintGraphIr> = {};
    for (const [id, graph] of Object.entries(blueprint.graphs.events ?? {})) {
        out[`event:${id}`] = graph.graph ?? {};
    }
    for (const [id, graph] of Object.entries(blueprint.graphs.functions ?? {})) {
        out[`function:${id}`] = graph.graph ?? {};
    }
    return out;
}

describe("blueprint text format round trip", () => {
    const document = loadSkeleton();
    const blueprints = Object.values(document.blueprints);

    it("reads the skeleton", () => {
        expect(blueprints.length).toBeGreaterThan(100);
    });

    it("compiles every printed blueprint without an error", () => {
        const failures: string[] = [];
        for (const blueprint of blueprints) {
            const { errors } = recompile(blueprint);
            if (errors.length > 0) {
                failures.push(`${blueprint.name}: ${errors.join("; ")}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it("prints the same text a second time", () => {
        const drifted: string[] = [];
        for (const blueprint of blueprints) {
            const { text, compiled } = recompile(blueprint);
            if (!compiled) {
                drifted.push(`${blueprint.name}: nothing compiled`);
                continue;
            }
            const again = printBlueprint(compiled);
            if (again !== text) {
                drifted.push(`${blueprint.name}`);
            }
        }
        expect(drifted).toEqual([]);
    });

    it("keeps every node, edge and canvas position", () => {
        const drifted: string[] = [];
        for (const blueprint of blueprints) {
            const { compiled } = recompile(blueprint);
            if (!compiled) {
                continue;
            }
            const before = graphsOf(blueprint);
            const after = graphsOf(compiled);
            if (Object.keys(before).join(",") !== Object.keys(after).join(",")) {
                drifted.push(`${blueprint.name}: graph slots differ`);
                continue;
            }
            for (const key of Object.keys(before)) {
                const a = before[key];
                const b = after[key];
                expect(Object.keys(b.nodes ?? {})).toEqual(Object.keys(a.nodes ?? {}));
                expect(b.edges ?? []).toEqual(a.edges ?? []);
                for (const [nodeId, node] of Object.entries(a.nodes ?? {})) {
                    const other = (b.nodes ?? {})[nodeId];
                    expect(other.type).toBe(node.type);
                    expect(other.meta?.editorLayout).toEqual(node.meta?.editorLayout);
                }
            }
        }
        expect(drifted).toEqual([]);
    });

    it("keeps every stored param, apart from opening on-card literal editors", () => {
        for (const blueprint of blueprints) {
            const { compiled } = recompile(blueprint);
            if (!compiled) {
                continue;
            }
            const before = graphsOf(blueprint);
            const after = graphsOf(compiled);
            for (const key of Object.keys(before)) {
                for (const [nodeId, node] of Object.entries(before[key].nodes ?? {})) {
                    const params = { ...(node.params ?? {}) };
                    const others = { ...((after[key].nodes ?? {})[nodeId]?.params ?? {}) };
                    // The compiler opens the literal editor for any pin written as a plain value,
                    // which is a param the printed source did not have to carry.
                    delete params.__inlineLiteralPins;
                    delete others.__inlineLiteralPins;
                    expect({ node: nodeId, params: others }).toEqual({ node: nodeId, params });
                }
            }
        }
    });
});
