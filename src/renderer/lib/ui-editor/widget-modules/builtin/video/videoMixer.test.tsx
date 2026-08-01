// @vitest-environment jsdom
/**
 * The `<video>` element's volume.
 *
 * It used to be `videoProps.volume` written straight onto the DOM node, so the clip obeyed no player
 * setting: mute the game and the video kept playing at full volume. These cover the two halves of
 * the fix - resolving through the host's mixer, and *staying* resolved while the player drags a
 * slider mid-playback, which a one-shot read would not.
 */
import { renderHook, act, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { resolveVideoMixerHost, useVideoElementVolume, type VideoMixerHost } from "./videoMixer";

/** A host whose mixer state can be moved, the way a settings slider moves it. */
function createMixerHost(initial: number) {
    const listeners = new Set<() => void>();
    let master = initial;
    const host: VideoMixerHost = {
        resolveElementVolume: input => (input.volume ?? 1) * master,
        subscribeMixerChanges: listener => {
            listeners.add(listener);
            return () => void listeners.delete(listener);
        },
    };
    return {
        host,
        listenerCount: () => listeners.size,
        setMaster: (value: number) => {
            master = value;
            listeners.forEach(listener => listener());
        },
    };
}

describe("useVideoElementVolume", () => {
    afterEach(cleanup);

    it("resolves the authored volume through the host on first render", () => {
        const { host } = createMixerHost(0.5);

        const { result } = renderHook(() => useVideoElementVolume(host, "music", 0.8));

        expect(result.current).toBeCloseTo(0.4);
    });

    it("follows a slider the player drags mid-playback", () => {
        const mixer = createMixerHost(1);
        const { result } = renderHook(() => useVideoElementVolume(mixer.host, "music", 1));
        expect(result.current).toBe(1);

        act(() => mixer.setMaster(0));

        // Muting the game now silences the video. This is the defect, in one assertion.
        expect(result.current).toBe(0);
    });

    it("re-reads on resubscribe, not only on the next change", () => {
        // A preference the player set before this widget mounted produces no event; without the
        // read-on-subscribe the clip would start at the wrong level until a slider happened to move.
        const mixer = createMixerHost(0.25);
        const { result, rerender } = renderHook(
            ({ volume }: { volume: number }) => useVideoElementVolume(mixer.host, "music", volume),
            { initialProps: { volume: 1 } },
        );
        expect(result.current).toBeCloseTo(0.25);

        rerender({ volume: 0.4 });

        expect(result.current).toBeCloseTo(0.1);
    });

    it("releases its subscription on unmount", () => {
        const mixer = createMixerHost(1);
        const { unmount } = renderHook(() => useVideoElementVolume(mixer.host, null, 1));
        expect(mixer.listenerCount()).toBe(1);

        unmount();

        expect(mixer.listenerCount()).toBe(0);
    });

    it("plays the authored volume unchanged with no host", () => {
        // The editor canvas: no live game to read preferences from, and an author scrubbing a clip
        // expects to hear what they typed.
        const { result } = renderHook(() => useVideoElementVolume(null, "music", 0.6));

        expect(result.current).toBe(0.6);
    });
});

describe("resolveVideoMixerHost", () => {
    it("is null on the editor canvas", () => {
        expect(resolveVideoMixerHost({ host: {} } as unknown as UIHostAdapter)).toBeNull();
    });

    it("is null on a live host whose API predates the mixer seam", () => {
        const adapter = { blueprintRuntime: { hostApi: { sound: { play: vi.fn() } } } } as unknown as UIHostAdapter;

        expect(resolveVideoMixerHost(adapter)).toBeNull();
    });

    it("returns the sound capability on a live host that has it", () => {
        const sound = { resolveElementVolume: () => 1, subscribeMixerChanges: () => () => undefined };
        const adapter = { blueprintRuntime: { hostApi: { sound } } } as unknown as UIHostAdapter;

        expect(resolveVideoMixerHost(adapter)).toBe(sound);
    });
});
