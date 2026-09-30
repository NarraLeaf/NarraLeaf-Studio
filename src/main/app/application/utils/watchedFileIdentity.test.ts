import { describe, expect, it } from "vitest";
import { rememberWatchedFile, watchedFileChanged, watchedFileIdentity } from "./watchedFileIdentity";

/**
 * The guard that stops a running Dev Mode or Preview session from scheduling reloads of itself.
 *
 * The watcher reports a last-access-time update as a change, and NTFS updates access times by
 * default - so reading a file is indistinguishable from editing one at the event level. The running
 * game reads every asset it preloads and a preview copies every asset it ships, so a session that
 * was doing nothing but running kept scheduling reloads of itself.
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

describe("watchedFileChanged", () => {
    const asset = "assets/content/bg/hall.png";

    it("ignores a repeat of the identity it last accepted", () => {
        const identities = new Map<string, string>();
        const stats = { mtimeMs: 1_700_000_000_000, size: 4096 };

        // The first event on a file this watch has not seen is a change; the access-time events that
        // follow a read of the same bytes are not.
        expect(watchedFileChanged(identities, asset, stats)).toBe(true);
        expect(watchedFileChanged(identities, asset, stats)).toBe(false);
        expect(watchedFileChanged(identities, asset, stats)).toBe(false);
    });

    it("reports an edit that follows any number of reads", () => {
        const identities = new Map<string, string>();
        const stats = { mtimeMs: 1_700_000_000_000, size: 4096 };
        rememberWatchedFile(identities, asset, stats);

        expect(watchedFileChanged(identities, asset, stats)).toBe(false);
        expect(watchedFileChanged(identities, asset, { mtimeMs: 1_700_000_000_500, size: 4096 })).toBe(true);
        expect(watchedFileChanged(identities, asset, { mtimeMs: 1_700_000_000_500, size: 8192 })).toBe(true);
    });

    it("takes an event with no stats at face value", () => {
        const identities = new Map<string, string>();
        rememberWatchedFile(identities, asset, { mtimeMs: 1_700_000_000_000, size: 4096 });

        expect(watchedFileChanged(identities, asset, undefined)).toBe(true);
    });

    it("keeps files apart", () => {
        const identities = new Map<string, string>();
        const stats = { mtimeMs: 1_700_000_000_000, size: 4096 };
        rememberWatchedFile(identities, asset, stats);

        expect(watchedFileChanged(identities, "assets/content/bg/street.png", stats)).toBe(true);
    });
});

describe("rememberWatchedFile", () => {
    const voice = "assets/content/voice/line.ogg";

    it("records a baseline without claiming a change", () => {
        const identities = new Map<string, string>();
        const stats = { mtimeMs: 1_700_000_000_000, size: 4096 };

        rememberWatchedFile(identities, voice, stats);

        expect(watchedFileChanged(identities, voice, stats)).toBe(false);
    });

    it("leaves nothing behind when the watcher reported no stats", () => {
        const identities = new Map<string, string>();

        rememberWatchedFile(identities, voice, undefined);

        expect(identities.size).toBe(0);
    });
});
