// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18nStore } from "@/lib/i18n";
import { ABBREVIATIONS_SETTING_KEY } from "./storyCommandAbbreviations";
import { useStoryCommandAbbreviations } from "./useStoryCommandAbbreviations";

/**
 * The abbreviation list the command manual edits and the line being typed reads. It goes through the
 * same shared-preference hook as the starred commands, so the cache seeding and write-back covered
 * there hold here; this covers what is particular to the list.
 */

let stored: unknown;
let listeners: Array<(change: { key: string; value: unknown }) => void> = [];
let writes: unknown[] = [];

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        app: {
            state: {
                getGlobalState: async (_key: string) => ({ success: true, data: { value: stored } }),
                setGlobalState: async (_key: string, value: unknown) => {
                    writes.push(value);
                    return { success: true, data: undefined };
                },
                onGlobalStateChanged: (handler: (change: { key: string; value: unknown }) => void) => {
                    listeners.push(handler);
                    return { cancel: () => { listeners = listeners.filter(entry => entry !== handler); } };
                },
            },
        },
    }),
}));

vi.mock("@/apps/workspace/context", () => ({
    useOptionalWorkspace: () => null,
}));

const entries = (map: ReadonlyMap<string, string>) => [...map];

beforeEach(() => {
    stored = undefined;
    listeners = [];
    writes = [];
});

afterEach(() => {
    i18nStore.setLocale("en");
});

describe("useStoryCommandAbbreviations", () => {
    it("reads the stored list", async () => {
        stored = { c: "face" };
        const { result } = renderHook(() => useStoryCommandAbbreviations());
        await waitFor(() => expect(entries(result.current.abbreviations)).toEqual([["c", "face"]]));
        expect(entries(result.current.live)).toEqual([["c", "face"]]);
    });

    it("writes additions and removals as a word → command record", async () => {
        const { result } = renderHook(() => useStoryCommandAbbreviations());
        await waitFor(() => expect(listeners.length).toBe(1));
        act(() => result.current.addAbbreviation(" C ", "face"));
        act(() => result.current.addAbbreviation("bj", "background"));
        expect(entries(result.current.abbreviations)).toEqual([["c", "face"], ["bj", "background"]]);
        act(() => result.current.removeAbbreviation("C"));
        expect(writes).toEqual([{ c: "face" }, { c: "face", bj: "background" }, { bj: "background" }]);
    });

    it("follows a change made in another window", async () => {
        const { result } = renderHook(() => useStoryCommandAbbreviations());
        await waitFor(() => expect(listeners.length).toBe(1));
        act(() => {
            for (const listener of [...listeners]) {
                listener({ key: ABBREVIATIONS_SETTING_KEY, value: { wg: "face" } });
            }
        });
        expect(entries(result.current.abbreviations)).toEqual([["wg", "face"]]);
    });

    it("keeps a word a built-in has taken in the list, but not among the live ones", async () => {
        stored = { show: "hide", c: "face" };
        const { result } = renderHook(() => useStoryCommandAbbreviations());
        await waitFor(() => expect(result.current.abbreviations.size).toBe(2));
        expect(entries(result.current.live)).toEqual([["c", "face"]]);
    });
});
