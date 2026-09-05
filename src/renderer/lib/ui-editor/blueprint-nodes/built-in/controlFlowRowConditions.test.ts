/**
 * A branch reads the row it is running for.
 *
 * Every list whose rows can be in two states asks the same question first - is this one unlocked,
 * visited, disabled - and asks it with an `If` whose condition comes off the row. That is the shape
 * a gallery grid, a scene board and a save list are all built on.
 *
 * It did not work. `If` and the first condition of `If Else` built their own resolve context out of
 * three of the five things an execution carries and left out the row, so `Get Item Field` feeding a
 * condition read nothing and the gate never opened - while the very same node feeding the node
 * *after* the branch read the row perfectly, and `If Else`'s second condition (which went through a
 * different helper) worked as well. A gate that is always shut and a value that is always right,
 * from one node, in one graph.
 *
 * Asserted through `executeGraph` rather than against the resolver, because the bug lived in what
 * the node handed the resolver rather than in the resolver itself.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import type { UIGraph } from "@shared/types/ui-editor/graph";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIStructDef } from "@shared/types/ui-editor/struct";
import { executeGraph } from "../../behavior-graph/GraphExecutor";

const STRUCT: UIStructDef = {
    id: "row",
    fields: [
        { id: "id", key: "id", type: "string" },
        { id: "unlocked", key: "unlocked", type: "boolean" },
    ],
};

/** One row of a list, in the shape a list hands its own blueprint on an item event. */
function row(unlocked: boolean): UIListItemScope {
    return { item: { id: "a", unlocked }, index: 0, count: 1, key: "a", struct: STRUCT };
}

/** `If` (or `If Else`) on the row's `unlocked` field, writing which branch ran into a local. */
function branchGraph(branchType: string, truePort: string, falsePort: string): UIGraph {
    return {
        id: "branch",
        entries: { main: { start: { nodeId: "gate", port: "in" } } },
        nodes: {
            gate: { id: "gate", type: branchType, params: {} },
            field: { id: "field", type: BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_FIELD, params: { field: "unlocked" } },
            openLabel: { id: "openLabel", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "open" } },
            shutLabel: { id: "shutLabel", type: BLUEPRINT_NODE_TYPE_LITERAL_STRING, params: { value: "shut" } },
            open: { id: "open", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "took" } },
            shut: { id: "shut", type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "took" } },
        },
        edges: [
            { from: { nodeId: "field", port: "value" }, to: { nodeId: "gate", port: "condition" } },
            { from: { nodeId: "gate", port: truePort }, to: { nodeId: "open", port: "in" } },
            { from: { nodeId: "gate", port: falsePort }, to: { nodeId: "shut", port: "in" } },
            { from: { nodeId: "openLabel", port: "value" }, to: { nodeId: "open", port: "value" } },
            { from: { nodeId: "shutLabel", port: "value" }, to: { nodeId: "shut", port: "value" } },
        ],
    } as UIGraph;
}

async function run(graph: UIGraph, scope: UIListItemScope): Promise<unknown> {
    const locals: Record<string, unknown> = {};
    await executeGraph({ graph, entry: graph.entries.main, blueprintLocals: locals, listItemScope: scope });
    return locals.took;
}

describe("a branch condition read off the row", () => {
    it.each([
        { name: "If", type: BLUEPRINT_NODE_TYPE_FLOW_IF, truePort: "true", falsePort: "false" },
        { name: "If Else", type: BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE, truePort: "then", falsePort: "else" },
    ])("$name takes the true branch when the row says so", async ({ type, truePort, falsePort }) => {
        expect(await run(branchGraph(type, truePort, falsePort), row(true))).toBe("open");
    });

    it.each([
        { name: "If", type: BLUEPRINT_NODE_TYPE_FLOW_IF, truePort: "true", falsePort: "false" },
        { name: "If Else", type: BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE, truePort: "then", falsePort: "else" },
    ])("$name still takes the false branch when it does not", async ({ type, truePort, falsePort }) => {
        expect(await run(branchGraph(type, truePort, falsePort), row(false))).toBe("shut");
    });
});
