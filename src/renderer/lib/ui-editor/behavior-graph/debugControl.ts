/**
 * Injection point for the blueprint debugger.
 *
 * The executor lives here in `behavior-graph`, but the debugger that decides when to stop lives in
 * `blueprint-runtime` (it needs the breakpoint table, the scope stores and a React-facing state
 * machine), which already depends on this layer - importing it directly would close a module
 * cycle. This is the same shape, and the same reasoning, as `dataPinResolver.ts`.
 *
 * Unlike the pin resolver, nothing installs a controller by default. A packaged game never calls
 * `setBlueprintDebugController`, so `getBlueprintDebugController()` returns null and the executor's
 * hot loop pays one null check per node. Only the Dev Mode window installs one, and only for as
 * long as its runtime session lives.
 *
 * The controller may suspend execution: `beforeNode` returning a promise is what a breakpoint hit
 * *is*. Two rules keep that from becoming a hang:
 *
 *  1. It must return `undefined` synchronously whenever nothing is armed - no breakpoints, not
 *     paused, not stepping. Allocating a promise per node would cost more than the feature is
 *     worth, and every node of every graph goes through here.
 *  2. The executor awaits it through `abortablePromise` with the execution's own signal, so a
 *     surface unmounting or a session disposing rejects a paused node exactly like any other
 *     cancellation. A controller that never resolves cannot outlive its execution.
 */

import type { UIGraphNode } from "@shared/types/ui-editor/graph";
import type { BehaviorNodeExecutionContext } from "./BehaviorNodeRegistry";

/** What the executor knows about a graph invocation at the moment it starts. */
export type BlueprintDebugFrameInfo = {
    /** Built by `buildBlueprintRunGraphId` - carries kind, blueprint id and graph id. */
    runGraphId: string;
    entryNodeId: string;
    /** Nesting depth of blueprint fn invocations; 0 (or absent) for an event graph. */
    fnCallDepth?: number;
    /** Shared by every frame of one dispatch, including the fns it calls. Absent on untraced runs. */
    executionId?: string;
    /**
     * The execution's cancellation signal, which a fn call inherits from its caller.
     *
     * It is the fallback identity for grouping frames into one call stack when no `executionId`
     * was supplied - story action graphs run untraced, and their fn calls pass the caller's signal
     * straight through, so signal identity is what makes their stack come out right.
     */
    signal?: AbortSignal;
    blueprintId?: string;
    eventName?: string;
    /** Live reference, not a copy: the debugger reads current values when it pauses. */
    blueprintLocals?: Record<string, unknown>;
    eventPayload?: Record<string, unknown>;
};

/** Opaque handle identifying one frame for the lifetime of its `executeGraph` call. */
export type BlueprintDebugFrameToken = { readonly frameId: number };

export interface BlueprintExecutionDebugController {
    enterFrame(info: BlueprintDebugFrameInfo): BlueprintDebugFrameToken;
    exitFrame(token: BlueprintDebugFrameToken): void;
    /**
     * Called before every node executes. Return nothing to let it run, or a promise to suspend
     * until the author resumes. See the two rules above.
     */
    beforeNode(
        token: BlueprintDebugFrameToken,
        node: UIGraphNode,
        context: BehaviorNodeExecutionContext,
    ): void | Promise<void>;
}

let controller: BlueprintExecutionDebugController | null = null;

export function setBlueprintDebugController(next: BlueprintExecutionDebugController | null): void {
    controller = next;
}

export function getBlueprintDebugController(): BlueprintExecutionDebugController | null {
    return controller;
}
