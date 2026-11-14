// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginApp } from "narraleaf-studio/plugin";
import { useAudioAudition } from "./useAudioAudition";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

function setup() {
    const urls = new Map<string, ReturnType<typeof deferred<string>>>();
    const errors = vi.fn();
    const loadAudioUrl = (id: string) => {
        const pending = deferred<string>();
        urls.set(id, pending);
        return pending.promise;
    };
    const app = {
        services: {
            ui: { notifications: { error: errors } },
            i18n: { createTranslator: () => ({ t: (key: string) => key }) },
        },
    } as unknown as PluginApp;
    const audio: FakeAudio[] = [];
    const playResponses = new Map<string, Promise<void>>();
    class FakeAudio {
        onended: (() => void) | null = null;
        pause = vi.fn();
        play = vi.fn(() => playResponses.get(this.src) ?? Promise.resolve());
        constructor(readonly src: string) { audio.push(this); }
    }
    vi.stubGlobal("Audio", FakeAudio);
    return { app, urls, audio, errors, loadAudioUrl, playResponses };
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe("gallery audio audition", () => {
    it("plays only the latest selection when object URLs resolve out of order", async () => {
        const { app, urls, audio, loadAudioUrl } = setup();
        const { result } = renderHook(() => useAudioAudition(app, loadAudioUrl));
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => { first = result.current.toggle("first", "first"); });
        act(() => { second = result.current.toggle("second", "second"); });
        await act(async () => { urls.get("second")!.resolve("blob:second"); await second; });
        await act(async () => { urls.get("first")!.resolve("blob:first"); await first; });
        expect(audio.map(item => item.src)).toEqual(["blob:second"]);
        expect(result.current.playingKey).toBe("second");
    });

    it("does not start a clip after the editor unmounts", async () => {
        const { app, urls, audio, loadAudioUrl } = setup();
        const { result, unmount } = renderHook(() => useAudioAudition(app, loadAudioUrl));
        let pending!: Promise<void>;
        act(() => { pending = result.current.toggle("first", "first"); });
        unmount();
        await act(async () => { urls.get("first")!.resolve("blob:first"); await pending; });
        expect(audio).toHaveLength(0);
    });

    it("ignores a superseded resource failure", async () => {
        const { app, urls, audio, errors, loadAudioUrl } = setup();
        const { result } = renderHook(() => useAudioAudition(app, loadAudioUrl));
        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => { first = result.current.toggle("first", "first"); });
        act(() => { second = result.current.toggle("second", "second"); });
        await act(async () => { urls.get("second")!.resolve("blob:second"); await second; });
        await act(async () => { urls.get("first")!.reject(new Error("old failure")); await first; });
        expect(audio[0]!.pause).not.toHaveBeenCalled();
        expect(result.current.playingKey).toBe("second");
        expect(errors).not.toHaveBeenCalled();
    });

    it("stops a pending request and reports a current resource failure", async () => {
        const { app, urls, audio, errors, loadAudioUrl } = setup();
        const { result } = renderHook(() => useAudioAudition(app, loadAudioUrl));
        let stopped!: Promise<void>;
        act(() => { stopped = result.current.toggle("first", "first"); });
        act(() => result.current.stop());
        await act(async () => { urls.get("first")!.resolve("blob:first"); await stopped; });
        expect(audio).toHaveLength(0);

        let failed!: Promise<void>;
        act(() => { failed = result.current.toggle("second", "second"); });
        await act(async () => { urls.get("second")!.reject(new Error("unavailable")); await failed; });
        expect(errors).toHaveBeenCalledOnce();
        expect(result.current.playingKey).toBeNull();
    });

    it("does not stop the current clip when the previous play call rejects", async () => {
        const { app, urls, audio, errors, loadAudioUrl, playResponses } = setup();
        const firstPlay = deferred<void>();
        playResponses.set("blob:first", firstPlay.promise);
        const { result } = renderHook(() => useAudioAudition(app, loadAudioUrl));
        let first!: Promise<void>;
        act(() => { first = result.current.toggle("first", "first"); });
        await act(async () => { urls.get("first")!.resolve("blob:first"); await Promise.resolve(); });
        let second!: Promise<void>;
        act(() => { second = result.current.toggle("second", "second"); });
        await act(async () => { urls.get("second")!.resolve("blob:second"); await second; });
        await act(async () => { firstPlay.reject(new Error("play interrupted")); await first; });
        expect(audio[1]!.pause).not.toHaveBeenCalled();
        expect(result.current.playingKey).toBe("second");
        expect(errors).not.toHaveBeenCalled();
    });
});
