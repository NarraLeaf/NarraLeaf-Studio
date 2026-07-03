// @vitest-environment jsdom
/**
 * Behavior contract for the shared surface lifecycle boundary, carried over
 * from the (now unified) Dev Mode / game-runtime characterization tests:
 * one-frame deferred surfaceInit with a StrictMode-safe cancelled guard,
 * closeScope + surfaceUnmount on unmount, and core-gating (the host passes
 * core=null until the surface renderer reports subscriptions ready).
 */
import { StrictMode, type ReactNode } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    createRecordingCore,
    ensureAnimationFramePolyfill,
    flushAnimationFrame,
    makeBlueprintHostAdapter,
    makeStateAccessors,
    makeTestBundle,
    makeTestSurface,
    type LifecycleEventLog,
} from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { SurfaceLifecycleManager } from "@/lib/ui-editor/blueprint-runtime/SurfaceLifecycleManager";

const hoisted = vi.hoisted(() => ({ log: [] as string[] }));

vi.mock("@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher", async importOriginal => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        dispatchSurfaceBlueprintEvent: (input: { eventName: string; runtimeScopeId: string }) => {
            hoisted.log.push(`dispatch:${input.eventName}:${input.runtimeScopeId}`);
            return Promise.resolve();
        },
        dispatchGlobalBlueprintEvent: (input: { eventName: string }) => {
            hoisted.log.push(`dispatchGlobal:${input.eventName}`);
            return Promise.resolve();
        },
    };
});

import { SurfaceLifecycleBoundary } from "./SurfaceLifecycleBoundary";

const blueprintDocument = makeTestBundle().ui.localBlueprints as BlueprintDocument;

function mountBoundary(input: {
    log: LifecycleEventLog;
    strict?: boolean;
    lifecycleRef?: { current: SurfaceLifecycleManager };
    core?: ReturnType<typeof createRecordingCore> | null;
}) {
    const core = input.core === undefined ? createRecordingCore(input.log) : input.core;
    const lifecycleRef = input.lifecycleRef ?? { current: new SurfaceLifecycleManager() };
    const accessors = makeStateAccessors();
    const element = (
        <SurfaceLifecycleBoundary
            core={core}
            blueprintDocument={blueprintDocument}
            surface={makeTestSurface("surface-a")}
            runtimeScopeId="scope-1"
            hostAdapter={makeBlueprintHostAdapter()}
            lifecycleRef={lifecycleRef}
            makeStateAccessors={() => accessors}
        >
            <div data-testid="content" />
        </SurfaceLifecycleBoundary>
    );
    const wrap = (node: ReactNode) => (input.strict ? <StrictMode>{node}</StrictMode> : node);
    const utils = render(wrap(element));
    return { ...utils, core, lifecycleRef };
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
});

afterEach(() => {
    cleanup();
    hoisted.log.length = 0;
});

describe("SurfaceLifecycleBoundary dispatch order", () => {
    it("defers openScope + surfaceInit by one animation frame", async () => {
        mountBoundary({ log: hoisted.log });
        expect(hoisted.log).toEqual([]);
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });

    it("dispatches closeScope + surfaceUnmount on unmount", async () => {
        const { unmount } = mountBoundary({ log: hoisted.log });
        await act(async () => {
            await flushAnimationFrame();
        });
        hoisted.log.length = 0;
        unmount();
        expect(hoisted.log).toEqual([
            "closeScope:scope-1:Surface unmounted",
            "dispatch:surfaceUnmount:scope-1",
        ]);
    });

    it("re-dispatches surfaceInit when the same scope remounts after exit", async () => {
        const lifecycleRef = { current: new SurfaceLifecycleManager() };
        const first = mountBoundary({ log: hoisted.log, lifecycleRef });
        await act(async () => {
            await flushAnimationFrame();
        });
        first.unmount();
        hoisted.log.length = 0;
        mountBoundary({ log: hoisted.log, lifecycleRef });
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });

    it("does nothing while core is null and initializes once core arrives", async () => {
        const { rerender } = mountBoundary({ log: hoisted.log, core: null });
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([]);
        const core = createRecordingCore(hoisted.log);
        const accessors = makeStateAccessors();
        rerender(
            <SurfaceLifecycleBoundary
                core={core}
                blueprintDocument={blueprintDocument}
                surface={makeTestSurface("surface-a")}
                runtimeScopeId="scope-1"
                hostAdapter={makeBlueprintHostAdapter()}
                lifecycleRef={{ current: new SurfaceLifecycleManager() }}
                makeStateAccessors={() => accessors}
            >
                <div />
            </SurfaceLifecycleBoundary>,
        );
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });

    it("StrictMode double-effect: cancelled guard suppresses the phantom surfaceInit", async () => {
        mountBoundary({ log: hoisted.log, strict: true });
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([
            "closeScope:scope-1:Surface unmounted",
            "dispatch:surfaceUnmount:scope-1",
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });
});
