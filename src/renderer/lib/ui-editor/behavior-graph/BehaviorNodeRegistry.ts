import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { BlueprintPersistentVariable } from "@shared/types/blueprint/document";
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

export type BehaviorNodeExecutionContext = {
    graph: UIGraph;
    entry: UIGraphEntry;
    node: UIGraphNode;
    params: Record<string, unknown>;
    hostAdapter: UIHostAdapter;
    trace?: BehaviorGraphExecutionTrace;
    /** Per-event execution locals; initialized from blueprint member variables (M4 simplified editor). */
    blueprintLocals?: Record<string, unknown>;
    eventPayload?: Record<string, unknown>;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    executionOwner?: {
        surfaceId?: string;
        elementId?: string;
        blueprintId?: string;
    };
    persistentVariables?: Record<string, BlueprintPersistentVariable>;
    valueExecution?: BehaviorGraphValueExecution;
};

export type BehaviorNodeDefinition = {
    type: string;
    displayName: string;
    execute: (ctx: BehaviorNodeExecutionContext) => BehaviorNodeExecuteResult | void | Promise<BehaviorNodeExecuteResult | void>;
};

export class BehaviorNodeRegistry {
    private readonly definitions = new Map<string, BehaviorNodeDefinition>();

    public register(definition: BehaviorNodeDefinition): void {
        if (this.definitions.has(definition.type)) {
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
