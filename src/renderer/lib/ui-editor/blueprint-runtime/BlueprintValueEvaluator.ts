import type { BlueprintDocument, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import { buildBlueprintRunGraphId } from "@shared/blueprint/blueprintRunGraphId";
import { blueprintContract } from "@shared/blueprint/ownerShape";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
} from "@shared/types/blueprint/graph";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { behaviorNodeRegistry, executeGraph } from "@/lib/ui-editor/behavior-graph";
import type { BlueprintValueDependency } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import { BlueprintGraphExecutionError } from "@/lib/ui-editor/behavior-graph/GraphExecutionError";
import { translate } from "@/lib/i18n";
import { blueprintNodeRegistry, isBlueprintNodeAllowedInBlueprintValueGraph } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { adaptBlueprintGraphIr } from "./adaptBlueprintGraphIr";
import { acquireBlueprintExecutionLocals } from "./blueprintWidgetLocals";

export const BLUEPRINT_VALUE_EVENT_INIT = "init" as const;
export const BLUEPRINT_VALUE_EVENT_FLUSH = "flush" as const;

export type BlueprintValueEvaluationResult = {
    returned: boolean;
    value: unknown;
    dependencies: BlueprintValueDependency[];
    /**
     * The game state this run read besides widget props - variables of every kind - by the keys
     * their writers announce (`blueprintStateWrites`). A write under any of them is what should run
     * the binding again.
     */
    stateReads: string[];
};

const DEFAULT_VALUE_MAX_STEPS = 512;

/**
 * Why a Blueprint Value graph cannot be run, one sentence per offending node, already in the
 * author's language - the first of them is what the evaluation fails with.
 */
export function validateBlueprintValueGraphSafe(ir: BlueprintGraphIr | undefined): string[] {
    registerCoreBlueprintNodes();
    const errors: string[] = [];
    for (const node of Object.values(ir?.nodes ?? {})) {
        const def = blueprintNodeRegistry.get(node.type);
        if (!def) {
            // No definition, yet the executor can run it: a runtime plugin entry registers
            // type/displayName/execute and no pins, so in a shipped game a plugin's node reaches
            // only the behaviour registry. There is no declaration to read there, and refusing the
            // whole binding over that would shut the door the editor opened on the way out of it.
            if (behaviorNodeRegistry.get(node.type)) {
                continue;
            }
            errors.push(translate("blueprint.runtimeError.valueNodeUnavailable"));
            continue;
        }
        if (!isBlueprintNodeAllowedInBlueprintValueGraph(def)) {
            errors.push(translate("blueprint.runtimeError.valueNodeNotAllowed"));
        }
    }
    return errors;
}

function collectValueHeadNodeIds(ir: BlueprintGraphIr | undefined): string[] {
    return Object.entries(ir?.nodes ?? {})
        .filter(([, node]) =>
            node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT ||
            node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH
        )
        .map(([id]) => id)
        .sort();
}

export async function evaluateBlueprintValue(input: {
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    blueprintId: string;
    surfaceId: string;
    runtimeScopeId?: string;
    elementId: string;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    hostAdapter: UIHostAdapter;
    maxSteps?: number;
    /**
     * Who is asking, so that a write this very evaluation makes (a binding may call a Fn that writes)
     * is not taken as a reason to run it again. See `blueprintStateWrites`.
     */
    stateOrigin?: unknown;
    /**
     * Told of each state read as it happens, not only in the result: a write can land while this
     * run is still going, after the read it invalidates, and a caller that only learns the reads at
     * the end would let that write through unseen.
     */
    onStateRead?: (stateKey: string) => void;
}): Promise<BlueprintValueEvaluationResult> {
    const bp = input.blueprintDocument.blueprints[input.blueprintId];
    // Asked of the contract rather than the owner kind: this path exists for the one invocation
    // that returns a value to a prop, not for a particular slot the value binding happens to sit in.
    if (!bp || blueprintContract(bp.owner).invocation !== "valueBinding") {
        return { returned: false, value: undefined, dependencies: [], stateReads: [] };
    }

    const matching = Object.values(bp.graphs.events ?? {})
        .map(eventGraph => {
            const headIds = collectValueHeadNodeIds(eventGraph.graph);
            return headIds.length > 0 ? { eventGraph, headIds } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    if (matching.length === 0) {
        return { returned: false, value: undefined, dependencies: [], stateReads: [] };
    }

    const stateReads = new Set<string>();
    const trackState = (stateKey: string) => {
        stateReads.add(stateKey);
        input.onStateRead?.(stateKey);
    };
    const blueprintLocals = acquireBlueprintExecutionLocals({
        blueprintDocument: input.blueprintDocument,
        currentBlueprintId: input.blueprintId,
        surfaceId: input.surfaceId,
        runtimeScopeId: input.runtimeScopeId,
        elementId: input.elementId,
        elementInstanceKey: input.instanceKey,
        observer: { onRead: trackState, origin: input.stateOrigin },
    });

    let returned = false;
    let value: unknown;
    const dependencies = new Map<string, BlueprintValueDependency>();
    for (const { eventGraph, headIds } of matching) {
        const safetyErrors = validateBlueprintValueGraphSafe(eventGraph.graph);
        if (safetyErrors.length > 0) {
            // Already translated by the check above.
            throw new BlueprintGraphExecutionError(safetyErrors[0]!, headIds[0]);
        }
        const graph = adaptBlueprintGraphIr(eventGraph.graph, buildBlueprintRunGraphId("blueprintValue", input.blueprintId, eventGraph.id));
        for (const headId of headIds) {
            const result = await executeGraph({
                graph,
                entry: { start: { nodeId: headId, port: "then" } },
                hostAdapter: input.hostAdapter,
                blueprintLocals,
                eventPayload: {},
                listItemScope: input.listItemScope ?? null,
                instanceKey: input.instanceKey,
                executionOwner: {
                    surfaceId: input.surfaceId,
                    elementId: input.elementId,
                    blueprintId: input.blueprintId,
                },
                persistentVariables: input.persistentVariables,
                maxSteps: input.maxSteps ?? DEFAULT_VALUE_MAX_STEPS,
                valueExecution: {
                    trackDependency: dependency => {
                        dependencies.set(
                            `${dependency.surfaceId}\0${dependency.elementId}\0${dependency.propPath}`,
                            dependency,
                        );
                    },
                    trackState,
                    stateOrigin: input.stateOrigin,
                },
            });
            if (result.returnValueSet) {
                returned = true;
                value = result.returnValue;
            }
        }
    }
    return { returned, value, dependencies: [...dependencies.values()], stateReads: [...stateReads] };
}
