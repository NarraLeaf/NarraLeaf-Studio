/**
 * Blueprint execution locals (per event dispatch), backed by blueprint.members.variables defaults.
 */

import type { BlueprintNodeDef } from "../types";
import {
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_VARIABLE_TYPE_OPTIONS } from "@shared/types/blueprint/variableTypes";
import { resolveDataPinValue } from "./graphParamResolvers";

const VARIABLE_TYPE_SELECT_OPTIONS = BLUEPRINT_VARIABLE_TYPE_OPTIONS.map(option => ({
    value: option.value,
    label: option.label,
}));

export const localVariableBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
        displayName: "Var",
        category: "Variables",
        keywords: ["var", "declare", "definition", "local", "variable", "default"],
        graphKinds: ["event", "function", "macro"],
        isPure: true,
        scope: { ownerKinds: ["widgetMain", "widgetValue", "sharedAsset"] },
        pins: [],
        inspectorParams: [
            { key: "name", label: "Name", kind: "string" },
            { key: "valueType", label: "Data type", kind: "select", options: VARIABLE_TYPE_SELECT_OPTIONS },
            { key: "defaultValue", label: "Default", kind: "literal" },
        ],
        execute: () => ({}),
    },
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
                valueType: "any",
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
                0,
                {
                    hostAdapter: ctx.hostAdapter,
                    eventPayload: ctx.eventPayload,
                    listItemScope: ctx.listItemScope,
                    instanceKey: ctx.instanceKey,
                    executionOwner: ctx.executionOwner,
                },
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
                valueType: "any",
                label: "Value",
            },
        ],
        inspectorParams: [{ key: "variableId", label: "Variable", kind: "variableRef" }],
        // Pure data source; value is read via resolveDataPinValue when consumed.
        execute: () => ({}),
    },
];
