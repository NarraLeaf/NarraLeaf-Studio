import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APP_TAG_ID_RELEASE } from "@shared/types/appTag";
import type { BlueprintDocument, BlueprintGraphIr, BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT,
    BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_SOUND_PLAY,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED,
    BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
    BLUEPRINT_NODE_TYPE_GAME_START_STORY,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCALIZATION_GET_TEXT,
    BLUEPRINT_NODE_TYPE_LOG,
    BLUEPRINT_NODE_TYPE_PAGE_GO,
} from "@shared/types/blueprint/graph";
import type { SaveSchemaField } from "@shared/types/saveSchema";
import type { StoryDocument } from "@shared/types/story";
import { setActiveSaveSchemaFields } from "@shared/saves/saveSchemaRegistry";
import { saveSchemaPinId } from "../../ui-editor/blueprint-nodes/effectivePins";
import {
    ELEMENT_REF_PARAM_ELEMENT_ID,
    ELEMENT_REF_PARAM_ELEMENT_TYPE,
    ELEMENT_REF_PARAM_SURFACE_ID,
} from "../../ui-editor/blueprint-nodes/built-in/elementRefUtils";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { blueprintNodeRegistry } from "../../ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "../../ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import {
    createBlueprintFnRef,
    listBlueprintFnCallSites,
} from "../../workspace/services/ui-editor/blueprint/fnCatalog";
import { ownerRefToIndexKey } from "../../workspace/services/ui-editor/blueprint/ownerKeys";
import { listBlueprintGraphSites } from "../blueprintSites";
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
            "surfaceMain:s1": { blueprintId: "bp1" },
        },
        blueprints: {
            bp1: {
                id: "bp1",
                name: "Title Screen",
                // The owner the record above files it under. Spelled out because what a graph may
                // reach is decided by it - fn visibility is the case with teeth.
                owner: { kind: "surfaceMain", surfaceId: "s1" },
                graphs: {
                    events: wrap(input.events ?? {}),
                    functions: wrap(input.functions ?? {}),
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

/** A UI document declaring exactly the input actions named, keyed as the vocabulary is. */
function uiDocumentWithActions(...actionIds: string[]): UIDocument {
    return {
        surfaces: [],
        elements: {},
        actions: Object.fromEntries(actionIds.map(id => [id, { id, name: id, bindings: [] }])),
    } as unknown as UIDocument;
}

/** A story document whose one scene declares one `/ending` row, under the id passed. */
function storyWithEnding(endingId: string) {
    return {
        id: "story-1",
        scenes: {
            "scene-1": {
                id: "scene-1",
                name: "Final Hours",
                rootBlockIds: [endingId],
                blocks: {
                    [endingId]: {
                        id: endingId,
                        kind: "control",
                        payload: { control: "ending", name: "Sunrise" },
                        childrenIds: [],
                    },
                },
            },
        },
        unassignedSceneIds: ["scene-1"],
    } as unknown as StoryDocument;
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
            localizationKeys: new Map([["farewell", "See you."]]),
        };
        expect(await run("blueprint/reference-missing", createTestLintContext(base))).toHaveLength(1);
        // The key registry not having loaded is the localization equivalent, and is also silent.
        expect(
            await run(
                "blueprint/reference-missing",
                createTestLintContext({ ...base, localizationKeys: null }),
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
                localizationKeys: new Map([["farewell", "See you."]]),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("reports an ending the story no longer declares, and says nothing about one it does", async () => {
        // The `ending` row IS the declaration, so a deleted row leaves a node asking a question no
        // playthrough can answer yes to - it reads `false` forever with nothing on screen to say why.
        const graph = (endingId: string): BlueprintGraphIr => ({
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                reached: {
                    id: "reached",
                    type: BLUEPRINT_NODE_TYPE_GAME_IS_ENDING_REACHED,
                    params: { storyId: "story-1", endingId },
                },
                log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "log", port: "in" } },
                { from: { nodeId: "reached", port: "isReached" }, to: { nodeId: "log", port: "message" } },
            ],
        });
        const stories = [{ id: "story-1", name: "Chapter One", document: storyWithEnding("ending-good") }];

        const missing = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: graph("ending-deleted") } }),
                stories,
            }),
        );
        expect(missing).toHaveLength(1);
        expect(missing[0]).toMatchObject({
            messageKey: "lint.rule.blueprintReferenceMissing.messageEnding",
            location: { kind: "blueprint", nodeId: "reached" },
        });

        const present = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: graph("ending-good") } }),
                stories,
            }),
        );
        expect(present).toEqual([]);
    });

    it("reports a DLC the project no longer has, and says nothing about one it does", async () => {
        // Deleting a DLC leaves every node that named it answering false forever, so the entrance
        // behind it is never drawn again and nothing on screen says why.
        const graph = (dlcId: string): BlueprintGraphIr => ({
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                installed: {
                    id: "installed",
                    type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED,
                    params: { dlcId },
                },
                log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "log", port: "in" } },
                { from: { nodeId: "installed", port: "isInstalled" }, to: { nodeId: "log", port: "message" } },
            ],
        });
        const dlcs = [{ id: "summer", name: "Summer Route", attachTo: APP_TAG_ID_RELEASE }];

        const missing = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: graph("winter") } }),
                dlcs,
            }),
        );
        expect(missing).toHaveLength(1);
        expect(missing[0]).toMatchObject({
            messageKey: "lint.rule.blueprintReferenceMissing.messageDlc",
            location: { kind: "blueprint", nodeId: "installed" },
        });

        const present = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: graph("summer") } }),
                dlcs,
            }),
        );
        expect(present).toEqual([]);
    });

    it("reports an input action the project no longer declares, and says nothing about one it does", async () => {
        // An `On Action` head naming a deleted action is silent twice over: nothing raises that name
        // any more, and on the canvas it looks exactly like a head waiting for its gesture.
        const graph = (actionId: string): BlueprintGraphIr => ({
            nodes: {
                head: {
                    id: "head",
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
                    params: { [BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID]: actionId },
                },
                log: { id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: {} },
            },
            edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "log", port: "in" } }],
        });

        const missing = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onAction: graph("dismiss") } }),
                uiDocument: uiDocumentWithActions("advance"),
            }),
        );
        expect(missing).toHaveLength(1);
        expect(missing[0]).toMatchObject({
            messageKey: "lint.rule.blueprintReferenceMissing.messageInputAction",
            location: { kind: "blueprint", nodeId: "head" },
        });

        const present = await run(
            "blueprint/reference-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onAction: graph("advance") } }),
                uiDocument: uiDocumentWithActions("advance"),
            }),
        );
        expect(present).toEqual([]);
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

/**
 * The one fault in the DLC seam an author cannot see from the inside: Dev Mode carries every story
 * the project has, so the entrance they are testing always works there. The base build does not
 * carry the DLC's story, and the button fails for the player who has not bought it.
 */
describe("blueprint/dlc-entrance-unguarded", () => {
    const entrance = (extra?: BlueprintGraphIr["nodes"]): BlueprintGraphIr => ({
        nodes: {
            head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
            start: {
                id: "start",
                type: BLUEPRINT_NODE_TYPE_GAME_START_STORY,
                params: { storyId: "story-dlc", sceneId: "scene-1" },
            },
            ...extra,
        },
        edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "start", port: "in" } }],
    });

    const stories = [
        { id: "story-dlc", name: "Summer", document: storyWithEnding("e1"), dlcId: "summer" },
        { id: "story-base", name: "Main", document: storyWithEnding("e2") },
    ];

    it("is a warning by default", () => {
        expect(rule("blueprint/dlc-entrance-unguarded").defaultSeverity).toBe("warning");
    });

    it("reports a Start Story into a DLC's story that nothing in the graph guards", async () => {
        const findings = await run(
            "blueprint/dlc-entrance-unguarded",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: entrance() } }),
                stories,
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            messageKey: "lint.rule.blueprintDlcEntranceUnguarded.message",
            location: { kind: "blueprint", nodeId: "start" },
        });
    });

    it("says nothing when the graph asks about that DLC", async () => {
        const guard: BlueprintGraphIr["nodes"] = {
            guard: {
                id: "guard",
                type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED,
                params: { dlcId: "summer" },
            },
        };
        const findings = await run(
            "blueprint/dlc-entrance-unguarded",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: entrance(guard) } }),
                stories,
            }),
        );
        expect(findings).toEqual([]);
    });

    it("is not satisfied by a guard on a different DLC", async () => {
        const guard: BlueprintGraphIr["nodes"] = {
            guard: {
                id: "guard",
                type: BLUEPRINT_NODE_TYPE_GAME_IS_DLC_INSTALLED,
                params: { dlcId: "winter" },
            },
        };
        const findings = await run(
            "blueprint/dlc-entrance-unguarded",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: entrance(guard) } }),
                stories,
            }),
        );
        expect(findings).toHaveLength(1);
    });

    it("says nothing about a story the game itself carries", async () => {
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                start: {
                    id: "start",
                    type: BLUEPRINT_NODE_TYPE_GAME_START_STORY,
                    params: { storyId: "story-base", sceneId: "scene-1" },
                },
            },
            edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "start", port: "in" } }],
        };
        const findings = await run(
            "blueprint/dlc-entrance-unguarded",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }),
                stories,
            }),
        );
        expect(findings).toEqual([]);
    });
});

describe("blueprint/element-ref-missing", () => {
    /** `On Element Click`, bound to whatever `(surface, element)` is passed. */
    function elementClickGraph(surfaceId: string, elementId: string): BlueprintGraphIr {
        return {
            nodes: {
                head: {
                    id: "head",
                    type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
                    params: {
                        [ELEMENT_REF_PARAM_SURFACE_ID]: surfaceId,
                        [ELEMENT_REF_PARAM_ELEMENT_ID]: elementId,
                        [ELEMENT_REF_PARAM_ELEMENT_TYPE]: "nl.button",
                    },
                },
            },
            edges: [],
        };
    }

    /** A page holding `pageElementIds`, plus one component definition holding `componentElementId`. */
    function uiDocumentWithElements(pageElementIds: string[], componentElementId?: string): UIDocument {
        return {
            surfaces: [{ id: "s1", kind: "appSurface", rootElementId: "root" }],
            elements: Object.fromEntries(pageElementIds.map(id => [id, { id, type: "nl.button", childrenIds: [] }])),
            ...(componentElementId
                ? {
                    components: [{
                        id: "c1",
                        name: "Card",
                        rootElementId: componentElementId,
                        elements: {
                            [componentElementId]: { id: componentElementId, type: "nl.button", childrenIds: [] },
                        },
                    }],
                }
                : {}),
        } as unknown as UIDocument;
    }

    it("is an error by default", () => {
        expect(rule("blueprint/element-ref-missing").defaultSeverity).toBe("error");
    });

    it("reports a head bound to a widget the project does not have", async () => {
        // The shape a graph fragment pasted from another project arrives in: the element id is a
        // UUID that project minted, and nothing here answers to it.
        const findings = await run(
            "blueprint/element-ref-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: { onClick: elementClickGraph("surface-elsewhere", "element-elsewhere") },
                }),
                uiDocument: uiDocumentWithElements(["button-here"]),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "blueprint/element-ref-missing",
            messageKey: "lint.rule.blueprintElementRefMissing.message",
            location: { kind: "blueprint", blueprintId: "bp1", graphId: "onClick", nodeId: "head" },
            target: { kind: "blueprint", ownerKey: "surfaceMain:s1", focusEventId: "onClick", focusNodeId: "head" },
        });
    });

    it("says nothing about a widget that is on a page", async () => {
        const findings = await run(
            "blueprint/element-ref-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onClick: elementClickGraph("s1", "button-here") } }),
                uiDocument: uiDocumentWithElements(["button-here"]),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a widget that lives inside a component definition", async () => {
        // The one shape that makes a narrower universe wrong: a component keeps its elements in its
        // own table, so a set built from `document.elements` alone would report every binding inside
        // a component's blueprint - a rule firing on correct graphs.
        const findings = await run(
            "blueprint/element-ref-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: { onClick: elementClickGraph("component-editor:c1", "button-in-component") },
                }),
                uiDocument: uiDocumentWithElements(["button-here"], "button-in-component"),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a node with no widget chosen", async () => {
        const findings = await run(
            "blueprint/element-ref-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onClick: elementClickGraph("s1", "") } }),
                uiDocument: uiDocumentWithElements(["button-here"]),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("reports nothing when the interface document could not be read", async () => {
        // A null document is not an empty one: treating it as one would report every binding in the
        // project off a single failed read.
        const findings = await run(
            "blueprint/element-ref-missing",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: { onClick: elementClickGraph("surface-elsewhere", "element-elsewhere") },
                }),
            }),
        );
        expect(findings).toEqual([]);
    });
});

describe("blueprint/fn-target-missing", () => {
    /** One blueprint's contribution: the fns it declares, and the calls it makes. */
    type FnBlueprintSpec = {
        id: string;
        owner: BlueprintOwnerRef;
        /** Fn heads, by node id, each with the name its card prints. */
        heads?: Record<string, string>;
        /** `Call Fn` nodes, by node id: the ref stored, and the name the snapshot carries. */
        calls?: Record<string, { fnRef: string; snapshotName?: string }>;
    };

    /**
     * A document whose blueprints are each the active one for their own owner.
     *
     * Every blueprint gets an owner record, because a blueprint no record points at is skipped by
     * the corpus these rules sweep - a fixture without one would test nothing.
     */
    function fnDocument(...specs: FnBlueprintSpec[]): BlueprintDocument {
        const headNode = (nodeId: string, name: string) => ({
            id: nodeId,
            type: BLUEPRINT_NODE_TYPE_FN_HEAD,
            params: { [BLUEPRINT_NODE_PARAM_FN_NAME]: name },
        });
        const callNode = (nodeId: string, call: { fnRef: string; snapshotName?: string }) => ({
            id: nodeId,
            type: BLUEPRINT_NODE_TYPE_FN_CALL,
            params: {
                [BLUEPRINT_NODE_PARAM_FN_REF]: call.fnRef,
                ...(call.snapshotName
                    ? {
                        [BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT]: {
                            name: call.snapshotName,
                            params: [],
                            returns: [],
                        },
                    }
                    : {}),
            },
        });
        return {
            ownerRecords: Object.fromEntries(
                specs.map(spec => [
                    ownerRefToIndexKey(spec.owner),
                    { blueprintId: spec.id },
                ]),
            ),
            blueprints: Object.fromEntries(
                specs.map(spec => [
                    spec.id,
                    {
                        id: spec.id,
                        name: spec.id,
                        owner: spec.owner,
                        graphs: {
                            events: {
                                main: {
                                    id: "main",
                                    graph: {
                                        nodes: {
                                            ...Object.fromEntries(
                                                Object.entries(spec.heads ?? {}).map(([nodeId, name]) => [
                                                    nodeId,
                                                    headNode(nodeId, name),
                                                ]),
                                            ),
                                            ...Object.fromEntries(
                                                Object.entries(spec.calls ?? {}).map(([nodeId, call]) => [
                                                    nodeId,
                                                    callNode(nodeId, call),
                                                ]),
                                            ),
                                        },
                                        edges: [],
                                    },
                                },
                            },
                            functions: {},
                        },
                    },
                ]),
            ),
        } as unknown as BlueprintDocument;
    }

    const globalOwner: BlueprintOwnerRef = { kind: "globalMain" };
    const surfaceOwner: BlueprintOwnerRef = { kind: "surfaceMain", surfaceId: "s1" };
    const otherSurfaceOwner: BlueprintOwnerRef = { kind: "surfaceMain", surfaceId: "s2" };

    it("is an error by default", () => {
        // The same standing the graph editor already gives it on the canvas. Anything lower and the
        // report and the editor would say two different things about one node.
        expect(rule("blueprint/fn-target-missing").defaultSeverity).toBe("error");
    });

    it("reports a call whose blueprint is not in this project", async () => {
        // The shape a fragment pasted from another project arrives in: both halves of the ref are
        // ids that project minted, and nothing here answers to either.
        const findings = await run(
            "blueprint/fn-target-missing",
            createTestLintContext({
                blueprintDocument: fnDocument({
                    id: "bp-caller",
                    owner: surfaceOwner,
                    calls: { call: { fnRef: createBlueprintFnRef("bp-elsewhere", "head-elsewhere"), snapshotName: "Refresh" } },
                }),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "blueprint/fn-target-missing",
            messageKey: "lint.rule.blueprintFnTargetMissing.messageNamed",
            messageParams: { name: "Refresh" },
            location: { kind: "blueprint", blueprintId: "bp-caller", graphId: "main", nodeId: "call" },
            target: { kind: "blueprint", ownerKey: "surfaceMain:s1", focusEventId: "main", focusNodeId: "call" },
        });
    });

    it("reports a call whose blueprint is here but whose function has been deleted", async () => {
        // The other half of the fault, and the one a project reaches on its own: the blueprint is
        // the right one, the head node inside it is gone.
        const findings = await run(
            "blueprint/fn-target-missing",
            createTestLintContext({
                blueprintDocument: fnDocument(
                    {
                        id: "bp-caller",
                        owner: surfaceOwner,
                        calls: { call: { fnRef: createBlueprintFnRef("bp-global", "head-deleted"), snapshotName: "Refresh" } },
                    },
                    { id: "bp-global", owner: globalOwner, heads: { "head-kept": "Kept" } },
                ),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "blueprint/fn-target-missing",
            location: { kind: "blueprint", blueprintId: "bp-caller", nodeId: "call" },
        });
    });

    it("reports a call whose function exists but is out of reach from this graph", async () => {
        // What makes a set of ids the wrong answer here: a surface's fns are visible only on that
        // surface, so this ref is good where it was written and dead where it now sits. The rule
        // gets this right because it asks the resolver the editor asks, owner and all.
        const findings = await run(
            "blueprint/fn-target-missing",
            createTestLintContext({
                blueprintDocument: fnDocument(
                    {
                        id: "bp-caller",
                        owner: surfaceOwner,
                        calls: { call: { fnRef: createBlueprintFnRef("bp-other-surface", "head"), snapshotName: "Refresh" } },
                    },
                    { id: "bp-other-surface", owner: otherSurfaceOwner, heads: { head: "Refresh" } },
                ),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({ ruleId: "blueprint/fn-target-missing", location: { nodeId: "call" } });
    });

    it("falls back to a sentence with no name when the call carries no signature", async () => {
        // A ref is a pair of ids. Printing one would put a UUID in the report, which is a word
        // nobody can search a project for.
        const findings = await run(
            "blueprint/fn-target-missing",
            createTestLintContext({
                blueprintDocument: fnDocument({
                    id: "bp-caller",
                    owner: surfaceOwner,
                    calls: { call: { fnRef: createBlueprintFnRef("bp-elsewhere", "head-elsewhere") } },
                }),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageKey).toBe("lint.rule.blueprintFnTargetMissing.message");
        expect(findings[0].messageParams).toBeUndefined();
    });

    it("says nothing about a call that resolves", async () => {
        const findings = await run(
            "blueprint/fn-target-missing",
            createTestLintContext({
                blueprintDocument: fnDocument(
                    {
                        id: "bp-caller",
                        owner: surfaceOwner,
                        calls: { call: { fnRef: createBlueprintFnRef("bp-global", "head"), snapshotName: "Refresh" } },
                    },
                    { id: "bp-global", owner: globalOwner, heads: { head: "Refresh" } },
                ),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a call with no function chosen", async () => {
        // An unfinished node, not a broken one - an empty select the author can see, and the graph
        // editor's own `fn.call_unset`.
        const findings = await run(
            "blueprint/fn-target-missing",
            createTestLintContext({
                blueprintDocument: fnDocument({
                    id: "bp-caller",
                    owner: surfaceOwner,
                    calls: { call: { fnRef: "" } },
                }),
            }),
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a project with no blueprints", async () => {
        expect(await run("blueprint/fn-target-missing", createTestLintContext())).toEqual([]);
        expect(
            await run("blueprint/fn-target-missing", createTestLintContext({ blueprintDocument: fnDocument() })),
        ).toEqual([]);
    });

    it("says nothing about the starter template every new project begins as", async () => {
        // An error rule that fired on the shipped skeleton would make every new project fail its
        // first build. The template really does call fns - a dozen of them - so this is not a sweep
        // over nothing, which is what the first assertion is here to prove.
        const template = JSON.parse(
            fs.readFileSync(
                path.join(process.cwd(), "resources/templates/skeleton/content/editor/ui/uigraphs.json"),
                "utf-8",
            ),
        ) as { blueprintDocument: BlueprintDocument };
        const calls = listBlueprintGraphSites(template.blueprintDocument).flatMap(site =>
            listBlueprintFnCallSites(site.ir),
        );
        expect(calls.length).toBeGreaterThan(0);
        const findings = await run(
            "blueprint/fn-target-missing",
            createTestLintContext({ blueprintDocument: template.blueprintDocument }),
        );
        expect(findings).toEqual([]);
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
describe("blueprint/unknown-node", () => {
    it("is an error by default", () => {
        // A shipped game runs nothing for an unknown node, so what plays is not what the author
        // built; a downgrade here would let that ship.
        expect(rule("blueprint/unknown-node").defaultSeverity).toBe("error");
    });

    it("reports a node whose type the project cannot load", async () => {
        const findings = await run(
            "blueprint/unknown-node",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: {
                        onBoot: {
                            nodes: {
                                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                                mystery: { id: "mystery", type: "com.example.plugin.doThing", params: {} },
                            },
                            edges: [{ from: { nodeId: "head", port: "then" }, to: { nodeId: "mystery", port: "in" } }],
                        },
                    },
                }),
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            ruleId: "blueprint/unknown-node",
            messageKey: "lint.rule.blueprintUnknownNode.message",
            messageParams: { type: "com.example.plugin.doThing" },
            location: { kind: "blueprint", blueprintId: "bp1", graphId: "onBoot", nodeId: "mystery" },
        });
    });

    it("says nothing when every node type is known", async () => {
        const findings = await run(
            "blueprint/unknown-node",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ events: { onBoot: goPageGraph("s1") } }) }),
        );
        expect(findings).toEqual([]);
    });
});
describe("blueprint/save-field-empty", () => {
    const CHAPTER: SaveSchemaField = {
        id: "f-chapter",
        name: "Chapter",
        valueType: "string",
        storageKey: "chapter",
        defaultValue: "Prologue",
        order: 0,
    };
    const PIN = saveSchemaPinId(CHAPTER.id);

    function graphWithSave(saveParams: Record<string, unknown>, extraEdges: BlueprintGraphIr["edges"] = []): BlueprintGraphIr {
        return {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                save: { id: "save", type: BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE, params: saveParams },
                literal: { id: "literal", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "Act One" } },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "save", port: "in" } },
                ...(extraEdges ?? []),
            ],
        };
    }

    afterEach(() => {
        setActiveSaveSchemaFields([]);
    });

    it("is an error by default", () => {
        expect(rule("blueprint/save-field-empty").defaultSeverity).toBe("error");
    });

    it("says nothing when the project has declared no fields", async () => {
        const findings = await run(
            "blueprint/save-field-empty",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ events: { onBoot: graphWithSave({ id: "slot-1" }) } }) }),
        );
        expect(findings).toEqual([]);
    });

    it("reports a declared field left empty on a save that will run", async () => {
        setActiveSaveSchemaFields([CHAPTER]);
        const findings = await run(
            "blueprint/save-field-empty",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ events: { onBoot: graphWithSave({ id: "slot-1" }) } }) }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ field: "Chapter" });
        expect(findings[0].location).toMatchObject({ kind: "blueprint", nodeId: "save" });
    });

    it("accepts a wired pin", async () => {
        setActiveSaveSchemaFields([CHAPTER]);
        const graph = graphWithSave({ id: "slot-1" }, [
            { from: { nodeId: "literal", port: "value" }, to: { nodeId: "save", port: PIN } },
        ]);
        const findings = await run(
            "blueprint/save-field-empty",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }) }),
        );
        expect(findings).toEqual([]);
    });

    it("accepts a value typed on the card, including an empty one", async () => {
        // An author who typed nothing into a string field chose the empty string; a rule that argued
        // with that would fire on a slot deliberately left unnamed.
        setActiveSaveSchemaFields([CHAPTER]);
        for (const value of ["Act One", ""]) {
            const findings = await run(
                "blueprint/save-field-empty",
                createTestLintContext({
                    blueprintDocument: documentWithGraphs({ events: { onBoot: graphWithSave({ id: "slot-1", [PIN]: value }) } }),
                }),
            );
            expect(findings).toEqual([]);
        }
    });

    it("leaves a save nothing leads to alone", async () => {
        // Already blueprint/unreachable-node; saying it twice helps nobody.
        setActiveSaveSchemaFields([CHAPTER]);
        const graph: BlueprintGraphIr = {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                save: { id: "save", type: BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE, params: { id: "slot-1" } },
            },
            edges: [],
        };
        const findings = await run(
            "blueprint/save-field-empty",
            createTestLintContext({ blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }) }),
        );
        expect(findings).toEqual([]);
    });
});

describe("blueprint/start-scene-foreign", () => {
    /** Two stories with a scene each, the way a project with routes has them. */
    function storyWithScene(storyId: string, sceneId: string, sceneName: string) {
        return {
            id: storyId,
            scenes: {
                [sceneId]: { id: sceneId, name: sceneName, rootBlockIds: [], blocks: {} },
            },
            unassignedSceneIds: [sceneId],
        } as unknown as StoryDocument;
    }

    const stories = [
        { id: "story-prologue", name: "Prologue", document: storyWithScene("story-prologue", "corridor", "The corridor") },
        { id: "story-trial", name: "Class Trial", document: storyWithScene("story-trial", "courtroom", "The courtroom") },
    ];

    function startGraph(params: Record<string, unknown>, edges: BlueprintGraphIr["edges"] = []): BlueprintGraphIr {
        return {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT, params: {} },
                start: { id: "start", type: BLUEPRINT_NODE_TYPE_GAME_START_STORY, params },
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: "start", port: "in" } },
                ...(edges ?? []),
            ],
        };
    }

    it("is an error by default", () => {
        expect(rule("blueprint/start-scene-foreign").defaultSeverity).toBe("error");
    });

    it("reports a scene that belongs to another story, and names both", async () => {
        const findings = await run(
            "blueprint/start-scene-foreign",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: { onBoot: startGraph({ storyId: "story-prologue", sceneId: "courtroom" }) },
                }),
                stories,
            }),
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            messageKey: "lint.rule.blueprintStartSceneForeign.message",
            messageParams: { story: "Prologue", owner: "Class Trial" },
            location: { kind: "blueprint", nodeId: "start" },
        });
    });

    it("says nothing when the pair goes together", async () => {
        const findings = await run(
            "blueprint/start-scene-foreign",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: { onBoot: startGraph({ storyId: "story-trial", sceneId: "courtroom" }) },
                }),
                stories,
            }),
        );
        expect(findings).toEqual([]);
    });

    /** A dangling id is `blueprint/reference-missing`'s finding; two sentences for one node is one too many. */
    it("leaves an id that names nothing to the reference rule", async () => {
        const findings = await run(
            "blueprint/start-scene-foreign",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: { onBoot: startGraph({ storyId: "story-prologue", sceneId: "scene-deleted" }) },
                }),
                stories,
            }),
        );
        expect(findings).toEqual([]);
    });

    it("does not judge a pair computed at run time", async () => {
        const graph = startGraph({ storyId: "story-prologue", sceneId: "courtroom" }, [
            { from: { nodeId: "head", port: "then" }, to: { nodeId: "start", port: "sceneId" } },
        ]);
        const findings = await run(
            "blueprint/start-scene-foreign",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({ events: { onBoot: graph } }),
                stories,
            }),
        );
        expect(findings).toEqual([]);
    });

    /** A library read only in part would call every scene in the missing story foreign. */
    it("says nothing when the library could not be read whole", async () => {
        const findings = await run(
            "blueprint/start-scene-foreign",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: { onBoot: startGraph({ storyId: "story-prologue", sceneId: "courtroom" }) },
                }),
                stories,
                storiesComplete: false,
            }),
        );
        expect(findings).toEqual([]);
    });
});

describe("blueprint/required-input-unwired", () => {
    /** `On Element Click -> <node>`, so the node under test is one something will run. */
    function graphWith(
        node: { id: string; type: string; params?: Record<string, unknown> },
        extra?: { nodes?: BlueprintGraphIr["nodes"]; edges?: BlueprintGraphIr["edges"] },
    ): BlueprintGraphIr {
        return {
            nodes: {
                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, params: {} },
                ...(extra?.nodes ?? {}),
                [node.id]: node,
            },
            edges: [
                { from: { nodeId: "head", port: "then" }, to: { nodeId: node.id, port: "in" } },
                ...(extra?.edges ?? []),
            ],
        };
    }

    it("is a warning by default", () => {
        expect(rule("blueprint/required-input-unwired").defaultSeverity).toBe("warning");
    });

    it("names the node and the pin nobody wired", async () => {
        const findings = await run(
            "blueprint/required-input-unwired",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: {
                        onClick: graphWith({
                            id: "setText",
                            type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT,
                            params: { text: "Hello" },
                        }),
                    },
                }),
            }),
        );

        expect(findings).toHaveLength(1);
        expect(findings[0].messageParams).toEqual({ node: "Set Text", pin: "Element" });
        expect(findings[0].location).toMatchObject({ kind: "blueprint", nodeId: "setText" });
    });

    it("says nothing when the pin is wired", async () => {
        const findings = await run(
            "blueprint/required-input-unwired",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: {
                        onClick: graphWith(
                            { id: "setText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: { text: "Hello" } },
                            {
                                nodes: {
                                    ref: {
                                        id: "ref",
                                        type: BLUEPRINT_NODE_TYPE_ELEMENT_REF,
                                        params: { [ELEMENT_REF_PARAM_ELEMENT_ID]: "label" },
                                    },
                                },
                                edges: [
                                    { from: { nodeId: "ref", port: "element" }, to: { nodeId: "setText", port: "element" } },
                                ],
                            },
                        ),
                    },
                }),
            }),
        );

        expect(findings).toEqual([]);
    });

    it("says nothing about a pin the card carries a value for, nor about an optional one", async () => {
        const findings = await run(
            "blueprint/required-input-unwired",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: {
                        // Log's Value is filled in; Play Sound takes every one of its pins from the
                        // inspector when unwired and declares them optional.
                        onClick: graphWith({ id: "log", type: BLUEPRINT_NODE_TYPE_LOG, params: { value: "" } }),
                        onPlay: graphWith({ id: "play", type: BLUEPRINT_NODE_TYPE_SOUND_PLAY, params: {} }),
                    },
                }),
            }),
        );

        expect(findings).toEqual([]);
    });

    it("leaves a draft nothing reaches alone", async () => {
        const findings = await run(
            "blueprint/required-input-unwired",
            createTestLintContext({
                blueprintDocument: documentWithGraphs({
                    events: {
                        onClick: {
                            nodes: {
                                head: { id: "head", type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK, params: {} },
                                setText: { id: "setText", type: BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT, params: {} },
                            },
                            edges: [],
                        },
                    },
                }),
            }),
        );

        expect(findings).toEqual([]);
    });

    it("reports the shipped skeleton clean, and says so only because it can report", async () => {
        // A zero here is exactly what a rule that checks nothing produces, so the same corpus is run
        // twice: once as it ships, and once with one Element edge cut.
        const document = skeletonBlueprintDocument();
        expect(await run("blueprint/required-input-unwired", createTestLintContext({ blueprintDocument: document }))).toEqual([]);

        const damaged = JSON.parse(JSON.stringify(document)) as BlueprintDocument;
        const cut = cutOneElementEdge(damaged);
        expect(cut).toBe(true);
        const findings = await run("blueprint/required-input-unwired", createTestLintContext({ blueprintDocument: damaged }));
        expect(findings.length).toBeGreaterThan(0);
    });
});

/** The blueprint document the skeleton project template ships with. */
function skeletonBlueprintDocument(): BlueprintDocument {
    const file = path.join(__dirname, "..", "..", "..", "..", "..", "resources", "templates", "skeleton", "content", "editor", "ui", "uigraphs.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { blueprintDocument: BlueprintDocument };
    return raw.blueprintDocument;
}

/** Remove the first edge feeding an `element` pin, and say whether there was one. */
function cutOneElementEdge(document: BlueprintDocument): boolean {
    for (const blueprint of Object.values(document.blueprints)) {
        for (const graph of Object.values(blueprint.graphs.events ?? {})) {
            const edges = graph.graph?.edges ?? [];
            const index = edges.findIndex(edge => edge.to.port === "element");
            if (index >= 0) {
                edges.splice(index, 1);
                return true;
            }
        }
    }
    return false;
}
