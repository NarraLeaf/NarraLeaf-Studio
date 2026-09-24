/**
 * What the second line of the starter's auto-save rows says.
 *
 * It used to say nothing at all. The row read `metadata.place`, which is the author's own save
 * schema - and a scheduled auto-save is written by the scheduler, not by an author, so every one of
 * them carries no metadata and every row's second line came out blank. Filling it the way the manual
 * slots do is not available either: what the starter's manual slots put in `place` is a scene
 * reference, and the node that turns one into a scene name is effectful, which a value blueprint on
 * a row may not be. So the row reads the sentence the slot was left on, off the row itself.
 *
 * Run rather than read: a binding can point at the right field and still return the wrong thing, and
 * the empty case - a slot written before any line played - is the one that has to look deliberate.
 * The graph is taken out of the shipped template and executed the way the value evaluator executes
 * it, head by head, last return wins.
 *
 * Comments in English per project convention.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    BUILTIN_UI_STRUCTS,
    UI_STRUCT_ID_SAVE_ENTRY,
} from "@shared/types/ui-editor/builtinStructs";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "@/lib/ui-editor/behavior-graph/GraphExecutor";

const LOCALES = ["content", "content.zh", "content.ja"] as const;

/** Nothing in these graphs reaches the host: they read the row and return a string. */
const HOST = { host: "player", blueprintRuntime: { surfaceId: "surface" } } as unknown as UIHostAdapter;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const SAVE_ENTRY_STRUCT = BUILTIN_UI_STRUCTS[UI_STRUCT_ID_SAVE_ENTRY]!;

type BlueprintDocumentFile = {
    blueprintDocument: {
        blueprints: Record<string, {
            graphs: { events?: Record<string, { graph: UIGraph }> };
        }>;
    };
};

function readTemplate(variant: string, file: string): unknown {
    return JSON.parse(
        fs.readFileSync(
            path.join(process.cwd(), "resources/templates/skeleton", variant, "editor/ui", file),
            "utf-8",
        ),
    );
}

/** The elements of the one item template drawn for `nl.saveEntry` rows. */
function autoSaveRowChildren(document: UIDocument): UIElement[] {
    const lists = Object.values(document.elements).filter(
        element => (element.props as { itemStructId?: unknown } | undefined)?.itemStructId
            === UI_STRUCT_ID_SAVE_ENTRY,
    );
    expect(lists).toHaveLength(1);
    const template = (lists[0]!.childrenIds ?? []).map(id => document.elements[id]!).filter(Boolean);
    expect(template).toHaveLength(1);
    return (template[0]!.childrenIds ?? []).map(id => document.elements[id]!).filter(Boolean);
}

/** One auto-save as `List Auto Saves` hands it over, with whatever line the case under test wants. */
function row(line: string): UIListItemScope {
    return {
        item: {
            id: "@autosave.1",
            slot: 1,
            timestamp: 1_760_000_000_000,
            createdAt: 1_760_000_000_000,
            preview: null,
            line,
            speaker: line ? "Narra" : "",
            metadata: null,
        },
        index: 0,
        count: 1,
        key: "@autosave.1",
        struct: SAVE_ENTRY_STRUCT,
    };
}

/**
 * The blueprint's answer for one row, produced the way `BlueprintValueEvaluator` produces it: every
 * head of every layer in order, and the last return is the value the widget is given.
 */
async function evaluate(blueprint: { graphs: { events?: Record<string, { graph: UIGraph }> } }, scope: UIListItemScope): Promise<unknown> {
    let value: unknown;
    let returned = false;
    for (const eventGraph of Object.values(blueprint.graphs.events ?? {})) {
        const heads = Object.values(eventGraph.graph.nodes ?? {})
            .filter(node => node.type.startsWith("blueprint.event.head."));
        for (const head of heads) {
            const result = await executeGraph({
                graph: eventGraph.graph,
                entry: { start: { nodeId: head.id, port: "then" } },
                hostAdapter: HOST,
                blueprintLocals: {},
                listItemScope: scope,
            });
            if (result.returnValueSet) {
                returned = true;
                value = result.returnValue;
            }
        }
    }
    expect(returned).toBe(true);
    return value;
}

describe("the fields an auto-save row reads", () => {
    it("carries the saved line and its speaker as strings", () => {
        expect(SAVE_ENTRY_STRUCT.fields.find(field => field.key === "line")?.type).toBe("string");
        expect(SAVE_ENTRY_STRUCT.fields.find(field => field.key === "speaker")?.type).toBe("string");
    });
});

describe.each(LOCALES)("the starter's auto-save rows (%s)", variant => {
    const document = readTemplate(variant, "uidoc.json") as UIDocument;
    const graphs = readTemplate(variant, "uigraphs.json") as BlueprintDocumentFile;
    const children = autoSaveRowChildren(document);

    /** The row's texts, each with the blueprint its `text` is bound to. */
    const boundTexts = children
        .filter(child => child.type === "nl.text")
        .map(child => {
            const binding = child.valueBindings?.text;
            return binding?.kind === "blueprintValue"
                ? { element: child, blueprintId: binding.blueprintId }
                : null;
        })
        .filter((entry): entry is { element: UIElement; blueprintId: string } => entry !== null);

    it("says something on every line of every row it draws", async () => {
        expect(boundTexts.length).toBeGreaterThanOrEqual(2);
        for (const { blueprintId } of boundTexts) {
            const blueprint = graphs.blueprintDocument.blueprints[blueprintId]!;
            expect(blueprint).toBeDefined();
            // A slot that has been played, and one written before any line played. Neither may come
            // back blank: a row drawn against nothing is indistinguishable from a broken binding.
            for (const scope of [row("You're late."), row("")]) {
                const answer = await evaluate(blueprint, scope);
                expect(typeof answer).toBe("string");
                expect((answer as string).trim()).not.toBe("");
            }
        }
    });

    it("quotes the line the slot was left on, and names no id when there is none", async () => {
        // The lowest bound text in the row is its second line; the one above it is the timestamp.
        const second = [...boundTexts].sort((a, b) => a.element.layout.y - b.element.layout.y).at(-1);
        expect(second).toBeDefined();
        const blueprint = graphs.blueprintDocument.blueprints[second!.blueprintId]!;

        expect(await evaluate(blueprint, row("You're late."))).toBe("You're late.");

        const empty = await evaluate(blueprint, row("")) as string;
        expect(empty).not.toMatch(UUID);
        expect(empty).not.toContain("@autosave");
    });

    it("draws no text taken straight from a row's id", () => {
        for (const child of children) {
            const binding = child.valueBindings?.text;
            expect(binding?.kind === "listItemField" && binding.fieldId === "id").toBe(false);
        }
    });
});
