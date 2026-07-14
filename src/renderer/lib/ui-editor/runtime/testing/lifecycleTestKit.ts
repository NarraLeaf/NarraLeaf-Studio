/**
 * Shared fixtures for surface-lifecycle characterization tests.
 *
 * These tests capture the CURRENT dispatch order/count of the Dev Mode and
 * game-runtime surface lifecycle layers so the unification refactor can prove
 * behavior is preserved (or intentionally changed) at every step.
 *
 * This module lives under `@/lib/ui-editor/` so both the Studio renderer tests
 * and `src/runtime` tests may import it (see build-runtime.js runtimeAliasPlugin
 * and src/runtime/runtimeImportBoundary.test.ts). It is only imported from
 * *.test.tsx files and never ships in a product bundle.
 */

import { BlueprintExecutionManager } from "@/lib/ui-editor/blueprint-runtime/BlueprintExecutionManager";
import { ScopeStoreBridge } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { DevModeBundle } from "@shared/types/devMode";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";

export type LifecycleEventLog = string[];

/**
 * Real BlueprintRuntimeCore whose execution manager records scope
 * open/close calls (with reason) into the given log, preserving real
 * scope bookkeeping semantics.
 */
export function createRecordingCore(log: LifecycleEventLog): BlueprintRuntimeCore {
    const executionManager = new BlueprintExecutionManager();
    const realOpenScope = executionManager.openScope.bind(executionManager);
    const realCloseScope = executionManager.closeScope.bind(executionManager);
    executionManager.openScope = (runtimeScopeId: string) => {
        log.push(`openScope:${runtimeScopeId}`);
        realOpenScope(runtimeScopeId);
    };
    executionManager.closeScope = (runtimeScopeId: string, reason: string) => {
        log.push(`closeScope:${runtimeScopeId}:${reason}`);
        realCloseScope(runtimeScopeId, reason);
    };
    return {
        scopeBridge: new ScopeStoreBridge(),
        debug: new DebugBridge(),
        bindingDebugCoalescer: new BindingDebugCoalescer(),
        executionManager,
    };
}

export function makeTestSurface(id: string): UISurface {
    return { id, kind: "page", name: id } as unknown as UISurface;
}

export function makeTestBundle(): DevModeBundle {
    return {
        bundleId: "bundle-1",
        revision: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
        ui: { localBlueprints: { blueprints: [] } },
    } as unknown as DevModeBundle;
}

export function makeTestPack(bundle: DevModeBundle = makeTestBundle()): GameRuntimePackV1 {
    return { bundle } as unknown as GameRuntimePackV1;
}

/** Host adapter whose truthy `blueprintRuntime` satisfies the lifecycle layers' gate. */
export function makeBlueprintHostAdapter(): UIHostAdapter {
    return { blueprintRuntime: {} } as unknown as UIHostAdapter;
}

export function makeStateAccessors() {
    const store = new Map<string, unknown>();
    return {
        get: (key: string) => store.get(key),
        set: (key: string, value: unknown) => {
            store.set(key, value);
        },
    };
}

/** jsdom may lack requestAnimationFrame depending on environment options. */
export function ensureAnimationFramePolyfill(): void {
    if (typeof globalThis.requestAnimationFrame !== "function") {
        globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
            setTimeout(() => callback(Date.now()), 0)) as unknown as typeof requestAnimationFrame;
    }
    if (typeof globalThis.cancelAnimationFrame !== "function") {
        globalThis.cancelAnimationFrame = ((handle: number) =>
            clearTimeout(handle)) as unknown as typeof cancelAnimationFrame;
    }
}

/** Resolves after one animation frame plus a microtask drain. */
export async function flushAnimationFrame(): Promise<void> {
    await new Promise<void>(resolve => globalThis.requestAnimationFrame(() => resolve()));
    await Promise.resolve();
}
