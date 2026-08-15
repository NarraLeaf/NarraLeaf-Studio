import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import type { UIGraph, UIGraphEntry, UIGraphId, UIGraphNode } from "@shared/types/ui-editor/graph";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIHostAdapter } from "../runtime/types";

export type BehaviorNodeExecuteResult = {
    nextPort?: string;
    nextPorts?: string[];
    outputValues?: Record<string, unknown>;
};

/** Optional execution trace for M3-full (node.enter / node.exit + structured errors). */
export type BehaviorGraphExecutionTrace = {
    executionId: string;
    graphId: UIGraphId;
    blueprintId?: string;
    eventId?: string;
    /**
     * Surface the graph belongs to, carried so an `execution.error` raised in here says where it
     * happened. The dispatcher reports the same failure a second time when it catches it, and the
     * two reports have to be the SAME report - a host that collapses repeats by their text would
     * otherwise list one failure twice, once with a place and once without.
     */
    surfaceId?: string;
    emit: (event: BlueprintDebugEvent) => void;
};

export type BlueprintValueDependency = {
    surfaceId: string;
    elementId: string;
    propPath: string;
};

export type BehaviorGraphValueExecution = {
    returnValue(value: unknown): void;
    trackDependency?(dependency: BlueprintValueDependency): void;
};

export type BehaviorGraphEventControl = {
    stopPropagation(): void;
    isPropagationStopped(): boolean;
};

export type BehaviorNodeExecutionContext = {
    graph: UIGraph;
    entry: UIGraphEntry;
    node: UIGraphNode;
    params: Record<string, unknown>;
    /**
     * Read one of this node's declared data input pins, following the wired
     * edge. Lazy - nothing is resolved unless a node asks. Returns undefined for
     * unwired or undeclared pins.
     *
     * Always supplied by both graph executors; optional only because tests build
     * partial contexts. Call it as `ctx.resolveInput?.(pinId)`.
     */
    resolveInput?: (pinId: string) => unknown;
    hostAdapter: UIHostAdapter;
    trace?: BehaviorGraphExecutionTrace;
    /** Per-event execution locals; initialized from blueprint member variables (M4 simplified editor). */
    blueprintLocals?: Record<string, unknown>;
    /** Runtime event slot currently being handled, for nodes that need to continue event propagation. */
    eventName?: string;
    eventPayload?: Record<string, unknown>;
    eventControl?: BehaviorGraphEventControl;
    signal?: AbortSignal;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    executionOwner?: {
        surfaceId?: string;
        elementId?: string;
        blueprintId?: string;
        componentId?: string;
        /**
         * Resolved params of the component instance this execution belongs to, by param id.
         *
         * Sits beside `componentId` rather than at the top of the context because owner identity and
         * the instance's own values are one answer to "which placement is running" - and because
         * every data-pin resolver already forwards this object as a unit, which is what lets a pure
         * node read it without thirty-odd call sites learning a new field.
         */
        componentParams?: Record<string, string>;
    };
    persistentVariables?: PersistentVariableRuntimeTable;
    valueExecution?: BehaviorGraphValueExecution;
    /** Nesting depth of blueprint fn invocations; guards runaway recursion in the dispatcher. */
    fnCallDepth?: number;
};

export type BehaviorNodeDefinition = {
    type: string;
    displayName: string;
    execute: (ctx: BehaviorNodeExecutionContext) => BehaviorNodeExecuteResult | void | Promise<BehaviorNodeExecuteResult | void>;
};

export class BehaviorNodeRegistry {
    private readonly definitions = new Map<string, BehaviorNodeDefinition>();

    public register(definition: BehaviorNodeDefinition, options?: { quietOverwrite?: boolean }): void {
        if (this.definitions.has(definition.type) && !options?.quietOverwrite) {
            console.warn(`[BehaviorNodeRegistry] Overwriting node definition: ${definition.type}`);
        }
        this.definitions.set(definition.type, definition);
    }

    public registerMany(definitions: BehaviorNodeDefinition[]): void {
        for (const definition of definitions) {
            this.register(definition);
        }
    }

    public get(type: string): BehaviorNodeDefinition | undefined {
        return this.definitions.get(type);
    }

    public list(): BehaviorNodeDefinition[] {
        return Array.from(this.definitions.values());
    }
}

export const behaviorNodeRegistry = new BehaviorNodeRegistry();
