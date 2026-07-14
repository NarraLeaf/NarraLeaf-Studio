/**
 * Fn nodes: declare (head), invoke (call), and return from scoped blueprint functions.
 * Fn heads live in event graphs; the fn identity is the head node id. Visibility follows
 * the fn catalog scoping rules (same surface for surface/widget decls, global decls everywhere).
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_PARAM_FN_NAME,
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS,
    BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FN_RETURN,
    readBlueprintFnSignatureSnapshot,
} from "@shared/types/blueprint/graph";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BehaviorNodeExecutionContext } from "../../behavior-graph/BehaviorNodeRegistry";
import type { BlueprintNodeDef } from "../types";
import { readDynamicInputPinIds } from "../effectivePins";
import { resolveDataPinValue } from "./graphParamResolvers";

/** Value types offered by the per-pin type picker on Fn head params and Fn Return results. */
export const BLUEPRINT_FN_PIN_VALUE_TYPE_OPTIONS = [
    "string",
    "integer",
    "float",
    "boolean",
    "json",
    "any",
] as const;

function dataPinResolveRuntime(ctx: BehaviorNodeExecutionContext) {
    return {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
        valueExecution: ctx.valueExecution,
    };
}

export const fnBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_FN_HEAD,
        displayName: "Fn",
        category: "Functions",
        keywords: ["fn", "function", "define", "declare", "call"],
        graphKinds: ["event"],
        isPure: false,
        role: "fnHead",
        scope: { ownerKinds: ["globalMain", "surfaceMain", "widgetMain", "storyAction"] },
        pins: [{ id: "then", kind: "output", semantic: "exec", label: "Body" }],
        dynamicInputPins: {
            storageKey: BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS,
            fixedDataInputIds: [],
            generatedIdPrefix: "param",
            valueType: "string",
            allowInlineLiteral: false,
            addButtonLabel: "Add parameter",
            pinLabelParamKey: BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS,
            defaultPinLabelPrefix: "param",
            pinValueTypeParamKey: BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES,
            pinValueTypeOptions: BLUEPRINT_FN_PIN_VALUE_TYPE_OPTIONS,
            editableGeneratedOutputPins: true,
            generatedPinTemplates: [
                { idSuffix: "value", label: "Param", kind: "output", semantic: "data", valueType: "string" },
            ],
        },
        inspectorParams: [{ key: BLUEPRINT_NODE_PARAM_FN_NAME, label: "Fn Name", kind: "string" }],
        // Args are seeded into blueprintLocals by the dispatcher before execution starts.
        execute: () => ({ nextPort: "then" }),
    },
    {
        type: BLUEPRINT_NODE_TYPE_FN_RETURN,
        displayName: "Fn Return",
        category: "Functions",
        keywords: ["fn", "function", "return", "result", "end"],
        graphKinds: ["event"],
        isPure: false,
        scope: { ownerKinds: ["globalMain", "surfaceMain", "widgetMain", "storyAction"] },
        pins: [{ id: "in", kind: "input", semantic: "exec", label: "In" }],
        dynamicInputPins: {
            storageKey: BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS,
            fixedDataInputIds: [],
            generatedIdPrefix: "ret",
            valueType: "string",
            // Return results must be wired from a value source; no on-card inline literal.
            allowInlineLiteral: false,
            addButtonLabel: "Add return value",
            pinLabelParamKey: BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS,
            defaultPinLabelPrefix: "result",
            pinValueTypeParamKey: BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES,
            pinValueTypeOptions: BLUEPRINT_FN_PIN_VALUE_TYPE_OPTIONS,
            generatedPinTemplates: [
                {
                    idSuffix: "value",
                    label: "Result",
                    kind: "input",
                    semantic: "data",
                    valueType: "string",
                },
            ],
        },
        execute(ctx) {
            const pinIds = readDynamicInputPinIds(ctx.params, BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS);
            const returns: Record<string, unknown> = {};
            for (const pinId of pinIds) {
                returns[pinId] = resolveDataPinValue(
                    ctx.graph,
                    ctx.node.id,
                    pinId,
                    ctx.params,
                    ctx.blueprintLocals,
                    0,
                    dataPinResolveRuntime(ctx),
                );
            }
            ctx.valueExecution?.returnValue(returns);
            // Terminal: fn body execution ends here.
            return { nextPort: undefined };
        },
    },
    {
        type: BLUEPRINT_NODE_TYPE_FN_CALL,
        displayName: "Call Fn",
        category: "Functions",
        keywords: ["fn", "function", "call", "invoke", "run"],
        graphKinds: ["event"],
        isPure: false,
        isLatent: true,
        scope: { ownerKinds: ["globalMain", "surfaceMain", "widgetMain", "widgetValue", "storyAction"] },
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        inspectorParams: [
            {
                key: BLUEPRINT_NODE_PARAM_FN_REF,
                label: "Function",
                kind: "select",
                dynamicOptionsSource: "callableFns",
                emptyOptionLabel: "-",
            },
        ],
        async execute(ctx) {
            const runtime = ctx.hostAdapter.blueprintRuntime;
            if (!runtime?.invokeBlueprintFn) {
                throw new BlueprintGraphExecutionError("Fn runtime is unavailable", ctx.node.id);
            }
            const fnRef = String(ctx.params[BLUEPRINT_NODE_PARAM_FN_REF] ?? "").trim();
            if (!fnRef) {
                throw new BlueprintGraphExecutionError("Pick a function to call", ctx.node.id);
            }
            const snapshot = readBlueprintFnSignatureSnapshot(ctx.params);
            const args: Record<string, unknown> = {};
            for (const param of snapshot?.params ?? []) {
                args[param.pinId] = resolveDataPinValue(
                    ctx.graph,
                    ctx.node.id,
                    param.pinId,
                    ctx.params,
                    ctx.blueprintLocals,
                    0,
                    dataPinResolveRuntime(ctx),
                );
            }
            const result = await runtime.invokeBlueprintFn({
                fnRef,
                args,
                depth: ctx.fnCallDepth ?? 0,
                callerSurfaceId: ctx.executionOwner?.surfaceId,
                signal: ctx.signal,
                callerExecutionId: ctx.trace?.executionId,
            });
            return { outputValues: result.returns, nextPort: "next" };
        },
    },
];
