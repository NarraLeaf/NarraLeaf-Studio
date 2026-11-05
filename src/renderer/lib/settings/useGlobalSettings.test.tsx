// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useGlobalSettings } from "./useGlobalSettings";

const fixture = vi.hoisted(() => ({
    reads: new Map<string, (answer: unknown) => void>(),
    listeners: new Set<(change: { key: string; value: unknown }) => void>(),
}));
vi.mock("@/lib/app/bridge", () => ({ getInterface: () => ({ app: { state: {
    getGlobalState: (key: string) => new Promise(resolve => fixture.reads.set(key, value => resolve({ success: true, data: { value } }))),
    onGlobalStateChanged: (listener: (change: { key: string; value: unknown }) => void) => {
        fixture.listeners.add(listener);
        return { cancel: () => fixture.listeners.delete(listener) };
    },
} } }) }));
beforeEach(() => { fixture.reads.clear(); fixture.listeners.clear(); });

it("keeps broadcasts per key while still loading untouched preferences", async () => {
    const { result } = renderHook(() => useGlobalSettings(["ui.zoomPercent", "app.language"]));
    await waitFor(() => expect(fixture.reads.size).toBe(2));
    act(() => fixture.listeners.forEach(listener => listener({ key: "ui.zoomPercent", value: 125 })));
    await act(async () => {
        fixture.reads.get("ui.zoomPercent")!(100);
        fixture.reads.get("app.language")!("ja");
    });
    expect(result.current.values).toEqual({ "ui.zoomPercent": 125, "app.language": "ja" });
    expect(result.current.loading).toBe(false);
});
