import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
} from "@shared/types/blueprint/graph";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { executeGraph } from "@/lib/ui-editor/behavior-graph";
import { BlueprintGraphExecutionError } from "@/lib/ui-editor/behavior-graph/GraphExecutionError";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInBlueprintValueGraph } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { adaptBlueprintGraphIr } from "./adaptBlueprintGraphIr";
import { acquireBlueprintExecutionLocals } from "./blueprintWidgetLocals";

export const BLUEPRINT_VALUE_EVENT_INIT = "init" as const;
export const BLUEPRINT_VALUE_EVENT_FLUSH = "flush" as const;

export type BlueprintValueEventName =
    | typeof BLUEPRINT_VALUE_EVENT_INIT
    | typeof BLUEPRINT_VALUE_EVENT_FLUSH;

export type BlueprintValueEvaluationResult = {
    returned: boolean;
    value: unknown;
};

const DEFAULT_VALUE_MAX_STEPS = 512;

function headTypeForValueEvent(eventName: BlueprintValueEventName): string {
    return eventName === BLUEPRINT_VALUE_EVENT_INIT
        ? BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT
        : BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH;
}

export function validateBlueprintValueGraphSafe(ir: BlueprintGraphIr | undefined): string[] {
    registerCoreBlueprintNodes();
    const errors: string[] = [];
    for (const node of Object.values(ir?.nodes ?? {})) {
        const def = blueprintNodeRegistry.get(node.type);
        if (!def) {
            errors.push(`Node ${node.id} uses unknown type ${node.type}`);
            continue;
        }
        if (!isBlueprintNodeAllowedInBlueprintValueGraph(def)) {
            errors.push(`Node ${node.id} (${def.displayName}) is not allowed in Blueprint Value`);
        }
    }
    return errors;
}

function collectValueHeadNodeIds(ir: BlueprintGraphIr | undefined, eventName: BlueprintValueEventName): string[] {
    const headType = headTypeForValueEvent(eventName);
    return Object.entries(ir?.nodes ?? {})
        .filter(([, node]) => node.type === headType)
        .map(([id]) => id)
        .sort();
}

export async function evaluateBlueprintValue(input: {
    blueprintDocument: BlueprintDocument;
    blueprintId: string;
    surfaceId: string;
    runtimeScopeId?: string;
    elementId: string;
    eventName: BlueprintValueEventName;
    hostAdapter: UIHostAdapter;
    maxSteps?: number;
}): Promise<BlueprintValueEvaluationResult> {
    const bp = input.blueprintDocument.blueprints[input.blueprintId];
    if (!bp || bp.owner.kind !== "widgetValue" || bp.program.kind !== "graph") {
        return { returned: false, value: undefined };
    }

    const matching = Object.values(bp.program.graphs.events ?? {})
        .map(eventGraph => {
            const headIds = collectValueHeadNodeIds(eventGraph.graph, input.eventName);
            return headIds.length > 0 ? { eventGraph, headIds } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    if (matching.length === 0) {
        return { returned: false, value: undefined };
    }

    const blueprintLocals = acquireBlueprintExecutionLocals({
        blueprintDocument: input.blueprintDocument,
        currentBlueprintId: input.blueprintId,
        surfaceId: input.surfaceId,
        runtimeScopeId: input.runtimeScopeId,
        elementId: input.elementId,
    });

    let returned = false;
    let value: unknown;
    for (const { eventGraph, headIds } of matching) {
        const safetyErrors = validateBlueprintValueGraphSafe(eventGraph.graph);
        if (safetyErrors.length > 0) {
            throw new BlueprintGraphExecutionError(safetyErrors[0]!, headIds[0]);
        }
        const graph = adaptBlueprintGraphIr(eventGraph.graph, `blueprintValue:${input.blueprintId}:${eventGraph.id}`);
        for (const headId of headIds) {
            const result = await executeGraph({
                graph,
                entry: { start: { nodeId: headId, port: "then" } },
                hostAdapter: input.hostAdapter,
                blueprintLocals,
                eventPayload: {},
                executionOwner: {
                    surfaceId: input.surfaceId,
                    elementId: input.elementId,
                    blueprintId: input.blueprintId,
                },
                maxSteps: input.maxSteps ?? DEFAULT_VALUE_MAX_STEPS,
            });
            if (result.returnValueSet) {
                returned = true;
                value = result.returnValue;
            }
        }
    }
    return { returned, value };
}
