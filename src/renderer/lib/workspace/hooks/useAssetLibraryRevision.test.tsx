// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "../services/ui/EventEmitter";
import { Services } from "../services/services";
import { useAssetLibraryRevision } from "./useAssetLibraryRevision";

/**
 * The counter every surface that prints an asset name keys on.
 *
 * Worth a test of its own because the failure it guards against is invisible: drop one of these
 * feeds and the surfaces still render, still resolve the name live, and still show the OLD one -
 * right up until something unrelated re-renders them. That was the original bug (a rename that
 * appeared only when the row was hovered), so what is asserted here is that each door into "this id
 * now names something else" moves the counter.
 */

const assetEvents = new EventEmitter<Record<string, unknown>>();
let setsListeners: Array<() => void> = [];
let missingServices = new Set<Services>();

vi.mock("@/apps/workspace/context", () => ({
    useOptionalWorkspace: () => ({
        isInitialized: true,
        context: {
            services: {
                get: (service: Services) => {
                    if (missingServices.has(service)) {
                        throw new Error(`Service ${service} not found`);
                    }
                    if (service === Services.Assets) {
                        return { getEvents: () => assetEvents };
                    }
                    return {
                        onSetsChanged: (handler: () => void) => {
                            setsListeners.push(handler);
                            return () => {
                                setsListeners = setsListeners.filter(entry => entry !== handler);
                            };
                        },
                    };
                },
            },
        },
    }),
}));

beforeEach(() => {
    assetEvents.clear();
    setsListeners = [];
    missingServices = new Set();
});

describe("useAssetLibraryRevision", () => {
    it("changes when a file is renamed or retagged", () => {
        const { result } = renderHook(() => useAssetLibraryRevision());
        const before = result.current;

        act(() => assetEvents.emit("updated", { id: "asset-1" }));

        expect(result.current).not.toBe(before);
    });

    it("changes when a file is deleted", () => {
        const { result } = renderHook(() => useAssetLibraryRevision());
        const before = result.current;

        act(() => assetEvents.emit("deleted", { id: "asset-1" }));

        expect(result.current).not.toBe(before);
    });

    /** A row may name a set, so a set's name is an answer this counter has to cover too. */
    it("changes when the project's asset sets change", () => {
        const { result } = renderHook(() => useAssetLibraryRevision());
        const before = result.current;

        expect(setsListeners).toHaveLength(1);
        act(() => setsListeners.forEach(listener => listener()));

        expect(result.current).not.toBe(before);
    });

    it("unsubscribes from both feeds on unmount", () => {
        const { unmount } = renderHook(() => useAssetLibraryRevision());
        expect(assetEvents.listenerCount("updated")).toBe(1);
        expect(setsListeners).toHaveLength(1);

        unmount();

        expect(assetEvents.listenerCount("updated")).toBe(0);
        expect(assetEvents.listenerCount("deleted")).toBe(0);
        expect(setsListeners).toHaveLength(0);
    });

    /** The shared `@/lib/ui-editor` tree renders in windows that carry only part of the service set. */
    it("still follows the library when there is no asset-set service", () => {
        missingServices.add(Services.AssetSets);
        const { result } = renderHook(() => useAssetLibraryRevision());
        const before = result.current;

        act(() => assetEvents.emit("updated", { id: "asset-1" }));

        expect(result.current).not.toBe(before);
    });
});
