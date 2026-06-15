/**
 * Blueprint execution locals (per event dispatch), backed by blueprint.members.variables defaults.
 */

import type { BlueprintNodeDef } from "../types";
import {
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { resolveDataPinValue } from "./graphParamResolvers";

export const localVariableBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_LOCAL_SET,
        displayName: "Set Var",
        category: "Variables",
        keywords: ["set", "local", "variable", "assign"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
            {
                id: "value",
                kind: "input",
                semantic: "data",
                valueType: "json",
                label: "Value",
            },
        ],
        inspectorParams: [{ key: "variableId", label: "Variable", kind: "variableRef" }],
        execute: ctx => {
            const vid = String(ctx.params.variableId ?? "").trim();
            if (!vid || !ctx.blueprintLocals) {
                return { nextPort: "next" };
            }
            ctx.blueprintLocals[vid] = resolveDataPinValue(
                ctx.graph,
                ctx.node.id,
                "value",
                ctx.params,
                ctx.blueprintLocals,
            );
            return { nextPort: "next" };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_LOCAL_GET,
        displayName: "Get Var",
        category: "Variables",
        keywords: ["get", "local", "variable", "read"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        pins: [
            {
                id: "value",
                kind: "output",
                semantic: "data",
                valueType: "json",
                label: "Value",
            },
        ],
        inspectorParams: [{ key: "variableId", label: "Variable", kind: "variableRef" }],
        // Pure data source; value is read via resolveDataPinValue when consumed.
        execute: () => ({}),
    },
];
