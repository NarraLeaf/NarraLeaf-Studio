// @vitest-environment jsdom
/**
 * That autosaving survives the mount React gives every unpackaged build.
 *
 * `React.StrictMode` is on whenever Studio is not packaged - which is every Dev Mode run - and it
 * mounts each effect, tears it down and mounts it again, all against the one instance `useMemo`
 * produced. The hook used to dispose the scheduler in that cleanup, so the throwaway pass switched
 * off the scheduler the surviving mount went on using: Dev Mode wrote no autosave at all for the
 * life of the window, and the `Auto Save` node answered "needs a running game" over a stage that was
 * plainly playing, while a packaged build - no StrictMode - wrote them correctly.
 *
 * Exercised through the hook rather than the scheduler because the scheduler is not where the bug
 * was: every scheduler test passed while this was broken.
 *
 * Comments in English per project convention.
 */

import { StrictMode, useImperativeHandle, type Ref } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTO_SAVE_CONFIGURATION, autoSaveSlotId } from "@shared/types/saves";
import { useAutoSave, type AutoSaveRuntime } from "./useAutoSave";

type Probe = {
    written: string[];
    advance: () => void;
    runtime: AutoSaveRuntime | null;
};

function AutoSaveProbe(props: {
    written: string[];
    playing: () => boolean;
    handle: Ref<AutoSaveRuntime>;
    listeners: Array<() => void>;
}) {
    const runtime = useAutoSave({
        config: { ...DEFAULT_AUTO_SAVE_CONFIGURATION, intervalSeconds: 1 },
        isPlaying: props.playing,
        write: async id => { props.written.push(id); },
        listStored: async () => [],
        subscribeStoryAdvanced: listener => {
            props.listeners.push(listener);
            return () => {
                const at = props.listeners.indexOf(listener);
                if (at >= 0) {
                    props.listeners.splice(at, 1);
                }
            };
        },
        log: () => undefined,
    });
    useImperativeHandle(props.handle, () => runtime, [runtime]);
    return null;
}

function mount(options?: { playing?: boolean }): Probe {
    const written: string[] = [];
    const listeners: Array<() => void> = [];
    const probe: Probe = {
        written,
        // What the story play head does: every subscriber still attached is told.
        advance: () => { for (const listener of [...listeners]) { listener(); } },
        runtime: null,
    };
    render(
        <StrictMode>
            <AutoSaveProbe
                written={written}
                playing={() => options?.playing ?? true}
                handle={value => { probe.runtime = value; }}
                listeners={listeners}
            />
        </StrictMode>,
    );
    return probe;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("useAutoSave under StrictMode", () => {
    it("writes on the timer after the mount React throws away", async () => {
        const probe = mount();

        probe.advance();
        await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });

        expect(probe.written).toEqual([autoSaveSlotId(0)]);
    });

    it("answers an explicit Auto Save rather than refusing it", async () => {
        const probe = mount();

        await act(async () => { await probe.runtime?.writeNow(); });

        expect(probe.written).toEqual([autoSaveSlotId(0)]);
    });

    it("still refuses an explicit Auto Save when no playthrough is running", async () => {
        const probe = mount({ playing: false });

        await expect(probe.runtime?.writeNow()).rejects.toThrow("“Auto Save” needs a running game.");
        expect(probe.written).toEqual([]);
    });
});
