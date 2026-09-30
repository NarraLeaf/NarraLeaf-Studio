import path from "path";
import { describe, expect, it } from "vitest";
import { SESSION_MARKER_FILE, markSessionRunning, type SessionMarkerHost } from "./sessionMarker";

const PROFILE = path.join("D:", "profiles", "acme");
const MARKER = path.join(PROFILE, SESSION_MARKER_FILE);

function makeHost(seed: Record<string, string> = {}) {
    const files = new Map<string, string>(Object.entries(seed));
    const warnings: string[] = [];
    const willQuit: (() => void)[] = [];
    let writeFails: Error | null = null;
    let removeFails: Error | null = null;

    const host: SessionMarkerHost = {
        exists: file => files.has(file),
        write: (file, text) => {
            if (writeFails) {
                throw writeFails;
            }
            files.set(file, text);
        },
        remove: file => {
            if (removeFails) {
                throw removeFails;
            }
            files.delete(file);
        },
        warn: message => warnings.push(message),
        onWillQuit: handler => willQuit.push(handler),
        now: () => new Date("2026-09-22T10:00:00.000Z"),
    };

    return {
        host,
        files,
        warnings,
        quit: () => willQuit.forEach(handler => handler()),
        willQuitCount: () => willQuit.length,
        failWrite: (error: Error) => { writeFails = error; },
        failRemove: (error: Error) => { removeFails = error; },
    };
}

describe("markSessionRunning", () => {
    it("leaves a marker for the length of an ordinary session", () => {
        const world = makeHost();

        const marker = markSessionRunning({ userDataDir: PROFILE, wanted: true }, world.host);

        expect(marker).toBe(MARKER);
        expect(world.files.get(MARKER)).toBe("2026-09-22T10:00:00.000Z");
        expect(world.warnings).toEqual([]);

        world.quit();
        expect(world.files.has(MARKER)).toBe(false);
    });

    it("says so when the last session left its own behind", () => {
        const world = makeHost({ [MARKER]: "2026-09-21T09:00:00.000Z" });

        markSessionRunning({ userDataDir: PROFILE, wanted: true }, world.host);

        expect(world.warnings).toHaveLength(1);
        expect(world.warnings[0]).toContain("did not shut down cleanly");
        // Replaced by this session's own, so the next launch answers about this one.
        expect(world.files.get(MARKER)).toBe("2026-09-22T10:00:00.000Z");
    });

    // The whole of the command-line case: a run ends by exit() with the code it decided, which never
    // reaches `will-quit` - so a marker it wrote would stay behind and every later run would open on
    // "the previous session did not shut down cleanly".
    it("writes nothing, reads nothing and registers nothing in a command-line run", () => {
        const world = makeHost();

        expect(markSessionRunning({ userDataDir: PROFILE, wanted: false }, world.host)).toBeNull();

        expect(world.files.size).toBe(0);
        expect(world.warnings).toEqual([]);
        expect(world.willQuitCount()).toBe(0);
    });

    it("does not consume a marker the profile's own last session left", () => {
        const world = makeHost({ [MARKER]: "2026-09-21T09:00:00.000Z" });

        markSessionRunning({ userDataDir: PROFILE, wanted: false }, world.host);
        world.quit();

        expect(world.files.get(MARKER)).toBe("2026-09-21T09:00:00.000Z");
        expect(world.warnings).toEqual([]);
    });

    it("carries on when the profile cannot be written", () => {
        const world = makeHost();
        world.failWrite(new Error("EACCES"));

        expect(markSessionRunning({ userDataDir: PROFILE, wanted: true }, world.host)).toBeNull();

        expect(world.warnings[0]).toContain("Could not record the session marker");
        // Nothing to remove, so nothing was registered to remove it.
        expect(world.willQuitCount()).toBe(0);
    });

    it("carries on when the marker cannot be removed on the way out", () => {
        const world = makeHost();
        world.failRemove(new Error("EBUSY"));

        markSessionRunning({ userDataDir: PROFILE, wanted: true }, world.host);
        expect(() => world.quit()).not.toThrow();

        expect(world.warnings.some(line => line.includes("Could not clear the session marker"))).toBe(true);
    });
});
