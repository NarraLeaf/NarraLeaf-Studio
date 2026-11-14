// @vitest-environment jsdom
import { Suspense, useLayoutEffect } from "react";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DevModeBundle } from "@shared/types/devMode";
import { ScopeStoreBridge, type BlueprintPersistentStoreAdapter } from "@/lib/ui-editor/blueprint-runtime/ScopeStoreBridge";
import * as scriptMount from "@/lib/ui-editor/blueprint-runtime/mountBlueprintScripts";
import { blueprintDocumentOf } from "@/lib/ui-editor/runtime/testing/rowRuntimeTestKit";
import { useBlueprintRuntimeCore, type BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import { usePlaytime } from "./usePlaytime";
import { usePlaytimeSource } from "./usePlaytimeSource";

const bundle = {
    bundleId: "bundle",
    revision: 1,
    ui: {
        uidoc: { surfaces: [], elements: {} },
        localBlueprints: blueprintDocumentOf([]),
        uigraphs: { blueprintDocument: blueprintDocumentOf([]) },
        persistentVariables: {},
        savedVariables: {},
        saveSchema: [],
    },
} as unknown as DevModeBundle;

function store(writes: number[]): BlueprintPersistentStoreAdapter {
    return {
        getAll: async () => ({}),
        getValue: async () => 500,
        setValue: async (_key, value) => { writes.push(value as number); },
    };
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("playtime across runtime core replacement", () => {
    it("retains accrued time while a same-revision core is replaced", async () => {
        vi.useFakeTimers();
        const finishes: Array<() => void> = [];
        vi.spyOn(scriptMount, "mountBlueprintCompiledScripts")
            .mockImplementation(() => new Promise<void>(resolve => { finishes.push(resolve); }));
        const firstWrites: number[] = [];
        const nextWrites: number[] = [];
        const firstStore = store(firstWrites);
        const nextStore = store(nextWrites);
        const view = renderHook(({ adapter }) => {
            const options = { persistenceAdapter: adapter };
            const core = useBlueprintRuntimeCore(bundle, options);
            const source = usePlaytimeSource(core, bundle, options);
            const playtime = usePlaytime({
                isPlaying: () => true,
                persistenceSource: source,
                persistenceGetAsync: async key => source?.persistenceGetAsync(key),
                persistenceSet: (key, value) => { void source?.persistenceSet(key, value); },
                tickIntervalMs: 20,
            });
            return { core, playtime };
        }, { initialProps: { adapter: firstStore } });

        await act(async () => { finishes[0](); });
        expect(view.result.current.core).not.toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(120); });
        const previousCore = view.result.current.core;
        view.rerender({ adapter: nextStore });
        expect(view.result.current.core).toBe(previousCore);
        act(() => { view.result.current.playtime.flush(); });
        expect(firstWrites).toEqual([]);
        await act(async () => { finishes[1](); });
        act(() => { view.result.current.playtime.flush(); });
        expect(nextWrites).toHaveLength(1);
        expect(nextWrites[0]).toBeGreaterThan(500);
    });

    it("does not revive a detached core when its original adapter returns before replacement", async () => {
        vi.useFakeTimers();
        const finishes: Array<() => void> = [];
        vi.spyOn(scriptMount, "mountBlueprintCompiledScripts")
            .mockImplementation(() => new Promise<void>(resolve => { finishes.push(resolve); }));
        const writes: number[] = [];
        const firstStore = store(writes);
        const otherStore = store([]);
        const view = renderHook(({ adapter }) => {
            const options = { persistenceAdapter: adapter };
            const core = useBlueprintRuntimeCore(bundle, options);
            const source = usePlaytimeSource(core, bundle, options);
            const playtime = usePlaytime({
                isPlaying: () => true,
                persistenceSource: source,
                persistenceGetAsync: async key => source?.persistenceGetAsync(key),
                persistenceSet: (key, value) => { void source?.persistenceSet(key, value); },
                tickIntervalMs: 20,
            });
            return { source, playtime };
        }, { initialProps: { adapter: firstStore } });

        await act(async () => { finishes[0](); });
        await act(async () => { await vi.advanceTimersByTimeAsync(120); });
        view.rerender({ adapter: otherStore });
        view.rerender({ adapter: firstStore });
        expect(view.result.current.source).toBeNull();
        act(() => { view.result.current.playtime.flush(); });
        await act(async () => { finishes[1](); finishes[2](); });
        act(() => { view.result.current.playtime.flush(); });
        expect(writes).toHaveLength(1);
        expect(writes[0]).toBeGreaterThan(500);
    });

    it("keeps a committed source when a different adapter's render is abandoned", () => {
        const firstStore = store([]);
        const otherStore = store([]);
        const scopeBridge = new ScopeStoreBridge();
        const core = { bundleId: bundle.bundleId, bundleRevision: bundle.revision, scopeBridge } as BlueprintRuntimeCore;
        const pending = new Promise<void>(() => undefined);
        let committedSource: ScopeStoreBridge | null = null;
        function Probe({ adapter, suspend }: { adapter: BlueprintPersistentStoreAdapter; suspend: boolean }) {
            const source = usePlaytimeSource(core, bundle, { persistenceAdapter: adapter });
            useLayoutEffect(() => { committedSource = source; }, [source]);
            if (suspend) throw pending;
            return <span>Ready</span>;
        }
        const tree = (adapter: BlueprintPersistentStoreAdapter, suspend: boolean) => (
            <Suspense fallback={<span>Waiting</span>}><Probe adapter={adapter} suspend={suspend} /></Suspense>
        );
        const view = render(tree(firstStore, false));
        expect(committedSource).toBe(scopeBridge);
        view.rerender(tree(otherStore, true));
        expect(view.getByText("Waiting")).toBeTruthy();
        view.rerender(tree(firstStore, false));
        expect(committedSource).toBe(scopeBridge);
    });
});
