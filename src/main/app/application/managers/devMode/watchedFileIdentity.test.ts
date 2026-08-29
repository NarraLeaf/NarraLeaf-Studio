import { describe, expect, it } from "vitest";
import { watchedFileIdentity } from "./DevModeManager";

/**
 * The guard that stops a running Dev Mode session from scheduling reloads of itself.
 *
 * The watcher reports a last-access-time update as a change, and NTFS updates access times by
 * default - so reading a file is indistinguishable from editing one at the event level. The running
 * game reads every asset it preloads and a preview build copies every asset it ships, so a session
 * that was doing nothing but running kept scheduling reloads of itself.
 */
describe("watchedFileIdentity", () => {
    it("is the same for a file that was only read", () => {
        const before = watchedFileIdentity({ mtimeMs: 1_700_000_000_000, size: 4096 });
        const afterAnAccess = watchedFileIdentity({ mtimeMs: 1_700_000_000_000, size: 4096 });

        expect(afterAnAccess).toBe(before);
    });

    it("differs when the file was written", () => {
        const before = watchedFileIdentity({ mtimeMs: 1_700_000_000_000, size: 4096 });

        expect(watchedFileIdentity({ mtimeMs: 1_700_000_000_001, size: 4096 })).not.toBe(before);
        expect(watchedFileIdentity({ mtimeMs: 1_700_000_000_000, size: 4097 })).not.toBe(before);
    });

    /**
     * Unknown counts as changed everywhere it is read: missing a real edit leaves the author running
     * a game that is not their script, while an extra reload only costs time.
     */
    it("has no answer when the watcher reported no stats", () => {
        expect(watchedFileIdentity(undefined)).toBeNull();
        expect(watchedFileIdentity({} as never)).toBeNull();
        expect(watchedFileIdentity({ mtimeMs: 1, size: undefined } as never)).toBeNull();
    });
});
