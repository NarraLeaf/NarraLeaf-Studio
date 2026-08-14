import { describe, expect, it } from "vitest";
import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
} from "@shared/types/blueprint/graph";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { blueprintNodeRegistry } from "../../ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../../ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { createTestLintContext } from "../testContext";
import type { LintContext } from "../context";
import type { LintRule, LintRuleId } from "../types";
import {
    BLUEPRINT_LINT_RULES,
    REFERENCE_KIND_BY_OPTIONS_SOURCE,
    UNCHECKED_OPTIONS_SOURCES,
} from "./blueprint";

/**
 * The `blueprint` category.
 *
 * Two of these tests are worth more than the rest. The coverage test is one: a reference rule that
 * silently checks nothing reports zero findings, which is indistinguishable from a clean project -
 * so the set of option sources it knows about is asserted against the real node catalogue rather
 * than against a list written beside it. The other is the wired-pin test: every one of these params
 * sits next to a data pin that can override it, and a rule that ignores that reports correct graphs
 * as broken.
 */

function rule(id: LintRuleId): LintRule {
    const found = BLUEPRINT_LINT_RULES.find(candidate => candidate.id === id);
    if (!found) {
        throw new Error(`${id} is not registered`);
    }
    return found;
}

function documentWithGraphs(input: {
    events?: Record<string, BlueprintGraphIr>;
    functions?: Record<string, BlueprintGraphIr>;
}): BlueprintDocument {
    const wrap = (graphs: Record<string, BlueprintGraphIr>) =>
        Object.fromEntries(Object.entries(graphs).map(([id, graph]) => [id, { id, graph }]));
    return {
        ownerRecords: {
            "surfaceMain:s1": { activeBlueprintId: "bp1", privateBlueprintIds: ["bp1"] },
        },
        blueprints: {
            bp1: {
                id: "bp1",
                name: "Title Screen",
                program: {
                    kind: "graph",
                    graphs: {
                        events: wrap(input.events ?? {}),
                        functions: wrap(input.functions ?? {}),
                    },
                },
            },
        },
    } as unknown as BlueprintDocument;
}

/** A UI document with exactly the app surfaces named. */
function uiDocumentWithSurfaces(...surfaceIds: string[]): UIDocument {
    return {
        surfaces: surfaceIds.map(id => ({ id, kind: "appSurface" })),
        elements: {},
    } as unknown as UIDocument;
}

/** `On App Boot -> Go Page`, where the page is whatever id is passed. */
function goPageGraph(surfaceId: string): BlueprintGraphIr {
    return {
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
            go: { id: "go", type: BLUEPRINT_NODE_TYPE_PAGE_GO, params: { surfaceId } },
        },
        edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "go", port: "in" } }],
    };
}

async function run(ruleId: LintRuleId, ctx: LintContext) {
    return await rule(ruleId).run(ctx, {});
}

describe("blueprint/reference-missing", () => {
    it("is an error by default", () => {
        // What makes the build refuse a project whose buttons lead nowhere; a downgrade here turns
        // the finding into something a default project ships through.
        expect(rule("blueprint/reference-missing").defaultSeverity).toBe("error");
    });

    it("reports a Go Page whose surface the project no longer has", async () => {
        const findings = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: goPageGraph("deleted") } }),
                uiDocument: uiDocumentWithSurfaces("s1"),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "blueprint/reference-missing",
            messageKey: "lint.rule.blueprintReferenceMissing.messageSurface",
            location: { kind: "blueprint", blueprintId: "bp1", graphId: "onBoot", nodeId: "go" },
            target: { kind: "blueprint", ownerKey: "surfaceMain:s1", focusEventId: "onBoot", focusNodeId: "go" },
        });
    });

    it("says nothing about a Go Page whose surface exists", async () => {
        const findings = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: goPageGraph("s1") } }),
                uiDocument: uiDocumentWithSurfaces("s1"),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a Go Page with no page chosen", async () => {
        // An unset dropdown is an unfinished node, visible as an empty select in the editor. Only a
        // value that names something is judged against what the project has.
        const findings = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: goPageGraph("  ") } }),
                uiDocument: uiDocumentWithSurfaces("s1"),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("judges nothing when the UI document could not be read", async () => {
        // An unread document is not a project with no pages. Treating it as one would report every
        // Go Page in the project as broken.
        const findings = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: goPageGraph("s1") } }),
                uiDocument: null,
            }),
        );
        expect(findings).toEqual([]);
    });

    it("judges no story reference when a story failed to load", async () => {
        // Same trap as above, and the one the flag exists for: the failed story is simply absent
        // from `stories`, so every scene id in it would look deleted.
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                text: {
                    id: "text",
                    type: BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT,
                    params: { key: "greeting" },
                },
            },
            edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "text", port: "in" } }],
        };
        const base = {
            blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }),
            localizationKeyNames: new Set(["farewell"]),
        };
        expect(await run("blueprint/reference-missing", createTestLintContext(base))).toHaveLength(1);
        // The key registry not having loaded is the localization equivalent, and is also silent.
        expect(
            await run(
                "blueprint/reference-missing",
                createTestLintContext({ ...base, localizationKeyNames: null }),
            ),
        ).toEqual([]);
    });

    it("ignores a param whose pin is wired", async () => {
        // `Get Text` has both a `key` param and a `key` data pin. When the pin is connected, the
        // param is not what runs, and reporting it is a false positive on a correct graph.
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                literal: { id: "literal", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "farewell" } },
                text: { id: "text", type: BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT, params: { key: "deleted" } },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "text", port: "in" } },
                { from: { nodeId: "literal", port: "value" }, to: { nodeId: "text", port: "key" } },
            ],
        };
        const findings = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }),
                localizationKeyNames: new Set(["farewell"]),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("accounts for every project-entity option source the node catalogue declares", () => {
        // The test that keeps this rule honest. A node added later with a new `dynamicOptionsSource`
        // is either resolved or explicitly waived here - it cannot be quietly skipped, which is the
        // one failure mode a reference check cannot survive: it reports nothing and reads as clean.
        registerCoreBlueprintNodes();
        const declared = new Set<string>();
        for (const def of blueprintNodeRegistry.list()) {
            for (const param of def.inspectorParams ?? []) {
                if (param.dynamicOptionsSource) {
                    declared.add(param.dynamicOptionsSource);
                }
            }
        }
        // Named rather than counted: "the catalogue declares at least one source" would also pass
        // against a registry that never loaded, which is the state this whole test exists to fail in.
        expect([...declared].sort()).toEqual(
            expect.arrayContaining(["audioTracks", "callableFns", "characters", "localizationKeys", "surfaces"]),
        );
        const unaccounted = [...declared].filter(
            source => !REFERENCE_KIND_BY_OPTIONS_SOURCE[source] && !UNCHECKED_OPTIONS_SOURCES.has(source),
        );
        expect(
            unaccounted,
            `Blueprint node params read options from ${unaccounted.join(", ")}, which blueprint/reference-missing\n` +
                "neither resolves nor waives. Add a resolver in REFERENCE_KIND_BY_OPTIONS_SOURCE, or list the\n" +
                "source in UNCHECKED_OPTIONS_SOURCES with the reason it cannot be checked.\n",
        ).toEqual([]);
    });
});

describe("blueprint/unreachable-node", () => {
    it("is a warning by default", () => {
        expect(rule("blueprint/unreachable-node").defaultSeverity).toBe("warning");
    });

    it("reports the head of an unreachable chain once, not every node in it", async () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                wired: { id: "wired", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
                orphanA: { id: "orphanA", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
                orphanB: { id: "orphanB", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "wired", port: "in" } },
                { from: { nodeId: "orphanA", port: "next" }, to: { nodeId: "orphanB", port: "in" } },
            ],
        };
        const findings = await run(
            "blueprint/unreachable-node",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }) }),
        );
        expect(findings.map(finding => finding.location)).toEqual([
            {
                kind: "blueprint",
                blueprintId: "bp1",
                blueprintName: "Title Screen",
                graphId: "onBoot",
                nodeId: "orphanA",
            },
        ]);
    });

    it("leaves data nodes alone", async () => {
        // A literal is pulled by whoever reads it and is never exec-reachable; reporting one would
        // put a warning on every literal in the project.
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                literal: { id: "literal", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "hi" } },
                log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "log", port: "in" } },
                { from: { nodeId: "literal", port: "value" }, to: { nodeId: "log", port: "message" } },
            ],
        };
        const findings = await run(
            "blueprint/unreachable-node",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }) }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a graph with no entry point at all", async () => {
        // One problem, and the graph editor already reports it as one. Calling each node unreachable
        // would say it once per node.
        const graph: BlueprintGraphIr = {
            nodes: { log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: {} } },
            edges: [],
        };
        const findings = await run(
            "blueprint/unreachable-node",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }) }),
        );
        expect(findings).toEqual([]);
    });
});

describe("blueprint/empty-event", () => {
    it("is an info by default", () => {
        expect(rule("blueprint/empty-event").defaultSeverity).toBe("info");
    });

    it("reports an event layer with no nodes and one whose head runs nothing", async () => {
        const findings = await run(
            "blueprint/empty-event",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: {
                        empty: {},
                        stub: {
                            nodes: { head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} } },
                            edges: [],
                        },
                    },
                }),
            }),
        );
        expect(findings.map(finding => finding.location)).toMatchObject([
            { graphId: "empty" },
            { graphId: "stub" },
        ]);
    });

    it("says nothing about an event layer that runs something", async () => {
        const findings = await run(
            "blueprint/empty-event",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: goPageGraph("s1") } }),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a function graph", async () => {
        // Functions are called, not dispatched; an empty one is not the same finding and this rule
        // has no sentence for it.
        const findings = await run(
            "blueprint/empty-event",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ functions: { fn: {} } }) }),
        );
        expect(findings).toEqual([]);
    });
});
