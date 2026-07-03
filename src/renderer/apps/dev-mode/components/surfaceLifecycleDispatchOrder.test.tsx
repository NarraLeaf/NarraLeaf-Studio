// @vitest-environment jsdom
/**
 * Characterization test: CURRENT surface lifecycle dispatch order of the
 * Dev Mode lifecycle layer. This is the behavior oracle for the Dev Mode /
 * game-runtime unification refactor — expectations here describe what the
 * code does today, not necessarily what is ideal. When a phase intentionally
 * changes Dev Mode semantics (e.g. adopting the runtime's frame-wait before
 * surfaceInit), this file is updated in the same commit with a note.
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

import { DevModeSurfaceLifecycleLayer } from "./DevModeContent";

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
        <DevModeSurfaceLifecycleLayer
            bpCore={core}
            bundle={makeTestBundle()}
            surface={makeTestSurface("surface-a")}
            runtimeScopeId="scope-1"
            hostAdapter={makeBlueprintHostAdapter()}
            lifecycleRef={lifecycleRef}
            makeStateAccessors={() => accessors}
        >
            <div data-testid="content" />
        </DevModeSurfaceLifecycleLayer>
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

describe("Dev Mode surface lifecycle dispatch order (characterization)", () => {
    it("dispatches openScope + surfaceInit synchronously with mount effects", async () => {
        mountLayer({ log: hoisted.log });
        // Current Dev Mode behavior: no frame-wait — events are already
        // recorded when the mount commit's effects have flushed.
        expect(hoisted.log).toEqual([
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
        await act(async () => {
            await flushAnimationFrame();
        });
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
            "closeScope:scope-1:Surface unmounted",
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
        const { rerender } = mountLayer({ log: hoisted.log, core: null });
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([]);
        const core = createRecordingCore(hoisted.log);
        const accessors = makeStateAccessors();
        rerender(
            <DevModeSurfaceLifecycleLayer
                bpCore={core}
                bundle={makeTestBundle()}
                surface={makeTestSurface("surface-a")}
                runtimeScopeId="scope-1"
                hostAdapter={makeBlueprintHostAdapter()}
                lifecycleRef={{ current: new SurfaceLifecycleManager() }}
                makeStateAccessors={() => accessors}
            >
                <div />
            </DevModeSurfaceLifecycleLayer>,
        );
        await act(async () => {
            await flushAnimationFrame();
        });
        expect(hoisted.log).toEqual([
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });

    it("StrictMode double-effect: current behavior dispatches a phantom init/unmount cycle", async () => {
        mountLayer({ log: hoisted.log, strict: true });
        await act(async () => {
            await flushAnimationFrame();
        });
        // Current Dev Mode behavior under StrictMode (dev builds only):
        // mount effects run, are torn down, and run again, producing a
        // phantom surfaceInit + surfaceUnmount pair before the real init.
        expect(hoisted.log).toEqual([
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
            "closeScope:scope-1:Surface unmounted",
            "dispatch:surfaceUnmount:scope-1",
            "openScope:scope-1",
            "dispatch:surfaceInit:scope-1",
        ]);
    });
});
