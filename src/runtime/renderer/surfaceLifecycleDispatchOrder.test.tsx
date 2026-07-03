// @vitest-environment jsdom
/**
 * Characterization test: CURRENT surface lifecycle dispatch order of the
 * game-runtime (preview/production) lifecycle layer. Counterpart of
 * src/renderer/apps/dev-mode/components/surfaceLifecycleDispatchOrder.test.tsx.
 *
 * Key runtime-specific semantics captured here (the drift the unification
 * refactor reconciles): surfaceInit waits one animation frame after mount
 * (with a cancelled guard), so a StrictMode-style rapid mount/unmount/mount
 * cycle produces no phantom surfaceInit.
 */
import { StrictMode, type ReactNode } from "react";
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import {
    createRecordingCore,
    ensureAnimationFramePolyfill,
    flushAnimationFrame,
    makeBlueprintHostAdapter,
    makeStateAccessors,
    makeTestPack,
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

import { RuntimeSurfaceLifecycleLayer } from "./GameRuntimeApp";

function mountLayer(input: {
    log: LifecycleEventLog;
    strict?: boolean;
    lifecycleRef?: { current: SurfaceLifecycleManager };
    core?: ReturnType<typeof createRecordingCore> | null;
}) {
    const core = input.core === undefined ? createRecordingCore(input.log) : input.core;
    const lifecycleRef = input.lifecycleRef ?? { current: new SurfaceLifecycleManager() };
    const accessors = makeStateAccessors();
    const element = (
        <RuntimeSurfaceLifecycleLayer
            core={core}
            pack={makeTestPack()}
            surface={makeTestSurface("surface-a")}
            runtimeScopeId="scope-1"
            hostAdapter={makeBlueprintHostAdapter()}
            lifecycleRef={lifecycleRef}
            makeStateAccessors={() => accessors}
        >
            <div data-testid="content" />
        </RuntimeSurfaceLifecycleLayer>
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

describe("game-runtime surface lifecycle dispatch order (characterization)", () => {
    it("defers openScope + surfaceInit by one animation frame", async () => {
        mountLayer({ log: hoisted.log });
        // The one-frame delay is the deliberate cold-start behavior: nothing
        // has been dispatched when mount effects flush...
        expect(hoisted.log).toEqual([]);
        await act(async () => {
            await flushAnimationFrame();
        });
        // ...and the full init sequence lands after the next frame.
        expect(hoisted.log).toEqual([
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });

    it("dispatches closeScope + surfaceUnmount on unmount", async () => {
        const { unmount } = mountLayer({ log: hoisted.log });
        await act(async () => {
            await flushAnimationFrame();
        });
        hoisted.log.length = 0;
        unmount();
        expect(hoisted.log).toEqual([
            "closeScope:scope-1:Preview surface unmounted",
            "dispatch:surfaceUnmount:scope-1",
        ]);
    });

    it("re-dispatches surfaceInit when the same scope remounts after exit", async () => {
        const lifecycleRef = { current: new SurfaceLifecycleManager() };
        const first = mountLayer({ log: hoisted.log, lifecycleRef });
        await act(async () => {
            await flushAnimationFrame();
        });
        first.unmount();
        hoisted.log.length = 0;
        mountLayer({ log: hoisted.log, lifecycleRef });
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });

    it("does nothing while core is null and initializes once core arrives", async () => {
        // This documents the readiness-gating contract RuntimeSurfaceLayer
        // relies on: it withholds `core` (passes null) until the surface
        // renderer reports blueprint subscriptions ready, then re-renders
        // with the real core, which triggers exactly one init sequence.
        const { rerender } = mountLayer({ log: hoisted.log, core: null });
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([]);
        const core = createRecordingCore(hoisted.log);
        const accessors = makeStateAccessors();
        rerender(
            <RuntimeSurfaceLifecycleLayer
                core={core}
                pack={makeTestPack()}
                surface={makeTestSurface("surface-a")}
                runtimeScopeId="scope-1"
                hostAdapter={makeBlueprintHostAdapter()}
                lifecycleRef={{ current: new SurfaceLifecycleManager() }}
                makeStateAccessors={() => accessors}
            >
                <div />
            </RuntimeSurfaceLifecycleLayer>,
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
        mountLayer({ log: hoisted.log, strict: true });
        await act(async () => {
            await flushAnimationFrame();
        });
        // The first effect's frame-wait is cancelled by the StrictMode
        // teardown before it fires, so no phantom surfaceInit is dispatched.
        // The unmount effect's cleanup still runs, producing one phantom
        // closeScope + surfaceUnmount pair before the real init.
        expect(hoisted.log).toEqual([
            "closeScope:scope-1:Preview surface unmounted",
            "dispatch:surfaceUnmount:scope-1",
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });
});
