import { describe, expect, it } from "vitest";
import type { AppWindow } from "../appWindow";
import {
    AppGlobalStateDeleteHandler,
    AppGlobalStateGetAllHandler,
    AppGlobalStateGetHandler,
    AppGlobalStateSetHandler,
} from "./appAction";

/**
 * The keys a window may not write.
 *
 * Every window can reach the global-state handlers - the IPC registry is one for the whole process -
 * and three keys in that store decide whose credential a request carries and where it goes: the
 * server sign-ins (whose `authUrl` is where a stored token is presented), the sealed tokens, and the
 * record of which project uses which sign-in. A renderer that could write any of them could answer
 * the sign-in question for itself or send a token wherever it liked, so only the main process writes
 * them. The sealed tokens do not cross to a renderer at all.
 */

function makeWindow(initial: Record<string, unknown>) {
    const store = new Map<string, unknown>(Object.entries(initial));
    const written: string[] = [];
    const app = {
        logger: { warn: () => undefined },
        globalState: {
            get: (key: string) => store.get(key),
            has: (key: string) => store.has(key),
            raw: () => Object.fromEntries(store),
        },
        setGlobalStateAndBroadcast: (key: string, value: unknown) => {
            written.push(key);
            store.set(key, value);
        },
        deleteGlobalStateAndBroadcast: (key: string) => {
            written.push(`-${key}`);
            store.delete(key);
        },
    };
    return { window: { app } as unknown as AppWindow, store, written };
}

const SESSIONS = [{ remoteOrigin: "lore://team.example.lan:41337", authUrl: "https://team.example.lan:41402" }];

describe("keys only the main process writes", () => {
    it.each([
        "versionControl.serverSessions",
        "versionControl.serverTokens",
        "versionControl.serverSessionProjects",
    ])("refuses to set %s from a window", key => {
        const { window, written } = makeWindow({});
        const result = new AppGlobalStateSetHandler().handle(window, { key: key as never, value: [] as never });
        expect(result.success).toBe(false);
        expect(written).toEqual([]);
    });

    it("refuses to delete them, and says which were refused", () => {
        const { window, store } = makeWindow({
            "versionControl.serverSessions": SESSIONS,
            "versionControl.serverSessionProjects": [],
            "app.theme": "dark",
        });
        const result = new AppGlobalStateDeleteHandler().handle(window, {
            keys: ["versionControl.serverSessions", "versionControl.serverSessionProjects", "app.theme"],
        });
        expect(result.success && result.data).toEqual({
            deleted: ["app.theme"],
            refused: ["versionControl.serverSessions", "versionControl.serverSessionProjects"],
        });
        expect(store.get("versionControl.serverSessions")).toEqual(SESSIONS);
    });

    it("still lets a window set an ordinary preference", () => {
        const { window, written } = makeWindow({});
        const result = new AppGlobalStateSetHandler().handle(window, { key: "app.theme" as never, value: "dark" as never });
        expect(result.success).toBe(true);
        expect(written).toEqual(["app.theme"]);
    });
});

describe("keys that never reach a window", () => {
    it("reads the sealed tokens as unset", () => {
        const { window } = makeWindow({ "versionControl.serverTokens": { "lore://x": "c2VhbGVk" } });
        const result = new AppGlobalStateGetHandler().handle(window, { key: "versionControl.serverTokens" as never });
        expect(result.success && result.data.value).toBeUndefined();
    });

    it("leaves them out of the whole store, and keeps everything else", () => {
        const { window } = makeWindow({
            "versionControl.serverTokens": { "lore://x": "c2VhbGVk" },
            "versionControl.serverSessions": SESSIONS,
        });
        const result = new AppGlobalStateGetAllHandler().handle(window);
        const settings = result.success ? (result.data.settings as Record<string, unknown>) : {};
        expect(settings).not.toHaveProperty("versionControl.serverTokens");
        // The sign-ins themselves are not secret - Settings lists them - so they are still read.
        expect(settings["versionControl.serverSessions"]).toEqual(SESSIONS);
    });
});
