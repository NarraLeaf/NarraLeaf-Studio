import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_ACTIVE_IDLE_MS, AgentFollowService, LAST_WRITE_VISIBLE_MS } from "./AgentFollowService";

describe("AgentFollowService: what the status bar shows", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("stays active between calls and goes idle only after the idle window", () => {
        const follow = new AgentFollowService();
        expect(follow.getState().active).toBe(false);
        follow.beginCall("1", "ui_show", "Claude Code");
        expect(follow.getState().active).toBe(true);
        follow.endCall("1");
        vi.advanceTimersByTime(AGENT_ACTIVE_IDLE_MS - 1);
        expect(follow.getState().active).toBe(true);
        // A second call inside the window keeps the wash on without a gap.
        follow.beginCall("2", "ui_patch", "Claude Code");
        vi.advanceTimersByTime(AGENT_ACTIVE_IDLE_MS * 2);
        expect(follow.getState().active).toBe(true);
        follow.endCall("2");
        vi.advanceTimersByTime(AGENT_ACTIVE_IDLE_MS);
        expect(follow.getState().active).toBe(false);
    });

    it("counts a paused agent as active until it is resumed and then idles", () => {
        const follow = new AgentFollowService();
        follow.beginCall("1", "ui_show", null);
        follow.endCall("1");
        follow.setPaused(true);
        vi.advanceTimersByTime(AGENT_ACTIVE_IDLE_MS * 3);
        expect(follow.getState().active).toBe(true);
        follow.setPaused(false);
        vi.advanceTimersByTime(AGENT_ACTIVE_IDLE_MS);
        expect(follow.getState().active).toBe(false);
    });

    it("names the last write for a few seconds, then forgets it", () => {
        const follow = new AgentFollowService();
        follow.noteWrite({ kind: "surface", surfaceId: "s", name: "Title" });
        expect(follow.getState().lastWrite).toEqual({ name: "Title" });
        vi.advanceTimersByTime(LAST_WRITE_VISIBLE_MS);
        expect(follow.getState().lastWrite).toBeNull();
    });
});
