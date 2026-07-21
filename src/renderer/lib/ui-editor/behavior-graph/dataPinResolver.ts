/**
 * Injection point for data input pin resolution.
 *
 * Node execution lives here in `behavior-graph`, but the resolver itself
 * (`resolveDataPinValue`) lives in `blueprint-nodes/built-in`, which already
 * depends on this layer - importing it directly would close a module cycle.
 * `registerCoreBlueprintNodes()` installs the implementation instead; it is the
 * single entry every execution environment already calls to make blueprints work
 * at all, so the resolver is always present by the time a graph runs.
 *
 * Built-in nodes historically called `resolveDataPinValue` themselves. Routing
 * it through the execution context means plugin-provided nodes can read their
 * declared input pins too - previously they could emit output values but had no
 * way to read inputs, so any pin they declared was silently dead.
 */

import type { BehaviorNodeExecutionContext } from "./BehaviorNodeRegistry";

export type BehaviorDataPinResolver = (
    ctx: BehaviorNodeExecutionContext,
    pinId: string,
) => unknown;

let dataPinResolver: BehaviorDataPinResolver | null = null;

export function setBehaviorDataPinResolver(resolver: BehaviorDataPinResolver): void {
    dataPinResolver = resolver;
}

/**
 * Resolve one declared data input pin of the executing node. Returns undefined
 * when the pin is unwired, when the node declares no such pin, or before the
 * resolver has been installed - callers must treat undefined as "no value" and
 * fall back to their own defaults.
 */
export function resolveBehaviorNodeInput(
    ctx: BehaviorNodeExecutionContext,
    pinId: string,
): unknown {
    return dataPinResolver ? dataPinResolver(ctx, pinId) : undefined;
}
