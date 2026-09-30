/**
 * A node reads its input pins through `resolveNodeInput`, and nothing but `graphParamResolvers.ts`
 * builds the runtime half of a data-pin read.
 *
 * That half says where the reading node is running - which host, which event, which list row, which
 * drawing, which owner, and whether it is part of a value binding - and every one of those is
 * something some pin's value depends on. It used to be spelled out by hand in each node module, and
 * the copies drifted in the way copies do: `If` resolved its condition without the row, so a gate on
 * a row's field never opened, and most copies were written before `valueExecution` existed, so a
 * widget getter wired into them inside a value binding never told the binding it had been read and
 * the binding never re-ran. Each was a pin that read wrong in exactly the graphs that needed it, and
 * none of them said so.
 *
 * Comments in English per project convention.
 */

import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_LOG,
} from "@shared/types/blueprint/graph";
import type { BlueprintValueDependency } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";
import { adaptBlueprintGraphIr } from "@/lib/ui-editor/blueprint-runtime/adaptBlueprintGraphIr";
import { PAGE, createRowRuntime, elementRefNode, graphOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { registerCoreBlueprintNodes } from "../registerCoreBlueprintNodes";
import { dataPinRuntimeOf } from "./graphParamResolvers";

const NODES_ROOT = path.resolve(__dirname, "..");
const THE_ONE_PLACE = path.join(NODES_ROOT, "built-in", "graphParamResolvers.ts");

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return sourceFiles(full);
        }
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

/**
 * A field only a data-pin read's runtime is made of, copied off the node's context by hand:
 * `listItemScope: ctx.listItemScope`. The instance key and the owner are left out on purpose - a
 * Delay's timer token carries those two for a reason of its own, and is not a pin read.
 */
const HAND_COPIED_FIELD = /\b(hostAdapter|eventPayload|listItemScope|valueExecution)\s*:\s*ctx\.\1\b/;

describe("the runtime half of a data-pin read", () => {
    const others = () => sourceFiles(NODES_ROOT).filter(file => file !== THE_ONE_PLACE);

    it("is never resolved by hand in a node module", () => {
        const resolvers = others().filter(file => /\bresolveDataPinValue\s*\(/.test(fs.readFileSync(file, "utf-8")));

        expect(resolvers.map(file => path.relative(NODES_ROOT, file))).toEqual([]);
    });

    it("is never copied off a node's context by hand", () => {
        const copies = others().filter(file => HAND_COPIED_FIELD.test(fs.readFileSync(file, "utf-8")));

        expect(copies.map(file => path.relative(NODES_ROOT, file))).toEqual([]);
    });

    it("carries every field of the node's context it names", () => {
        const ctx = {
            hostAdapter: { host: "app" },
            eventPayload: { index: 1 },
            listItemScope: { item: {}, index: 1, count: 2, key: "k" },
            instanceKey: "row",
            executionOwner: { surfaceId: PAGE },
            valueExecution: { returnValue: () => undefined },
        } as unknown as Parameters<typeof dataPinRuntimeOf>[0];

        expect(dataPinRuntimeOf(ctx)).toEqual({
            hostAdapter: ctx.hostAdapter,
            eventPayload: ctx.eventPayload,
            listItemScope: ctx.listItemScope,
            instanceKey: ctx.instanceKey,
            executionOwner: ctx.executionOwner,
            valueExecution: ctx.valueExecution,
        });
    });
});

describe("a widget getter wired into an exec node inside a value binding", () => {
    beforeAll(() => {
        registerCoreBlueprintNodes();
    });

    /** Run `graph` from its Init head as a value binding runs it, and collect what it said it read. */
    async function dependenciesOf(graph: ReturnType<typeof graphOf>): Promise<BlueprintValueDependency[]> {
        const page = createRowRuntime([]);
        const read: BlueprintValueDependency[] = [];
        await executeGraph({
            graph: adaptBlueprintGraphIr(graph as never, "value-graph"),
            entry: { start: { nodeId: "head", port: "then" } },
            hostAdapter: page.adapter,
            blueprintLocals: { copy: null },
            executionOwner: { surfaceId: PAGE, elementId: "grid", blueprintId: "bp-value" },
            valueExecution: { trackDependency: dependency => read.push(dependency) },
        });
        return read;
    }

    const viewerVisible = {
        viewer: elementRefNode("viewer"),
        visible: { type: BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE },
    };

    it("reports the read through Set Var, so the binding re-runs when it changes", async () => {
        const read = await dependenciesOf(
            graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                    ...viewerVisible,
                    set: { type: BLUEPRINT_NODE_TYPE_LOCAL_SET, params: { variableId: "copy" } },
                },
                exec: ["head", "set"],
                data: [
                    ["viewer", "element", "visible", "element"],
                    ["visible", "visible", "set", "value"],
                ],
            }),
        );

        expect(read).toContainEqual({ surfaceId: PAGE, elementId: "viewer", propPath: "layout.visible" });
    });

    it("reports the read through Log too", async () => {
        const read = await dependenciesOf(
            graphOf({
                nodes: {
                    head: { type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT },
                    ...viewerVisible,
                    log: { type: BLUEPRINT_NODE_TYPE_LOG },
                },
                exec: ["head", "log"],
                data: [
                    ["viewer", "element", "visible", "element"],
                    ["visible", "visible", "log", "value"],
                ],
            }),
        );

        expect(read).toContainEqual({ surfaceId: PAGE, elementId: "viewer", propPath: "layout.visible" });
    });
});
