import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_FOLLOW_KEY } from "@shared/agent/follow";
import { Services } from "../services";
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

/**
 * Follow is the Studio-wide setting, not a per-project switch: read from global state when the
 * workspace opens, followed when another window or Settings changes it, and written back there by
 * the Agent menu and the status bar cell.
 */
describe("AgentFollowService: follow mode is the Studio-wide setting", () => {
    function createSettings(stored: Record<string, unknown> = {}) {
        const listeners = new Map<string, Set<(value: unknown) => void>>();
        const values: Record<string, unknown> = { ...stored };
        return {
            values,
            set: vi.fn(async (key: string, value: unknown) => {
                values[key] = value;
            }),
            getSync: (key: string) => values[key],
            onChange(key: string, listener: (value: unknown) => void) {
                const set = listeners.get(key) ?? new Set();
                set.add(listener);
                listeners.set(key, set);
                return () => set.delete(listener);
            },
            /** What the main process's broadcast does in every window when the key is written. */
            broadcast(key: string, value: unknown) {
                values[key] = value;
                for (const listener of [...(listeners.get(key) ?? [])]) {
                    listener(value);
                }
            },
            listenerCount: (key: string) => listeners.get(key)?.size ?? 0,
        };
    }

    async function open(settings: ReturnType<typeof createSettings>) {
        const follow = new AgentFollowService();
        const context = {
            services: {
                get(serviceId: Services) {
                    if (serviceId === Services.GlobalSettings) {
                        return settings;
                    }
                    throw new Error(`Unexpected service ${serviceId}`);
                },
            },
        } as any;
        follow.setContext(context);
        await (follow as any).init(context, async () => undefined);
        return { follow, context };
    }

    it("is on when nothing is stored, so every write takes the foreground by default", async () => {
        expect(new AgentFollowService().getState().follow).toBe(true);
        const { follow } = await open(createSettings());
        expect(follow.getState().follow).toBe(true);
    });

    it("reads what the author chose, and the default for anything that is not a boolean", async () => {
        expect((await open(createSettings({ [AGENT_FOLLOW_KEY]: false }))).follow.getState().follow).toBe(false);
        expect((await open(createSettings({ [AGENT_FOLLOW_KEY]: "no" }))).follow.getState().follow).toBe(true);
    });

    it("writes the setting when switched from the menu, and nothing per project", async () => {
        const settings = createSettings();
        const { follow } = await open(settings);
        const changed = vi.fn();
        follow.onChanged(changed);

        follow.setFollow(false);

        expect(follow.getState().follow).toBe(false);
        expect(changed).toHaveBeenCalledWith(expect.objectContaining({ follow: false }));
        expect(settings.set).toHaveBeenCalledWith(AGENT_FOLLOW_KEY, false);
        expect(settings.set).toHaveBeenCalledTimes(1);
        // Switching to what it already is writes nothing.
        follow.setFollow(false);
        expect(settings.set).toHaveBeenCalledTimes(1);
    });

    it("follows the setting when another window or Settings changes it, and a reset turns it back on", async () => {
        const settings = createSettings();
        const { follow } = await open(settings);
        const changed = vi.fn();
        follow.onChanged(changed);

        settings.broadcast(AGENT_FOLLOW_KEY, false);
        expect(follow.getState().follow).toBe(false);
        expect(changed).toHaveBeenCalledTimes(1);

        // The echo of this window's own write changes nothing.
        settings.broadcast(AGENT_FOLLOW_KEY, false);
        expect(changed).toHaveBeenCalledTimes(1);

        settings.broadcast(AGENT_FOLLOW_KEY, undefined);
        expect(follow.getState().follow).toBe(true);
        expect(settings.set).not.toHaveBeenCalled();
    });

    it("stops following the setting when the workspace closes", async () => {
        const settings = createSettings();
        const { follow, context } = await open(settings);
        expect(settings.listenerCount(AGENT_FOLLOW_KEY)).toBe(1);
        follow.dispose(context);
        expect(settings.listenerCount(AGENT_FOLLOW_KEY)).toBe(0);
    });
});
