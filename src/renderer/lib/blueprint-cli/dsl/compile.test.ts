/**
 * What the text format promises an author, stated as tests.
 *
 * The round-trip suite next door proves the format can carry every blueprint that exists. This one
 * covers the other direction - what happens to someone writing a file by hand, and in particular
 * that a mistake produces a message naming the line and the alternatives rather than a graph that
 * quietly does the wrong thing.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { BLUEPRINT_DOCUMENT_SCHEMA_VERSION } from "@shared/types/blueprint/schema";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes";
import { compileBlueprintDocument } from "./compile";
import { parseBlueprintText } from "./parse";

registerCoreBlueprintNodes();

let counter = 0;
function compile(source: string, existing?: BlueprintDocument) {
    counter = 0;
    const parsed = parseBlueprintText(source);
    const result = compileBlueprintDocument(parsed.document, {
        existing,
        newId: () => `id-${(counter += 1)}`,
    });
    return {
        blueprint: result.blueprints[0],
        graph: result.blueprints[0]?.program.kind === "graph"
            ? Object.values(result.blueprints[0].program.graphs.events)[0]?.graph
            : undefined,
        diagnostics: [...parsed.diagnostics, ...result.diagnostics],
        errors: [...parsed.diagnostics, ...result.diagnostics].filter(item => item.severity === "error"),
    };
}

const HELLO = `blueprint Greeter owner=globalMain
event Boot
    boot: blueprint.event.head.appBoot
    text: blueprint.data.stringLiteral value="hi"
    log: blueprint.log

    boot -> log
    text -> log.value
`;

describe("compiling the text format", () => {
    it("fills in the pin when a node has only one that could be meant", () => {
        const { graph, errors } = compile(HELLO);
        expect(errors).toEqual([]);
        expect(graph?.edges).toEqual([
            { from: { nodeId: "boot", port: "then" }, to: { nodeId: "log", port: "in" } },
            { from: { nodeId: "text", port: "value" }, to: { nodeId: "log", port: "value" } },
        ]);
    });

    it("gives every node a position", () => {
        const { graph } = compile(HELLO);
        expect(graph?.nodes?.boot.meta?.editorLayout).toEqual({ x: 0, y: 0 });
        expect(graph?.nodes?.log.meta?.editorLayout).toEqual({ x: 280, y: 0 });
    });

    it("keeps a position the author wrote", () => {
        const { graph } = compile(`blueprint B owner=globalMain
event E
    boot: blueprint.event.head.appBoot @120,340
`);
        expect(graph?.nodes?.boot.meta?.editorLayout).toEqual({ x: 120, y: 340 });
    });

    it("keeps the position a node already had in the project", () => {
        const first = compile(`blueprint B owner=globalMain id=bp
event E id=ev
    boot: blueprint.event.head.appBoot @700,900
`);
        const document: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: { bp: first.blueprint },
            ownerRecords: {},
        };
        const { graph } = compile(`blueprint B owner=globalMain id=bp
event E id=ev
    boot: blueprint.event.head.appBoot
    log: blueprint.log
    boot -> log
`, document);
        expect(graph?.nodes?.boot.meta?.editorLayout).toEqual({ x: 700, y: 900 });
    });

    it("reuses the id a blueprint already has for this owner", () => {
        const document: BlueprintDocument = {
            schemaVersion: BLUEPRINT_DOCUMENT_SCHEMA_VERSION,
            blueprints: {},
            ownerRecords: { globalMain: { activeBlueprintId: "kept", privateBlueprintIds: ["kept"] } },
        };
        document.blueprints.kept = compile(HELLO).blueprint;
        document.blueprints.kept.id = "kept";
        const { blueprint } = compile(HELLO, document);
        expect(blueprint.id).toBe("kept");
    });

    it("names the node types near a misspelling", () => {
        const { errors } = compile(`blueprint B owner=globalMain
event E
    x: blueprint.data.stringLiterl
`);
        expect(errors[0].code).toBe("compile.unknown_node_type");
        expect(errors[0].line).toBe(3);
        expect(errors[0].hint).toContain("blueprint.data.stringLiteral");
    });

    it("lists the pins a node does have", () => {
        const { errors } = compile(`blueprint B owner=globalMain
event E
    boot: blueprint.event.head.appBoot
    log: blueprint.log
    boot.thenn -> log.in
`);
        expect(errors[0].code).toBe("compile.unknown_pin");
        expect(errors[0].hint).toContain("then");
    });

    it("asks for a pin when a node has more than one execution output", () => {
        const { errors } = compile(`blueprint B owner=globalMain
event E
    boot: blueprint.event.head.appBoot
    branch: if
    log: blueprint.log
    boot -> branch
    branch -> log
`);
        expect(errors[0].code).toBe("compile.ambiguous_pin");
        expect(errors[0].hint).toContain("true");
        expect(errors[0].hint).toContain("false");
    });

    it("refuses a second value into one data input, and allows execution to converge", () => {
        const { errors } = compile(`blueprint B owner=globalMain
event E
    boot: blueprint.event.head.appBoot
    a: blueprint.data.stringLiteral value="a"
    b: blueprint.data.stringLiteral value="b"
    log: blueprint.log
    other: blueprint.log
    a -> log.value
    b -> log.value
    boot -> log
    log.next -> other.in
    boot.then -> other.in
`);
        expect(errors.map(item => item.code)).toEqual(["compile.input_pin_taken"]);
    });

    it("opens the on-card editor for a pin written as a plain value", () => {
        const { graph, errors } = compile(`blueprint B owner=globalMain
event E
    boot: blueprint.event.head.appBoot
    wait: blueprint.flow.delay duration=1.5
    boot -> wait
`);
        expect(errors).toEqual([]);
        expect(graph?.nodes?.wait.params?.duration).toBe(1.5);
        expect(graph?.nodes?.wait.params?.__inlineLiteralPins).toEqual(["duration"]);
    });

    it("does not mistake a node id's dots for a pin", () => {
        const { graph, errors } = compile(`blueprint B owner=globalMain
event E
    sfx.a.b: blueprint.event.head.appBoot
    log: blueprint.log
    sfx.a.b.then -> log.in
`);
        expect(errors).toEqual([]);
        expect(graph?.edges?.[0].from).toEqual({ nodeId: "sfx.a.b", port: "then" });
    });

    it("reads a param whose name is a block keyword", () => {
        const { graph, errors } = compile(`blueprint B owner=globalMain
event E
    boot: blueprint.event.head.appBoot
    say: blueprint.broadcast.send
        event = saves:refresh
    boot -> say
`);
        expect(errors).toEqual([]);
        expect(graph?.nodes?.say.params?.event).toBe("saves:refresh");
    });

    it("chains and back-wires", () => {
        const { graph, errors } = compile(`blueprint B owner=globalMain
event E
    boot: blueprint.event.head.appBoot
    one: blueprint.log
    two: blueprint.log
    text: blueprint.data.stringLiteral value="x"
        # nothing feeds a literal; this line belongs to the node below
    three: blueprint.log
        value <- text.value

    boot -> one -> two -> three
`);
        expect(errors).toEqual([]);
        expect(graph?.edges).toEqual([
            { from: { nodeId: "text", port: "value" }, to: { nodeId: "three", port: "value" } },
            { from: { nodeId: "boot", port: "then" }, to: { nodeId: "one", port: "in" } },
            { from: { nodeId: "one", port: "next" }, to: { nodeId: "two", port: "in" } },
            { from: { nodeId: "two", port: "next" }, to: { nodeId: "three", port: "in" } },
        ]);
    });

    it("ignores a comment but not a hash inside a string", () => {
        const { graph, errors } = compile(`blueprint B owner=globalMain
event E
    # a whole-line comment
    text: blueprint.data.stringLiteral value="a # b"  # trailing
`);
        expect(errors).toEqual([]);
        expect(graph?.nodes?.text.params?.value).toBe("a # b");
    });

    it("says which owner field is missing", () => {
        const { errors } = compile(`blueprint B owner=widgetMain surface=s
event E
    boot: blueprint.event.head.appBoot
`);
        expect(errors[0].code).toBe("compile.missing_owner_field");
        expect(errors[0].message).toContain("elementId");
    });

    it("builds each owner kind", () => {
        const owners = [
            ["owner=globalMain", { kind: "globalMain" }],
            ["owner=surfaceMain surface=s", { kind: "surfaceMain", surfaceId: "s" }],
            ["owner=widgetMain surface=s element=e", { kind: "widgetMain", surfaceId: "s", elementId: "e" }],
            [
                "owner=widgetValue surface=s element=e prop=label",
                { kind: "widgetValue", surfaceId: "s", elementId: "e", propPath: "label" },
            ],
            ["owner=sharedAsset asset=a", { kind: "sharedAsset", assetId: "a" }],
            [
                "owner=storyAction blueprint=b mode=value",
                { kind: "storyAction", blueprintId: "b", mode: "value" },
            ],
        ] as const;
        for (const [written, expected] of owners) {
            const { blueprint } = compile(`blueprint B ${written}\nevent E\n    x: blueprint.log\n`);
            expect(blueprint.owner).toEqual(expected);
        }
    });

    it("carries member variables", () => {
        const { blueprint } = compile(`blueprint B owner=globalMain
    var Score type=number default=3 id=v1
event E
    x: blueprint.log
`);
        expect(blueprint.members?.variables).toEqual({
            v1: { id: "v1", name: "Score", valueType: "number", defaultValue: 3 },
        });
    });
});
