import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_NETWORK_FETCH,
    BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON,
} from "@shared/types/blueprint/graph";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { createTestLintContext } from "../testContext";
import { collectBlueprintNetworkNodes, NETWORK_LINT_RULES } from "./network";

/**
 * `network/fetch-disallowed`, plus the sweep the build gate shares with it.
 *
 * The sweep is tested directly and not only through the rule, because `BuildService.runNetworkGate`
 * calls it with the project setting already checked - so a bug that made it miss a graph would be
 * invisible from the rule's side (the rule would just report nothing) and would let a build ship.
 */

const RULE = NETWORK_LINT_RULES[0]!;

/** A document with one Fetch on an event, one Read Response JSON in a macro, and one innocent node. */
function documentWithNetworkNodes(): BlueprintDocument {
    return {
        ownerRecords: {
            "surface:main": { activeBlueprintId: "bp1", privateBlueprintIds: [] },
        },
        blueprints: {
            bp1: {
                id: "bp1",
                name: "Title Screen",
                program: {
                    kind: "graph",
                    graphs: {
                        events: {
                            ev1: {
                                graph: {
                                    nodes: {
                                        n1: { id: "n1", type: BLUEPRINT_NODE_TYPE_NETWORK_FETCH },
                                        n2: { id: "n2", type: "blueprint.flow.branch" },
                                    },
                                },
                            },
                        },
                        functions: {},
                        // A node buried in a macro ships exactly like one on an event.
                        macros: {
                            mc1: {
                                graph: {
                                    nodes: {
                                        n3: { id: "n3", type: BLUEPRINT_NODE_TYPE_NETWORK_READ_RESPONSE_JSON },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    } as unknown as BlueprintDocument;
}

describe("collectBlueprintNetworkNodes", () => {
    it("finds network nodes in events and macros, and nothing else", () => {
        const sites = collectBlueprintNetworkNodes(documentWithNetworkNodes());
        expect(sites.map(site => site.nodeId).sort()).toEqual(["n1", "n3"]);
    });

    it("gives every site a navigable jump target", () => {
        // A finding whose target has no resolvable ownerKey renders as a row that silently does
        // nothing when clicked, because `jumpToSearchTarget` returns false and the report tab does
        // not check. Asserting ownerKey here is what keeps that from shipping.
        for (const site of collectBlueprintNetworkNodes(documentWithNetworkNodes())) {
            expect(site.target).toMatchObject({ kind: "blueprint", blueprintId: "bp1", ownerKey: "surface:main" });
            expect(site.target).toHaveProperty("focusNodeId", site.nodeId);
        }
    });

    it("skips a blueprint no owner record points at", () => {
        const document = documentWithNetworkNodes();
        (document as unknown as { ownerRecords: Record<string, unknown> }).ownerRecords = {};
        expect(collectBlueprintNetworkNodes(document)).toEqual([]);
    });

    it("reads an absent document as no network nodes", () => {
        expect(collectBlueprintNetworkNodes(null)).toEqual([]);
    });
});

describe("network/fetch-disallowed", () => {
    it("is an error by default", () => {
        // The severity is the whole reason the lint gate refuses a build on it; a downgrade here
        // would silently turn the finding into something a default project builds through.
        expect(RULE.defaultSeverity).toBe("error");
    });

    it("reports every network node when the project does not allow HTTP", async () => {
        const findings = await RULE.run(
            createTestLintContext({
                network: { allowHttp: false, allowRemoteResource: false, allowRemoteScript: false, policy: "any", allowlist: [] },
                blueprintDocument: documentWithNetworkNodes(),
            }),
            {},
        );
        expect(findings).toHaveLength(2);
        expect(findings[0]).toMatchObject({
            ruleId: "network/fetch-disallowed",
            messageKey: "lint.rule.networkFetchDisallowed.message",
            messageParams: { blueprint: "Title Screen" },
            location: { kind: "blueprint", blueprintId: "bp1" },
        });
    });

    it("says nothing when the project allows HTTP", async () => {
        const findings = await RULE.run(
            createTestLintContext({
                network: { allowHttp: true, allowRemoteResource: false, allowRemoteScript: false, policy: "any", allowlist: [] },
                blueprintDocument: documentWithNetworkNodes(),
            }),
            {},
        );
        expect(findings).toEqual([]);
    });

    it("says nothing about a project with no network nodes", async () => {
        const findings = await RULE.run(
            createTestLintContext({
                network: { allowHttp: false, allowRemoteResource: false, allowRemoteScript: false, policy: "any", allowlist: [] },
            }),
            {},
        );
        expect(findings).toEqual([]);
    });
});
