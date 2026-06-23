/**
 * Control flow nodes.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_FLOW_DELAY,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
    BLUEPRINT_NODE_TYPE_FLOW_IF,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_FLOW_NOOP,
    BLUEPRINT_NODE_TYPE_FLOW_RETURN,
    BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE,
    BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
    BLUEPRINT_NODE_TYPE_FLOW_WHILE,
} from "@shared/types/blueprint/graph";
import type { BehaviorNodeExecutionContext } from "../../behavior-graph/BehaviorNodeRegistry";
import type { BlueprintNodeDef } from "../types";
import { readDynamicInputPinIds } from "../effectivePins";
import { resolveDataPinValue, resolveIfCondition } from "./graphParamResolvers";

const DEFAULT_MAX_ITERATIONS = 1000;
const IF_ELSE_DYNAMIC_BRANCH_PINS_KEY = "__ifElseBranchPins";
const IF_ELSE_CONDITION_SUFFIX = "_condition";
const IF_ELSE_THEN_SUFFIX = "_then";

type LoopState =
    | {
          kind: "forLoop";
          current: number;
          end: number;
          step: number;
          iterations: number;
          maxIterations: number;
      }
    | {
          kind: "forEach";
          items: unknown[];
          index: number;
          maxIterations: number;
      }
    | {
          kind: "while";
          iterations: number;
          maxIterations: number;
      };

function flowStateKey(nodeId: string): string {
    return `__nlFlowState:${nodeId}`;
}

function readState<T extends LoopState["kind"]>(
    ctx: BehaviorNodeExecutionContext,
    kind: T,
): Extract<LoopState, { kind: T }> | undefined {
    const raw = ctx.blueprintLocals?.[flowStateKey(ctx.node.id)];
    if (!raw || typeof raw !== "object" || (raw as { kind?: unknown }).kind !== kind) {
        return undefined;
    }
    return raw as Extract<LoopState, { kind: T }>;
}

function writeState(ctx: BehaviorNodeExecutionContext, state: LoopState): void {
    if (!ctx.blueprintLocals) {
        return;
    }
    ctx.blueprintLocals[flowStateKey(ctx.node.id)] = state;
}

function clearState(ctx: BehaviorNodeExecutionContext): void {
    if (!ctx.blueprintLocals) {
        return;
    }
    delete ctx.blueprintLocals[flowStateKey(ctx.node.id)];
}

function resolveInput(ctx: BehaviorNodeExecutionContext, pinId: string, fallback?: unknown): unknown {
    const value = resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        listItemScope: ctx.listItemScope,
        instanceKey: ctx.instanceKey,
        executionOwner: ctx.executionOwner,
    });
    return value === undefined ? fallback : value;
}

function toFiniteNumber(value: unknown, fallback: number): number {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function toInteger(value: unknown, fallback: number): number {
    return Math.trunc(toFiniteNumber(value, fallback));
}

function toPositiveInteger(value: unknown, fallback: number): number {
    return Math.max(0, toInteger(value, fallback));
}

function toBlueprintBoolean(value: unknown): boolean {
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) && value !== 0;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (!normalized || normalized === "false" || normalized === "0" || normalized === "no") {
            return false;
        }
        if (normalized === "true" || normalized === "1" || normalized === "yes") {
            return true;
        }
    }
    return Boolean(value);
}

function toBlueprintString(value: unknown): string {
    if (value === undefined || value === null) {
        return "";
    }
    return typeof value === "string" ? value : String(value);
}

function shouldContinueForLoop(state: Extract<LoopState, { kind: "forLoop" }>): boolean {
    return state.step > 0 ? state.current <= state.end : state.current >= state.end;
}

function createForLoopState(ctx: BehaviorNodeExecutionContext): Extract<LoopState, { kind: "forLoop" }> {
    const start = toInteger(resolveInput(ctx, "start", 0), 0);
    const end = toInteger(resolveInput(ctx, "end", 0), 0);
    const rawStep = toInteger(resolveInput(ctx, "step", 1), 1);
    return {
        kind: "forLoop",
        current: start,
        end,
        step: rawStep === 0 ? 1 : rawStep,
        iterations: 0,
        maxIterations: toPositiveInteger(resolveInput(ctx, "maxIterations", DEFAULT_MAX_ITERATIONS), DEFAULT_MAX_ITERATIONS),
    };
}

function executeForLoop(ctx: BehaviorNodeExecutionContext) {
    const state = readState(ctx, "forLoop") ?? createForLoopState(ctx);
    if (!shouldContinueForLoop(state)) {
        clearState(ctx);
        return { nextPort: "completed", outputValues: { index: -1 } };
    }
    if (state.iterations >= state.maxIterations) {
        clearState(ctx);
        return { nextPort: "completed", outputValues: { index: state.current } };
    }
    const index = state.current;
    state.current += state.step;
    state.iterations += 1;
    writeState(ctx, state);
    return { nextPort: "loop", outputValues: { index } };
}

function createForEachState(ctx: BehaviorNodeExecutionContext): Extract<LoopState, { kind: "forEach" }> | null {
    const items = resolveInput(ctx, "items", []);
    if (!Array.isArray(items)) {
        return null;
    }
    return {
        kind: "forEach",
        items,
        index: 0,
        maxIterations: toPositiveInteger(resolveInput(ctx, "maxIterations", DEFAULT_MAX_ITERATIONS), DEFAULT_MAX_ITERATIONS),
    };
}

function executeForEach(ctx: BehaviorNodeExecutionContext) {
    const state = readState(ctx, "forEach") ?? createForEachState(ctx);
    if (!state) {
        clearState(ctx);
        return { nextPort: "completed", outputValues: { item: null, index: -1 } };
    }
    if (state.index >= state.items.length) {
        clearState(ctx);
        return { nextPort: "completed", outputValues: { item: null, index: -1 } };
    }
    if (state.index >= state.maxIterations) {
        clearState(ctx);
        return { nextPort: "completed", outputValues: { item: null, index: state.index } };
    }
    const index = state.index;
    const item = state.items[index];
    state.index += 1;
    writeState(ctx, state);
    return { nextPort: "loop", outputValues: { item, index } };
}

function executeWhile(ctx: BehaviorNodeExecutionContext) {
    const state =
        readState(ctx, "while") ??
        ({
            kind: "while",
            iterations: 0,
            maxIterations: toPositiveInteger(
                resolveInput(ctx, "maxIterations", DEFAULT_MAX_ITERATIONS),
                DEFAULT_MAX_ITERATIONS,
            ),
        } satisfies Extract<LoopState, { kind: "while" }>);
    if (!toBlueprintBoolean(resolveInput(ctx, "condition", false))) {
        clearState(ctx);
        return { nextPort: "completed" };
    }
    if (state.iterations >= state.maxIterations) {
        clearState(ctx);
        return { nextPort: "completed" };
    }
    state.iterations += 1;
    writeState(ctx, state);
    return { nextPort: "loop" };
}

async function executeDelay(ctx: BehaviorNodeExecutionContext) {
    const durationSeconds = Math.max(0, toFiniteNumber(resolveInput(ctx, "duration", 0), 0));
    if (durationSeconds > 0) {
        await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));
    }
    return { nextPort: "completed" };
}

function executeBooleanBranch(ctx: BehaviorNodeExecutionContext, truePort: string, falsePort: string) {
    const conditionValue = resolveIfCondition(ctx.graph, ctx.node, ctx.params, ctx.blueprintLocals, {
        hostAdapter: ctx.hostAdapter,
        eventPayload: ctx.eventPayload,
        executionOwner: ctx.executionOwner,
    });
    return { nextPort: Boolean(conditionValue) ? truePort : falsePort };
}

function thenPortForIfElseConditionPin(conditionPinId: string): string {
    if (conditionPinId === "condition") {
        return "then";
    }
    if (conditionPinId.endsWith(IF_ELSE_CONDITION_SUFFIX)) {
        return `${conditionPinId.slice(0, -IF_ELSE_CONDITION_SUFFIX.length)}${IF_ELSE_THEN_SUFFIX}`;
    }
    return "then";
}

function executeIfElse(ctx: BehaviorNodeExecutionContext) {
    const dynamicConditionPins = readDynamicInputPinIds(ctx.params, IF_ELSE_DYNAMIC_BRANCH_PINS_KEY)
        .filter(pinId => pinId.endsWith(IF_ELSE_CONDITION_SUFFIX));
    const conditionPins = ["condition", ...dynamicConditionPins];
    for (const conditionPinId of conditionPins) {
        const conditionValue = conditionPinId === "condition"
            ? resolveIfCondition(ctx.graph, ctx.node, ctx.params, ctx.blueprintLocals, {
                  hostAdapter: ctx.hostAdapter,
                  eventPayload: ctx.eventPayload,
                  executionOwner: ctx.executionOwner,
              })
            : resolveInput(ctx, conditionPinId, false);
        if (toBlueprintBoolean(conditionValue)) {
            return { nextPort: thenPortForIfElseConditionPin(conditionPinId) };
        }
    }
    return { nextPort: "else" };
}

function executeSwitchStringLike(ctx: BehaviorNodeExecutionContext) {
    const value = toBlueprintString(resolveInput(ctx, "value", ""));
    for (let i = 0; i < 4; i += 1) {
        const caseValue = resolveInput(ctx, `case${i}Value`);
        if (caseValue !== undefined && value === toBlueprintString(caseValue)) {
            return { nextPort: `case${i}` };
        }
    }
    return { nextPort: "default" };
}

export const controlFlowBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_IF,
        displayName: "If",
        category: "Flow",
        keywords: ["if", "branch", "condition"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "true", kind: "output", semantic: "exec", label: "True" },
            { id: "false", kind: "output", semantic: "exec", label: "False" },
            { id: "condition", kind: "input", semantic: "data", valueType: "boolean", label: "Condition" },
        ],
        execute: ctx => executeBooleanBranch(ctx, "true", "false"),
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
        displayName: "If Else",
        category: "Flow",
        keywords: ["if", "else", "branch", "condition"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "then", kind: "output", semantic: "exec", label: "Then" },
            { id: "else", kind: "output", semantic: "exec", label: "Else" },
            { id: "condition", kind: "input", semantic: "data", valueType: "boolean", label: "Condition" },
        ],
        dynamicInputPins: {
            storageKey: IF_ELSE_DYNAMIC_BRANCH_PINS_KEY,
            fixedDataInputIds: ["condition"],
            generatedIdPrefix: "if",
            valueType: "boolean",
            allowInlineLiteral: false,
            labelPrefix: "If",
            addButtonLabel: "Add If condition",
            outputInsertBeforePinId: "else",
            generatedPinTemplates: [
                {
                    idSuffix: "condition",
                    label: "If",
                    kind: "input",
                    semantic: "data",
                    valueType: "boolean",
                    allowInlineLiteral: false,
                },
                {
                    idSuffix: "then",
                    label: "Then",
                    kind: "output",
                    semantic: "exec",
                },
            ],
        },
        execute: executeIfElse,
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_NOOP,
        displayName: "Noop",
        category: "Flow",
        keywords: ["noop", "pass", "continue"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "next", kind: "output", semantic: "exec", label: "Next" },
        ],
        execute: () => ({ nextPort: "next" }),
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE,
        displayName: "Sequence",
        category: "Flow",
        keywords: ["sequence", "order", "then", "flow"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "then0", kind: "output", semantic: "exec", label: "Then 1" },
            { id: "then1", kind: "output", semantic: "exec", label: "Then 2" },
            { id: "then2", kind: "output", semantic: "exec", label: "Then 3" },
            { id: "then3", kind: "output", semantic: "exec", label: "Then 4" },
        ],
        execute: () => ({ nextPorts: ["then0", "then1", "then2", "then3"] }),
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING,
        displayName: "Switch String",
        category: "Flow",
        keywords: ["switch", "string", "case", "branch"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "case0", kind: "output", semantic: "exec", label: "Case 0" },
            { id: "case1", kind: "output", semantic: "exec", label: "Case 1" },
            { id: "case2", kind: "output", semantic: "exec", label: "Case 2" },
            { id: "case3", kind: "output", semantic: "exec", label: "Case 3" },
            { id: "default", kind: "output", semantic: "exec", label: "Default" },
            { id: "value", kind: "input", semantic: "data", valueType: "string", label: "Value", allowInlineLiteral: true },
            { id: "case0Value", kind: "input", semantic: "data", valueType: "string", label: "Case 0", allowInlineLiteral: true },
            { id: "case1Value", kind: "input", semantic: "data", valueType: "string", label: "Case 1", allowInlineLiteral: true },
            { id: "case2Value", kind: "input", semantic: "data", valueType: "string", label: "Case 2", allowInlineLiteral: true },
            { id: "case3Value", kind: "input", semantic: "data", valueType: "string", label: "Case 3", allowInlineLiteral: true },
        ],
        execute: executeSwitchStringLike,
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
        displayName: "For Loop",
        category: "Flow",
        keywords: ["for", "loop", "repeat", "index"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "loop", kind: "output", semantic: "exec", label: "Loop" },
            { id: "completed", kind: "output", semantic: "exec", label: "Completed" },
            { id: "start", kind: "input", semantic: "data", valueType: "integer", label: "Start", allowInlineLiteral: true },
            { id: "end", kind: "input", semantic: "data", valueType: "integer", label: "End", allowInlineLiteral: true },
            { id: "step", kind: "input", semantic: "data", valueType: "integer", label: "Step", allowInlineLiteral: true },
            {
                id: "maxIterations",
                kind: "input",
                semantic: "data",
                valueType: "integer",
                label: "Max iterations",
                allowInlineLiteral: true,
            },
            { id: "index", kind: "output", semantic: "data", valueType: "integer", label: "Index" },
        ],
        execute: executeForLoop,
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
        displayName: "For Each",
        category: "Flow",
        keywords: ["for", "each", "loop", "array", "json"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "loop", kind: "output", semantic: "exec", label: "Loop" },
            { id: "completed", kind: "output", semantic: "exec", label: "Completed" },
            { id: "items", kind: "input", semantic: "data", valueType: "json", label: "Items" },
            {
                id: "maxIterations",
                kind: "input",
                semantic: "data",
                valueType: "integer",
                label: "Max iterations",
                allowInlineLiteral: true,
            },
            { id: "item", kind: "output", semantic: "data", valueType: "json", label: "Item" },
            { id: "index", kind: "output", semantic: "data", valueType: "integer", label: "Index" },
        ],
        execute: executeForEach,
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_WHILE,
        displayName: "While",
        category: "Flow",
        keywords: ["while", "loop", "condition"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "loop", kind: "output", semantic: "exec", label: "Loop" },
            { id: "completed", kind: "output", semantic: "exec", label: "Completed" },
            { id: "condition", kind: "input", semantic: "data", valueType: "boolean", label: "Condition" },
            {
                id: "maxIterations",
                kind: "input",
                semantic: "data",
                valueType: "integer",
                label: "Max iterations",
                allowInlineLiteral: true,
            },
        ],
        execute: executeWhile,
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_DELAY,
        displayName: "Delay",
        category: "Flow",
        keywords: ["delay", "wait", "timer", "latent"],
        graphKinds: ["event", "macro"],
        isPure: false,
        isLatent: true,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
            { id: "completed", kind: "output", semantic: "exec", label: "Completed" },
            { id: "duration", kind: "input", semantic: "data", valueType: "float", label: "Duration", allowInlineLiteral: true },
        ],
        execute: executeDelay,
    },
    {
        type: BLUEPRINT_NODE_TYPE_FLOW_RETURN,
        displayName: "Return",
        category: "Flow",
        keywords: ["return", "stop", "end", "early"],
        graphKinds: ["event", "macro"],
        isPure: false,
        pins: [
            { id: "in", kind: "input", semantic: "exec", label: "In" },
        ],
        execute: () => ({ nextPort: undefined }),
    },
];
